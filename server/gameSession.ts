// 对局运行时：引擎状态 + 双定时器（回合/总时长）+ 每动作落库 + 广播 + 结算
import type { Decl, GameSnapshot, GameState, PublicGameState, SeatMeta } from '../src/types.js'
import {
  applyPass,
  applyPlay,
  applyTimeout,
  createGame,
  settleTimeout,
} from '../src/game/engine.js'
import { mulberry32, systemSeed } from '../src/game/rng.js'
import { projectPublic, projectSnapshot } from '../src/game/snapshot.js'
import { db, tx } from './db.js'
import { pushLobby, pushRoomState } from './notify.js'
import { rooms, type Room } from './roomManager.js'
import { recordGameResult } from './users.js'
import { hub } from './ws/hub.js'

/** 回合 deadline 的网络宽限（假设8） */
const GRACE_MS = 1000
/** 局间自动开局的间隔（展示结算的时间） */
export const INTERMISSION_MS = 8000

function clearNextGame(room: Room): void {
  if (room.nextGameTimer) {
    clearTimeout(room.nextGameTimer)
    room.nextGameTimer = null
  }
  room.nextGameAt = null
}

/**
 * 一局结束后调度下一局（本场内自动连开）。
 * 本场耗尽 → 结束本场（sessionEndsAt 清空，回普通等待态）；人不够 → 不排，等人齐房主手动开。
 */
export function scheduleNextGame(room: Room, delayMs = INTERMISSION_MS): boolean {
  clearNextGame(room)
  if (room.sessionEndsAt != null && Date.now() >= room.sessionEndsAt) {
    room.sessionEndsAt = null
    rooms.saveSessionEnds(room)
    return false
  }
  if (room.sessionEndsAt == null || room.status !== 'waiting' || room.players.size < 2) {
    return false
  }
  room.nextGameAt = Date.now() + delayMs
  room.nextGameTimer = setTimeout(() => {
    room.nextGameTimer = null
    room.nextGameAt = null
    fireNextGame(room)
  }, delayMs)
  return true
}

function fireNextGame(room: Room): void {
  if (room.status !== 'waiting' || room.sessionEndsAt == null) return
  if (Date.now() >= room.sessionEndsAt) {
    room.sessionEndsAt = null
    rooms.saveSessionEnds(room)
    pushRoomState(room)
    return
  }
  if (room.players.size < 2) return
  const r = startGame(room)
  if (!r.ok) return
  pushRoomState(room)
  pushLobby()
  r.session.broadcastStart()
}

export class GameSession {
  readonly gameId: number
  readonly roomId: number
  private state: GameState
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(gameId: number, roomId: number, state: GameState) {
    this.gameId = gameId
    this.roomId = roomId
    this.state = state
  }

  // ---- 快照 ----

  private onlineSeatSet(): Set<number> {
    const online = hub.onlineUserIds()
    const out = new Set<number>()
    for (const s of this.state.seats) {
      if (online.has(s.userId)) out.add(s.seat)
    }
    return out
  }

  getPublicState(): PublicGameState {
    return projectPublic(this.state, this.onlineSeatSet())
  }

  snapshotFor(userId: number): GameSnapshot | null {
    const seat = this.seatOf(userId)
    if (seat < 0) return null
    return projectSnapshot(this.state, this.state.seats[seat].seat, this.onlineSeatSet())
  }

  private seatOf(userId: number): number {
    return this.state.seats.findIndex((s) => s.userId === userId)
  }

  private memberIds(): number[] {
    const room = rooms.get(this.roomId)
    return room ? rooms.memberIds(room) : []
  }

  // ---- 动作入口（dispatch 调用）----

  play(
    userId: number,
    cardIds: number[],
    decl: Decl,
    seq?: number,
  ): { ok: true } | { ok: false; error: string; seq?: number } {
    const seat = this.seatOf(userId)
    if (seat < 0) return { ok: false, error: '你不在本局中', seq }
    const r = applyPlay(this.state, seat, cardIds, decl, Date.now())
    if (!r.ok) return { ok: false, error: r.error, seq }
    this.commit(r.state)
    if (r.state.phase === 'finished') this.finish()
    return { ok: true }
  }

  pass(userId: number, seq?: number): { ok: true } | { ok: false; error: string; seq?: number } {
    const seat = this.seatOf(userId)
    if (seat < 0) return { ok: false, error: '你不在本局中', seq }
    const r = applyPass(this.state, seat, Date.now())
    if (!r.ok) return { ok: false, error: r.error, seq }
    this.commit(r.state)
    if (r.state.phase === 'finished') this.finish()
    return { ok: true }
  }

  /** 请求全量快照（seq 缺口兜底）：重发公共状态 + 本人手牌 */
  sync(userId: number): void {
    const seat = this.seatOf(userId)
    if (seat < 0) return
    hub.sendToUser(userId, 'game.state', this.getPublicState())
    this.sendHand(seat)
  }

  // ---- 开局广播（startGame 后由 dispatch 调用）----

  broadcastStart(): void {
    this.broadcastState()
    for (let seat = 0; seat < this.state.seats.length; seat++) this.sendHand(seat)
    this.armTimer()
  }

  // ---- 定时器 ----

  armTimer(): void {
    this.clearTimer()
    if (this.state.phase !== 'playing') return
    const now = Date.now()
    const at = Math.min(this.state.endsAt, this.state.trick.turnDeadline + GRACE_MS)
    this.timer = setTimeout(() => this.onTimer(), Math.max(0, at - now))
  }

