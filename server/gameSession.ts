// 对局运行时：引擎状态 + 双定时器（回合/本场到点）+ 每动作落库 + 广播 + 结算
import type {
  Decl,
  GameSnapshot,
  GameState,
  PublicGameState,
  SeatMeta,
  SessionRankRow,
  SessionSummary,
} from '../src/types.js'
import {
  applyAutoMove,
  applyPass,
  applyPlay,
  applyTimeout,
  createGame,
} from '../src/game/engine.js'
import { mulberry32, systemSeed } from '../src/game/rng.js'
import { projectPublic, projectSnapshot } from '../src/game/snapshot.js'
import { db, tx } from './db.js'
import { pushLobby, pushRoomState } from './notify.js'
import { brainForUser } from './npc.js'
import { rooms, type Room } from './roomManager.js'
import { recordGameResult } from './users.js'
import { hub } from './ws/hub.js'

/** 回合 deadline 的网络宽限（假设8） */
const GRACE_MS = 1000
/** 电脑/托管座位的自动落子延迟 */
const AUTO_MOVE_DELAY_MS = 700
/** 局间自动开局的间隔（展示结算/洗牌动画的时间） */
export const INTERMISSION_MS = 8000

function clearNextGame(room: Room): void {
  if (room.nextGameTimer) {
    clearTimeout(room.nextGameTimer)
    room.nextGameTimer = null
  }
  room.nextGameAt = null
}

function clearSessionTimer(room: Room): void {
  if (room.sessionTimer) {
    clearTimeout(room.sessionTimer)
    room.sessionTimer = null
  }
}

/** 等待态挂本场到点定时器（到点即 finalize；仅 waiting 且本场进行中） */
export function armSessionExpiry(room: Room): void {
  clearSessionTimer(room)
  if (room.sessionEndsAt == null || room.status !== 'waiting') return
  const delay = Math.max(0, room.sessionEndsAt - Date.now())
  room.sessionTimer = setTimeout(() => {
    room.sessionTimer = null
    if (room.status === 'waiting' && room.sessionEndsAt != null && Date.now() >= room.sessionEndsAt) {
      finalizeSession(room)
    }
  }, delay)
}

/**
 * 本场累计分（与 finalizeSession 同口径）：[本场首局, now] 内已结束对局的 delta 合计。
 * 只读查询；当前进行中的局 status='playing' 自然不计；无对局者缺席即为 0。
 */
function loadSessionDeltas(roomId: number, startedAt: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT gp.user_id AS userId, SUM(gp.score_delta) AS total
         FROM game_players gp
         JOIN games g ON g.id = gp.game_id
        WHERE g.room_id = ? AND g.status = 'finished'
          AND g.started_at >= ? AND g.started_at <= ?
        GROUP BY gp.user_id`,
    )
    .all(roomId, startedAt, Date.now()) as unknown as {
    userId: number
    total: number
  }[]
  return new Map(rows.map((r) => [r.userId, r.total]))
}

/**
 * 结束本场：聚合本场累计排名 → 落库（清 session_ends_at、写 summary）→ 广播。
 * 幂等：sessionEndsAt 已为 null 时直接返回已有 summary。
 */
export function finalizeSession(room: Room): SessionSummary | null {
  if (room.sessionEndsAt == null) return room.sessionSummary
  clearNextGame(room)
  clearSessionTimer(room)
  const now = Date.now()

  // 旧库回填：有截止无开始 → 按配置窗口反推
  if (room.sessionStartedAt == null) {
    room.sessionStartedAt = room.sessionEndsAt - room.config.gameMinutes * 60_000
  }
  const startedAt = room.sessionStartedAt

  const rows = db
    .prepare(
      `SELECT gp.user_id AS userId, u.nickname AS nickname, SUM(gp.score_delta) AS totalDelta
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       JOIN users u ON u.id = gp.user_id
       WHERE g.room_id = ? AND g.status = 'finished'
         AND g.started_at >= ? AND g.started_at <= ?
       GROUP BY gp.user_id, u.nickname
       ORDER BY totalDelta DESC, gp.user_id ASC`,
    )
    .all(room.id, startedAt, now) as unknown as {
    userId: number
    nickname: string
    totalDelta: number
  }[]
  const gameCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM games
         WHERE room_id = ? AND status = 'finished' AND started_at >= ? AND started_at <= ?`,
      )
      .get(room.id, startedAt, now) as { c: number }
  ).c

  // 竞争排名：同分同名次，tie-break userId（SQL 已按 totalDelta DESC, userId ASC）
  const ranked: SessionRankRow[] = []
  let prevDelta: number | null = null
  rows.forEach((r, i) => {
    const rank = prevDelta !== null && r.totalDelta === prevDelta ? ranked[i - 1].rank : i + 1
    ranked.push({ rank, userId: r.userId, nickname: r.nickname, totalDelta: r.totalDelta })
    prevDelta = r.totalDelta
  })

  const summary: SessionSummary = {
    roomId: room.id,
    startedAt,
    endedAt: now,
    gameCount,
    rows: ranked,
  }

  room.sessionEndsAt = null
  room.sessionSummary = summary
  rooms.saveSession(room)

  hub.broadcast(rooms.memberIds(room), 'session.final', summary)
  pushRoomState(room)
  return summary
}

