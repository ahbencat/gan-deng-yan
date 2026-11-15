// 启动恢复：重建等待/进行中房间；进行中对局按绝对时间戳裁决过期 deadline；
// 版本门禁失败的对局作废不计分。玩家 WS 连上即由 dispatch 的 session 恢复。
import { applyTimeout, settleTimeout } from '../src/game/engine.js'
import { STATE_VERSION, type GameState } from '../src/types.js'
import { db } from './db.js'
import { GameSession, INTERMISSION_MS, scheduleNextGame, startGame } from './gameSession.js'
import { pushLobby, pushRoomState } from './notify.js'
import { rooms, type RoomPlayer } from './roomManager.js'
import { abandonGame, recordGameResult } from './users.js'

interface RoomRow {
  id: number
  host_user_id: number
  status: string
  config_json: string
  last_result_json: string | null
  session_ends_at: number | null
}

interface GameRow {
  id: number
  room_id: number
  status: string
  state_json: string
}

export function restoreAll(): void {
  const now = Date.now()

  // 1. 加载 waiting/playing 房间（连接为空，全员 offline）
  const roomRows = db
    .prepare(
      `SELECT id, host_user_id, status, config_json, last_result_json, session_ends_at
       FROM rooms WHERE status IN ('waiting','playing')`,
    )
    .all() as unknown as RoomRow[]
  const playerStmt = db.prepare(
    `SELECT rp.user_id, rp.seat, u.nickname, u.score
     FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ?`,
  )
  for (const row of roomRows) {
    const prows = playerStmt.all(row.id) as unknown as {
      user_id: number
      seat: number
      nickname: string
      score: number
    }[]
    const players: RoomPlayer[] = prows.map((p) => ({
      userId: p.user_id,
      nickname: p.nickname,
      seat: p.seat,
      score: p.score,
    }))
    rooms.loadRoom(row, players)
  }

  // 2. 清理孤儿恢复锚点（房间不存在或本人不在座）
  const anchors = db
    .prepare(`SELECT id, current_room_id FROM users WHERE current_room_id IS NOT NULL`)
    .all() as unknown as { id: number; current_room_id: number }[]
  const clearAnchor = db.prepare(`UPDATE users SET current_room_id = NULL WHERE id = ?`)
  for (const a of anchors) {
    const room = rooms.get(a.current_room_id)
    if (!room || !room.players.has(a.id)) clearAnchor.run(a.id)
  }

  // 3. 进行中对局
  const gameRows = db
    .prepare(`SELECT id, room_id, status, state_json FROM games WHERE status = 'playing'`)
    .all() as unknown as GameRow[]

  for (const g of gameRows) {
    const room = rooms.get(g.room_id)
    if (!room || room.status !== 'playing') {
      // 房间缺失/状态不一致 → 对局作废（不计分），房间回 waiting
      abandonGame(g.id, g.room_id, now)
      if (room) {
        room.status = 'waiting'
        room.session = null
      }
      continue
    }

    let state: GameState
    try {
      state = JSON.parse(g.state_json) as GameState
    } catch {
      abandonGame(g.id, g.room_id, now)
      room.status = 'waiting'
      continue
    }

    // 版本门禁：规则升级后旧状态作废
    if (state.v !== STATE_VERSION) {
      abandonGame(g.id, g.room_id, now)
      room.status = 'waiting'
      continue
    }

    // 已终局但结算没落库（崩溃间隙）→ 补结算
    if (state.phase === 'finished') {
      if (state.result) {
        db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(state), g.id)
        recordGameResult({ gameId: g.id, roomId: g.room_id, result: state.result, finishedAt: now })
        rooms.finishGame(g.room_id, state.result)
        scheduleNextGame(room)
      } else {
        abandonGame(g.id, g.room_id, now)
        room.status = 'waiting'
      }
      continue
    }

    // 本场已耗尽 → 直接结算（不再开下一局）
    if (now >= state.endsAt) {
      const r = settleTimeout(state)
      if (r.ok) {
        db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(r.state), g.id)
        recordGameResult({
          gameId: g.id,
          roomId: g.room_id,
          result: r.state.result!,
          finishedAt: now,
        })
        rooms.finishGame(g.room_id, r.state.result!)
        scheduleNextGame(room)
      }
      continue
    }

    // 回合 deadline 已过 → 恰好补一步自动动作（新 deadline = now+turnSeconds，不会级联）
    if (now >= state.trick.turnDeadline) {
      const r = applyTimeout(state, now)
      if (r.ok) {
        state = r.state
        db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(state), g.id)
        // 补的这一步可能直接终局（如领出逃生/出完）
        if (state.phase === 'finished' && state.result) {
          recordGameResult({ gameId: g.id, roomId: g.room_id, result: state.result, finishedAt: now })
          rooms.finishGame(g.room_id, state.result)
          scheduleNextGame(room)
          continue
        }
      }
    }

    // 正常挂会话，重挂定时器
    const session = new GameSession(g.id, g.room_id, state)
    room.session = session
    session.armTimer()
  }

  // 4. 等待态房间的本场续局：按上一局 finished_at 恢复局间倒计时/立即开
  const finStmt = db.prepare(
    `SELECT MAX(finished_at) AS f FROM games WHERE room_id = ? AND status = 'finished'`,
  )
  for (const room of rooms.all()) {
    if (room.status !== 'waiting' || room.nextGameTimer || room.sessionEndsAt == null) continue
    if (now >= room.sessionEndsAt) {
      room.sessionEndsAt = null
      rooms.saveSessionEnds(room)
      continue
    }
    const fin = (finStmt.get(room.id) as { f: number | null }).f
    if (fin == null) continue
    const at = fin + INTERMISSION_MS
    if (at > now) {
      scheduleNextGame(room, at - now)
    } else if (room.players.size >= 2) {
      const r = startGame(room)
      if (r.ok) {
        pushRoomState(room)
        pushLobby()
        r.session.broadcastStart()
      }
    }
  }
}