  dispose(): void {
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private onTimer(): void {
    this.timer = null
    if (this.state.phase !== 'playing') return
    const now = Date.now()

    // 先裁决总时长，再裁决回合（重启恢复同序，避免级联）
    if (now >= this.state.endsAt) {
      const r = settleTimeout(this.state)
      if (r.ok) {
        this.commit(r.state)
        this.finish()
      }
      return
    }
    if (now >= this.state.trick.turnDeadline + GRACE_MS) {
      const r = applyTimeout(this.state, now)
      if (r.ok) {
        this.commit(r.state)
        if (r.state.phase === 'finished') this.finish()
      } else {
        this.armTimer() // 意外失败时重挂，避免卡死
      }
      return
    }
    this.armTimer() // 提前唤醒（时钟偏差），重挂
  }

  // ---- 落库 + 广播 ----

  private commit(next: GameState): void {
    const before = this.state.hands.map((h) => h.length)
    this.state = next
    db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(
      JSON.stringify(this.state),
      this.gameId,
    )
    this.broadcastState()
    // 手牌有变化的座位（出牌/补牌）收私有 game.hand
    next.hands.forEach((h, i) => {
      if (h.length !== before[i]) this.sendHand(i)
    })
    this.armTimer()
  }

  private broadcastState(): void {
    const ids = this.memberIds()
    if (ids.length > 0) hub.broadcast(ids, 'game.state', this.getPublicState())
  }

  private sendHand(index: number): void {
    const uid = this.state.seats[index].userId
    hub.sendToUser(uid, 'game.hand', {
      seat: this.state.seats[index].seat,
      hand: this.state.hands[index],
    })
  }

  // ---- 终局 ----

  private finish(): void {
    const result = this.state.result
    if (!result) return
    const now = Date.now()

    const room = rooms.get(this.roomId)
    const memberIds = room ? rooms.memberIds(room) : []

    recordGameResult({ gameId: this.gameId, roomId: this.roomId, result, finishedAt: now })
    rooms.finishGame(this.roomId, result)
    // 本场未耗尽 → 局间倒计时后自动开下一局
    if (room) scheduleNextGame(room)

    // 全员亮牌
    hub.broadcast(
      memberIds,
      'game.over',
      { result, hands: this.state.hands.map((cards, seat) => ({ seat, cards })) },
    )
    // 房间回等待态（含上局结果）
    const after = rooms.get(this.roomId)
    if (after) pushRoomState(after)
    pushLobby()
    this.dispose()
  }
}

/**
 * 开局：校验 → 压实座位（0..n-1 连续）→ 建引擎状态 → 落 games 行 →
 * 房间转 playing → 建会话并挂到房间
 */
export function startGame(room: Room): { ok: true; session: GameSession } | { ok: false; error: string } {
  if (room.status === 'playing') return { ok: false, error: '对局已在进行' }
  if (room.session) return { ok: false, error: '对局已在进行' }
  if (room.players.size < 2) return { ok: false, error: '至少需要 2 名玩家才能开始' }

  // 座位压实：按现有座位排序重排为 0..n-1（相对顺序不变；跨局固定到下一次离开）
  const sorted = [...room.players.values()].sort((a, b) => a.seat - b.seat)
  tx(() => {
    const upd = db.prepare(
      'UPDATE room_players SET seat = ? WHERE room_id = ? AND user_id = ?',
    )
    sorted.forEach((p, i) => {
      if (p.seat !== i) upd.run(i, room.id, p.userId)
      p.seat = i
    })
  })

  const seats: SeatMeta[] = sorted.map((p) => ({
    seat: p.seat,
    userId: p.userId,
    nickname: p.nickname,
  }))

  // 庄家（假设4）：上局赢家（按 userId 找，座位已重排）→ 否则房主
  let dealerSeat = sorted.findIndex((p) => p.userId === room.hostUserId)
  const winnerId = room.lastResult?.winnerSeat != null
    ? room.lastResult.perPlayer.find((p) => p.seat === room.lastResult!.winnerSeat)?.userId
    : undefined
  if (winnerId != null) {
    const idx = sorted.findIndex((p) => p.userId === winnerId)
    if (idx >= 0) dealerSeat = idx
  }
  if (dealerSeat < 0) dealerSeat = 0

  const now = Date.now()
  // 本场：无场或已耗尽 → 按当前配置开新场；否则沿用剩余预算
  if (!room.sessionEndsAt || room.sessionEndsAt <= now) {
    room.sessionEndsAt = now + room.config.gameMinutes * 60_000
    rooms.saveSessionEnds(room)
  }
  clearNextGame(room) // 手动开局抢占局间等待
  const state = createGame({
    gameId: 0,
    roomId: room.id,
    config: room.config,
    seats,
    dealerSeat,
    rng: mulberry32(systemSeed()),
    now,
    endsAt: room.sessionEndsAt,
  })

  const res = db
    .prepare(
      `INSERT INTO games (room_id, status, config_json, state_json, started_at, ends_at)
       VALUES (?, 'playing', ?, ?, ?, ?)`,
    )
    .run(
      room.id,
      JSON.stringify({ ...room.config, dealerSeat }),
      JSON.stringify(state),
      now,
      state.endsAt,
    )
  const gameId = Number(res.lastInsertRowid)
  state.gameId = gameId
  db.prepare('UPDATE games SET state_json = ? WHERE id = ?').run(JSON.stringify(state), gameId)

  rooms.markPlaying(room.id)
  const session = new GameSession(gameId, room.id, state)
  room.session = session
  return { ok: true, session }
}