/** 一局落库后：过期 → finalize；否则排下一局 + 挂到点定时器 + 推房间状态 */
export function afterGameRecorded(room: Room): void {
  if (room.sessionEndsAt != null && Date.now() >= room.sessionEndsAt) {
    finalizeSession(room)
    return
  }
  scheduleNextGame(room)
  armSessionExpiry(room)
  pushRoomState(room)
}

/**
 * 一局结束后调度下一局（本场内自动连开）。
 * 本场耗尽 → finalizeSession；开局时刻不早于截止或人不够 → 只挂到点定时器。
 */
export function scheduleNextGame(room: Room, delayMs = INTERMISSION_MS): boolean {
  clearNextGame(room)
  if (room.sessionEndsAt != null && Date.now() >= room.sessionEndsAt) {
    finalizeSession(room)
    return false
  }
  if (room.sessionEndsAt == null || room.status !== 'waiting') return false
  if (room.players.size < 2) {
    armSessionExpiry(room) // 人不够 → 到点仍要结束本场
    return false
  }
  const at = Date.now() + delayMs
  if (at >= room.sessionEndsAt) {
    // 下一局开局时刻不早于本场截止 → 不排局，到点直接结算本场
    armSessionExpiry(room)
    return false
  }
  room.nextGameAt = at
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
    finalizeSession(room)
    return
  }
  if (room.players.size < 2) {
    armSessionExpiry(room)
    return
  }
  const r = startGame(room)
  if (!r.ok) {
    armSessionExpiry(room) // 开局失败兜底：到点仍要结束本场
    return
  }
  pushRoomState(room)
  pushLobby()
  r.session.broadcastStart()
}

/** 可加时的分钟数（15 分钟一台阶，可多次累加；无总上限） */
const EXTEND_MINUTES = [15, 30, 45, 60] as const

/**
 * 本场运行时加时：sessionEndsAt 增量延长（落库），进行中游戏同步 endsAt，
 * 等待态重挂到点定时器并重新评估下一局调度。幂等可叠加。
 */
export function extendSession(
  room: Room,
  minutes: number,
): { ok: true } | { ok: false; error: string } {
  if (room.sessionEndsAt == null) return { ok: false, error: '本场未进行中，无法加时' }
  if (!(EXTEND_MINUTES as readonly number[]).includes(minutes)) {
    return { ok: false, error: '加时分钟数须为 15/30/45/60' }
  }
  room.sessionEndsAt += minutes * 60_000
  rooms.saveSession(room)
  if (room.session && room.status === 'playing') {
    room.session.updateEndsAt(room.sessionEndsAt)
  }
  if (room.status === 'waiting') {
    armSessionExpiry(room)
    // 之前因预算不足没排上的下一局，加时后重新评估
    if (room.nextGameAt == null && room.players.size >= 2) {
      scheduleNextGame(room)
    }
  }
  pushRoomState(room)
  return { ok: true }
}

export class GameSession {
  readonly gameId: number
  readonly roomId: number
  private state: GameState
  private timer: ReturnType<typeof setTimeout> | null = null
  /** 各座位本场累计分（构造时按 finalizeSession 同口径聚合一次；进行中的本局不计） */
  private readonly sessionDeltaBySeat: ReadonlyMap<number, number>

