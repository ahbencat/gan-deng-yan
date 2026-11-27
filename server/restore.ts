// 启动恢复：重建等待/进行中房间；进行中对局按绝对时间戳裁决过期回合 deadline；
// 本场到点不强制结算进行中的对局（等自然结束）；版本门禁失败的对局作废不计分。
// 玩家 WS 连上即由 dispatch 的 session 恢复。
import { applyAutoMove, applyTimeout, normalizeSeenRanks } from '../src/game/engine.js'
import { INTERMISSION_MS, STATE_VERSION, type GameState } from '../src/types.js'
import { db } from './db.js'
import { logGameEnd, logMove } from './gameLog.js'
import {
  afterGameRecorded,
  armSessionExpiry,
  finalizeSession,
  GameSession,
  scheduleNextGame,
  startGame,
} from './gameSession.js'
import { pushLobby, pushRoomState } from './notify.js'
import { brainForSeat } from './npc.js'
import { rooms, type RoomPlayer } from './roomManager.js'
import { abandonGame, recordGameResult } from './users.js'

interface RoomRow {
  id: number
  host_user_id: number
  status: string
  config_json: string
  last_result_json: string | null
  session_started_at: number | null
  session_ends_at: number | null
  session_summary_json: string | null
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
      `SELECT id, host_user_id, status, config_json, last_result_json,
              session_started_at, session_ends_at, session_summary_json
       FROM rooms WHERE status IN ('waiting','playing')`,
    )
    .all() as unknown as RoomRow[]
  const playerStmt = db.prepare(
    `SELECT rp.user_id, rp.seat, u.nickname, u.score, u.is_bot
     FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ?`,
  )
  for (const row of roomRows) {
    const prows = playerStmt.all(row.id) as unknown as {
      user_id: number
      seat: number
      nickname: string
      score: number
      is_bot: number
    }[]
    const players: RoomPlayer[] = prows.map((p) => ({
      userId: p.user_id,
      nickname: p.nickname,
      seat: p.seat,
      score: p.score,
      isBot: !!p.is_bot,
    }))
    rooms.loadRoom(row, players)
  }

  // 1.5 关纯 bot 房（真人已全部离开的崩溃间隙；closeRoom 清 bot 锚点回空闲池）
  for (const room of rooms.all()) {
    const hasHuman = [...room.players.values()].some((p) => !p.isBot)
    if (!hasHuman) rooms.closeRoom(room.id)
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
    // 旧 state_json（v=1 无 seenRanks 字段）补齐记牌计数
    normalizeSeenRanks(state)

    // 已终局但结算没落库（崩溃间隙）→ 补结算
    if (state.phase === 'finished') {
      if (state.result) {
        db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(state), g.id)
        recordGameResult({ gameId: g.id, roomId: g.room_id, result: state.result, finishedAt: now })
        rooms.finishGame(g.room_id, state.result)
        afterGameRecorded(room)
      } else {
        abandonGame(g.id, g.room_id, now)
        room.status = 'waiting'
      }
      continue
    }

    // 本场已耗尽也照常恢复（不强制结算）；对局自然结束后再 finalize 本场

    // 回合 deadline 已过 → 恰好补一步自动动作（新 deadline = now+turnSeconds，不会级联）
    // bot 座位用 applyAutoMove（跟牌也压）；真人仍是超时语义（跟牌过）——重启后无托管态
    if (now >= state.trick.turnDeadline) {
      const turnUserId = state.seats[state.trick.turnSeat]?.userId
      const isBotTurn =
        turnUserId != null && room.players.get(turnUserId)?.isBot === true
      const r = isBotTurn
        ? applyAutoMove(state, now, brainForSeat(room.players.get(turnUserId!)))
        : applyTimeout(state, now)
      if (r.ok) {
        state = r.state
        db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(state), g.id)
        logMove(room, g.id, state, isBotTurn ? 'bot' : 'timeout')
        // 补的这一步可能直接终局（如领出逃生/出完）
        if (state.phase === 'finished' && state.result) {
          recordGameResult({ gameId: g.id, roomId: g.room_id, result: state.result, finishedAt: now })
          logGameEnd(
            room,
            g.id,
            state,
            state.hands.map((cards, seat) => ({ seat, cards })),
          )
          rooms.finishGame(g.room_id, state.result)
          afterGameRecorded(room)
          continue
        }
      }
    }

    // 正常挂会话，重挂定时器（只按回合 deadline；本场到点不打断）
    const session = new GameSession(g.id, g.room_id, state)
    room.session = session
    session.armTimer()
  }

  // 4. 等待态房间的本场续局：过期 → finalize；否则按本场最后一局 finished_at 恢复局间倒计时/立即开
  const finStmt = db.prepare(
    `SELECT MAX(finished_at) AS f FROM games
     WHERE room_id = ? AND status = 'finished' AND started_at >= ?`,
  )
  for (const room of rooms.all()) {
    if (room.status !== 'waiting' || room.nextGameTimer || room.sessionEndsAt == null) continue
    // 旧库回填：有截止无开始 → 按配置窗口反推
    if (room.sessionStartedAt == null) {
      room.sessionStartedAt = room.sessionEndsAt - room.config.gameMinutes * 60_000
      rooms.saveSession(room)
    }
    if (now >= room.sessionEndsAt) {
      finalizeSession(room)
      continue
    }
    const fin = (finStmt.get(room.id, room.sessionStartedAt) as { f: number | null }).f
    if (fin == null) {
      armSessionExpiry(room)
      continue
    }
    const at = fin + INTERMISSION_MS
    if (at > now && at < room.sessionEndsAt) {
      scheduleNextGame(room, at - now)
    } else if (at <= now && room.players.size >= 2 && now < room.sessionEndsAt) {
      const r = startGame(room)
      if (r.ok) {
        pushRoomState(room)
        pushLobby()
        r.session.broadcastStart()
      }
    } else {
      armSessionExpiry(room)
    }
  }
}