  constructor(gameId: number, roomId: number, state: GameState) {
    this.gameId = gameId
    this.roomId = roomId
    this.state = state
    const room = rooms.get(roomId)
    // 旧库回填口径与 finalizeSession 一致：有截止无开始 → 按配置窗口反推
    const startedAt =
      room?.sessionStartedAt ?? state.endsAt - state.config.gameMinutes * 60_000
    const byUser = loadSessionDeltas(roomId, startedAt)
    this.sessionDeltaBySeat = new Map(
      state.seats.map((s) => [s.seat, byUser.get(s.userId) ?? 0]),
    )
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

  /** 电脑座位（对局中成员稳定：leave/addBot/removeBot 均 waiting-only） */
  private botSeatSet(): Set<number> {
    const room = rooms.get(this.roomId)
    const out = new Set<number>()
    if (!room) return out
    for (const s of this.state.seats) {
      if (room.players.get(s.userId)?.isBot) out.add(s.seat)
    }
    return out
  }

  /** 托管座位（内存态；重启即重置） */
  private delegatedSeatSet(): Set<number> {
    const room = rooms.get(this.roomId)
    const out = new Set<number>()
    if (!room) return out
    for (const s of this.state.seats) {
      if (room.delegated.has(s.userId)) out.add(s.seat)
    }
    return out
  }

  /** 电脑 或 托管 的座位：服务器自动落子 */
  private autoSeatSet(): Set<number> {
    const bots = this.botSeatSet()
    const del = this.delegatedSeatSet()
    return new Set([...bots, ...del])
  }

  getPublicState(): PublicGameState {
    return projectPublic(
      this.state,
      this.onlineSeatSet(),
      this.botSeatSet(),
      this.delegatedSeatSet(),
      this.sessionDeltaBySeat,
    )
  }

  snapshotFor(userId: number): GameSnapshot | null {
    const seat = this.seatOf(userId)
    if (seat < 0) return null
    return projectSnapshot(
      this.state,
      this.state.seats[seat].seat,
      this.onlineSeatSet(),
      this.botSeatSet(),
      this.delegatedSeatSet(),
      this.sessionDeltaBySeat,
    )
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
    if (rooms.get(this.roomId)?.delegated.has(userId)) {
      return { ok: false, error: '托管中，请先取消托管', seq }
    }
    const r = applyPlay(this.state, seat, cardIds, decl, Date.now())
    if (!r.ok) return { ok: false, error: r.error, seq }
    this.commit(r.state)
    if (r.state.phase === 'finished') this.finish()
    return { ok: true }
  }

  pass(userId: number, seq?: number): { ok: true } | { ok: false; error: string; seq?: number } {
    const seat = this.seatOf(userId)
    if (seat < 0) return { ok: false, error: '你不在本局中', seq }
    if (rooms.get(this.roomId)?.delegated.has(userId)) {
      return { ok: false, error: '托管中，请先取消托管', seq }
    }
    const r = applyPass(this.state, seat, Date.now())
    if (!r.ok) return { ok: false, error: r.error, seq }
    this.commit(r.state)
    if (r.state.phase === 'finished') this.finish()
    return { ok: true }
  }

  /** 托管切换后：重广播 + 重挂定时器（auto 座位 ~700ms 落子） */
  refresh(): void {
    if (this.state.phase !== 'playing') return
    this.broadcastState()
    this.armTimer()
  }

  /** 本场加时：同步进行中游戏的 endsAt（展示/调度用；不重挂回合定时器） */
  updateEndsAt(endsAt: number): void {
    if (this.state.phase !== 'playing') return
    this.state.endsAt = endsAt
    db.prepare('UPDATE games SET state_json = ?, ends_at = ? WHERE id = ?').run(
      JSON.stringify(this.state),
      endsAt,
      this.gameId,
    )
    this.broadcastState()
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
    // 电脑/托管座位短延迟自动落子；真人挂到 deadline + 宽限
    // 只挂回合定时器；本场到点不打断当前局（等待自然结束后 finalize）
    const auto = this.autoSeatSet().has(this.state.trick.turnSeat)
    const at = auto
      ? Date.now() + AUTO_MOVE_DELAY_MS
      : this.state.trick.turnDeadline + GRACE_MS
    this.timer = setTimeout(() => this.onTimer(), Math.max(0, at - Date.now()))
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

    // auto 分支必须先于 deadline 判断：700ms 定时器永远早于 deadline 唤醒
    if (this.autoSeatSet().has(this.state.trick.turnSeat)) {
      const turnUserId = this.state.seats[this.state.trick.turnSeat]?.userId
      const r = applyAutoMove(this.state, now, brainForUser(turnUserId ?? -1))
      if (r.ok) {
        this.commit(r.state)
        if (r.state.phase === 'finished') this.finish()
      } else {
        this.armTimer() // 意外失败时重挂，避免卡死
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

    // 全员亮牌（先让客户端看到上局结果，再切最终排名/局间状态）
    hub.broadcast(
      memberIds,
      'game.over',
      { result, hands: this.state.hands.map((cards, seat) => ({ seat, cards })) },
    )
    // 本场未耗尽 → 局间洗牌倒计时后自动开下一局；已耗尽 → finalize 最终排名
    const after = rooms.get(this.roomId)
    if (after) afterGameRecorded(after)
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
  // 新本场：无场或已耗尽 → 记开始/截止、清旧累计清单；同场续局 → 沿用剩余预算
  if (!room.sessionEndsAt || room.sessionEndsAt <= now) {
    room.sessionStartedAt = now
    room.sessionEndsAt = now + room.config.gameMinutes * 60_000
    room.sessionSummary = null
    rooms.saveSession(room)
  }
  clearNextGame(room) // 手动开局抢占局间等待
  clearSessionTimer(room)
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
