// 房间管理：内存房间表 + DB 同步（创建/加入/离开/配置/开局/关房）
// 对局运行时（GameSession）挂在 Room.session 上，由 gameSession.ts 管理。
import type {
  GameResult,
  RoomConfig,
  RoomListEntry,
  RoomState,
  SessionSummary,
  UserPublic,
} from '../src/types.js'
import { DEFAULT_ROOM_CONFIG, ROOM_CONFIG_RANGE } from '../src/types.js'
import { db, tx } from './db.js'
import { NPC_ROSTER } from './npc.js'
import {
  findUserByUsername,
  setCurrentRoom,
  toPublic,
} from './users.js'
import type { GameSession } from './gameSession.js'

export interface RoomPlayer {
  userId: number
  nickname: string
  seat: number
  score: number
  /** 电脑玩家（服务器驱动出牌） */
  isBot: boolean
}

export interface Room {
  id: number
  hostUserId: number
  status: 'waiting' | 'playing' | 'closed'
  config: RoomConfig
  /** userId → 座位信息（seat 跨局固定） */
  players: Map<number, RoomPlayer>
  lastResult: GameResult | null
  session: GameSession | null
  /** 本场首局开局时刻（绝对 ms）；null=未开本场 */
  sessionStartedAt: number | null
  /** 本场截止时刻（绝对 ms）；null=未开局/本场已结束 */
  sessionEndsAt: number | null
  /** 本场结束后的累计排名；进行中或尚未开始为 null */
  sessionSummary: SessionSummary | null
  /** 自动开局下一局的时刻；局间等待期非 null */
  nextGameAt: number | null
  nextGameTimer: ReturnType<typeof setTimeout> | null
  /** 等待态本场到点定时器（到点即 finalize 本场） */
  sessionTimer: ReturnType<typeof setTimeout> | null
  /** 托管中的 userId（内存态，不落库；重启即重置为关） */
  delegated: Set<number>
}

/** 校验并归一化房间配置；非法返回 null */
export function sanitizeConfig(raw: unknown): RoomConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const wildCount = o.wildCount
  const maxPlayers = o.maxPlayers
  const turnSeconds = o.turnSeconds
  const gameMinutes = o.gameMinutes
  if (wildCount !== 2 && wildCount !== 3 && wildCount !== 4) return null
  if (!intIn(maxPlayers, 2, 8)) return null
  if (!intIn(turnSeconds, 5, 120)) return null
  if (!intIn(gameMinutes, 1, 60)) return null
  return { wildCount, maxPlayers, turnSeconds, gameMinutes }
}

function intIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
}

export function defaultConfig(): RoomConfig {
  return { ...DEFAULT_ROOM_CONFIG }
}

class RoomManager {
  private rooms = new Map<number, Room>()

  // ---- 查询 ----

  get(roomId: number): Room | undefined {
    const room = this.rooms.get(roomId)
    return room && room.status !== 'closed' ? room : undefined
  }

  getByUser(userId: number): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.status === 'closed') continue
      if (room.players.has(userId)) return room
    }
    return undefined
  }

  list(): RoomListEntry[] {
    const out: RoomListEntry[] = []
    for (const room of this.rooms.values()) {
      if (room.status === 'closed') continue
      const host = room.players.get(room.hostUserId)
      out.push({
        id: room.id,
        hostName: host?.nickname ?? '房主',
        playerCount: room.players.size,
        maxPlayers: room.config.maxPlayers,
        config: room.config,
        status: room.status === 'playing' ? 'playing' : 'waiting',
      })
    }
    return out.sort((a, b) => a.id - b.id)
  }

  toState(room: Room, online: ReadonlySet<number>): RoomState {
    const players: RoomState['players'] = [...room.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        seat: p.seat,
        online: online.has(p.userId) || p.isBot,
        score: p.score,
        isBot: p.isBot,
        delegated: room.delegated.has(p.userId),
      }))
    return {
      id: room.id,
      hostUserId: room.hostUserId,
      status: room.status,
      config: room.config,
      players,
      lastResult: room.lastResult,
      sessionEndsAt: room.sessionEndsAt,
      nextGameAt: room.nextGameAt,
      sessionSummary: room.sessionSummary,
    }
  }

  memberIds(room: Room): number[] {
    return [...room.players.keys()]
  }

  // ---- 内存操作（DB 同步写）----

  create(host: UserPublic, config: RoomConfig): Room {
    const now = Date.now()
    const room = tx(() => {
      const res = db
        .prepare(
          `INSERT INTO rooms (host_user_id, status, config_json, created_at, updated_at)
           VALUES (?, 'waiting', ?, ?, ?)`,
        )
        .run(host.id, JSON.stringify(config), now, now)
      const roomId = Number(res.lastInsertRowid)
      db.prepare(
        `INSERT INTO room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, 0, ?)`,
      ).run(roomId, host.id, now)
      return roomId
    })
    setCurrentRoom(host.id, room)

    const newRoom: Room = {
      id: room,
      hostUserId: host.id,
      status: 'waiting',
      config,
      players: new Map([
        [
          host.id,
          { userId: host.id, nickname: host.nickname, seat: 0, score: host.score, isBot: host.isBot },
        ],
      ]),
      lastResult: null,
      session: null,
      sessionStartedAt: null,
      sessionEndsAt: null,
      sessionSummary: null,
      nextGameAt: null,
      nextGameTimer: null,
      sessionTimer: null,
      delegated: new Set(),
    }
    this.rooms.set(room, newRoom)
    return newRoom
  }

  join(
    roomId: number,
    user: UserPublic,
  ): { ok: true; room: Room } | { ok: false; error: string } {
    const existing = this.getByUser(user.id)
    if (existing) {
      return { ok: false, error: existing.id === roomId ? '你已在本房间' : '你已在其他房间' }
    }
    const room = this.get(roomId)
    if (!room) return { ok: false, error: '房间不存在或已关闭' }
    if (room.status === 'playing') return { ok: false, error: '对局进行中，不能加入' }
    if (room.players.size >= room.config.maxPlayers) return { ok: false, error: '房间已满' }

    // 分配最小空位
    const taken = new Set([...room.players.values()].map((p) => p.seat))
    let seat = 0
    while (taken.has(seat)) seat++
    if (seat >= room.config.maxPlayers) return { ok: false, error: '房间已满' }

    const now = Date.now()
    tx(() => {
      db.prepare(
        `INSERT INTO room_players (room_id, user_id, seat, joined_at) VALUES (?, ?, ?, ?)`,
      ).run(roomId, user.id, seat, now)
      db.prepare(`UPDATE rooms SET updated_at = ? WHERE id = ?`).run(now, roomId)
    })
    setCurrentRoom(user.id, roomId)

    room.players.set(user.id, {
      userId: user.id,
      nickname: user.nickname,
      seat,
      score: user.score,
      isBot: user.isBot,
    })
    return { ok: true, room }
  }

  /**
   * 添加电脑（仅等待态 + 未满；host 校验在 dispatch）。
   * 只从 7 个固定 NPC 花名册按序取第一个空闲者（锚点空 + 交叉 getByUser 防崩溃间隙）；
   * 全部在场则报错，不再新建 bot_N。
   */
  addBot(roomId: number): { ok: true; room: Room } | { ok: false; error: string } {
    const room = this.get(roomId)
    if (!room) return { ok: false, error: '房间不存在或已关闭' }
    if (room.status !== 'waiting') return { ok: false, error: '对局进行中，不能添加电脑' }
    if (room.players.size >= room.config.maxPlayers) return { ok: false, error: '房间已满' }

    for (const def of NPC_ROSTER) {
      const row = findUserByUsername(def.username)
      if (row && row.current_room_id == null && !this.getByUser(row.id)) {
        return this.join(roomId, toPublic(row))
      }
    }
    return { ok: false, error: '没有空闲电脑（7 台电脑均在其他房间）' }
  }

  /**
   * 移除电脑（仅等待态；只脱离房间，保留 users 行 → 保住 game_players 历史与零和）。
   * host 校验在 dispatch。
   */
  removeBot(room: Room, userId: number): { ok: true } | { ok: false; error: string } {
    if (room.status !== 'waiting') return { ok: false, error: '对局进行中，不能移除电脑' }
    const p = room.players.get(userId)
    if (!p || !p.isBot) return { ok: false, error: '该玩家不是电脑' }
    const now = Date.now()
    tx(() => {
      db.prepare(`DELETE FROM room_players WHERE room_id = ? AND user_id = ?`).run(room.id, userId)
      db.prepare(`UPDATE rooms SET updated_at = ? WHERE id = ?`).run(now, room.id)
    })
    setCurrentRoom(userId, null)
    room.players.delete(userId)
    room.delegated.delete(userId)
    return { ok: true }
  }

  /** 离开（仅等待态）；房主转移给座位最小者；空房关闭 */
  leave(
    userId: number,
  ): { ok: true; roomId: number; closed: boolean } | { ok: false; error: string } {
    const room = this.getByUser(userId)
    if (!room) return { ok: false, error: '你不在任何房间' }
    if (room.status === 'playing') {
      return { ok: false, error: '对局进行中，不能离开（可关闭页面，超时托管）' }
    }

    const now = Date.now()
    room.players.delete(userId)
    tx(() => {
      db.prepare(`DELETE FROM room_players WHERE room_id = ? AND user_id = ?`).run(room.id, userId)
      db.prepare(`UPDATE rooms SET updated_at = ? WHERE id = ?`).run(now, room.id)
    })
    setCurrentRoom(userId, null)
    room.delegated.delete(userId)

    // 无真人 → 关房（bot 锚点随 closeRoom 清空，回空闲池）
    const humans = [...room.players.values()]
      .filter((p) => !p.isBot)
      .sort((a, b) => a.seat - b.seat)
    if (humans.length === 0) {
      this.closeRoom(room.id)
      return { ok: true, roomId: room.id, closed: true }
    }
    // 房主转移：座位最小的真人
    if (room.hostUserId === userId) {
      const nextHost = humans[0]
      room.hostUserId = nextHost.userId
      db.prepare(`UPDATE rooms SET host_user_id = ?, updated_at = ? WHERE id = ?`).run(
        nextHost.userId,
        now,
        room.id,
      )
    }
    return { ok: true, roomId: room.id, closed: false }
  }

  updateConfig(
    userId: number,
    config: RoomConfig,
  ): { ok: true; room: Room } | { ok: false; error: string } {
    const room = this.getByUser(userId)
    if (!room) return { ok: false, error: '你不在任何房间' }
    if (room.hostUserId !== userId) return { ok: false, error: '只有房主可以修改配置' }
    if (room.status !== 'waiting') return { ok: false, error: '对局进行中，不能修改配置' }
    if (room.players.size > config.maxPlayers) {
      return { ok: false, error: '最大人数不能小于当前房间人数' }
    }
    room.config = config
    const now = Date.now()
    db.prepare(`UPDATE rooms SET config_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(config),
      now,
      room.id,
    )
    return { ok: true, room }
  }

  /** 标记开局（DB 状态切换由 gameSession 落 games 行时一并处理） */
  markPlaying(roomId: number): Room | null {
    const room = this.get(roomId)
    if (!room) return null
    room.status = 'playing'
    db.prepare(`UPDATE rooms SET status = 'playing', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      roomId,
    )
    return room
  }

  /** 对局结束：内存回 waiting + lastResult（DB 已由 recordGameResult 更新） */
  finishGame(roomId: number, result: GameResult): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.status = 'waiting'
    room.session = null
    room.lastResult = result
    // 同步玩家分数展示
    for (const p of result.perPlayer) {
      const rp = room.players.get(p.userId)
      if (rp) rp.score += p.delta
    }
  }

  /**
   * 解散房间（房主 + 等待态，dispatch 已校验）：
   * 清 room_players 滞留行（对局历史在 game_players，不受影响）→ closeRoom
   * （清 nextGame/session 定时器、清锚点让电脑回空闲池、删内存项、落库 closed）。
   * 调用方负责先向成员广播 room.closed 再调用本方法。
   */
  dissolve(roomId: number): void {
    db.prepare(`DELETE FROM room_players WHERE room_id = ?`).run(roomId)
    this.closeRoom(roomId)
  }

  closeRoom(roomId: number): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.status = 'closed'
    room.session?.dispose()
    room.session = null
    if (room.nextGameTimer) {
      clearTimeout(room.nextGameTimer)
      room.nextGameTimer = null
    }
    room.nextGameAt = null
    if (room.sessionTimer) {
      clearTimeout(room.sessionTimer)
      room.sessionTimer = null
    }
    db.prepare(`UPDATE rooms SET status = 'closed', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      roomId,
    )
    for (const uid of room.players.keys()) {
      setCurrentRoom(uid, null)
    }
    this.rooms.delete(roomId)
  }

  // ---- 启动恢复 ----

  loadRoom(
    row: {
      id: number
      host_user_id: number
      status: string
      config_json: string
      last_result_json: string | null
      session_started_at?: number | null
      session_ends_at?: number | null
      session_summary_json?: string | null
    },
    players: RoomPlayer[],
  ): void {
    const config = sanitizeConfig(JSON.parse(row.config_json)) ?? defaultConfig()
    let sessionSummary: SessionSummary | null = null
    if (row.session_summary_json) {
      try {
        sessionSummary = JSON.parse(row.session_summary_json) as SessionSummary
      } catch {
        sessionSummary = null // 坏 JSON 兜底
      }
    }
    const room: Room = {
      id: row.id,
      hostUserId: row.host_user_id,
      status: row.status === 'playing' ? 'playing' : 'waiting',
      config,
      players: new Map(players.map((p) => [p.userId, p])),
      lastResult: row.last_result_json ? (JSON.parse(row.last_result_json) as GameResult) : null,
      session: null,
      sessionStartedAt: row.session_started_at ?? null,
      sessionEndsAt: row.session_ends_at ?? null,
      sessionSummary,
      nextGameAt: null,
      nextGameTimer: null,
      sessionTimer: null,
      delegated: new Set(),
    }
    // 房主不在座或房主是 bot → 转给座位最小的真人；无真人则留给 restore 关纯 bot 房
    const host = room.players.get(room.hostUserId)
    if (!host || host.isBot) {
      const humans = [...room.players.values()]
        .filter((p) => !p.isBot)
        .sort((a, b) => a.seat - b.seat)
      if (humans.length > 0) room.hostUserId = humans[0].userId
    }
    this.rooms.set(room.id, room)
  }

  /** 全部房间（启动恢复用） */
  all(): Room[] {
    return [...this.rooms.values()]
  }

  /** 持久化本场三件套（开始/截止/累计结算；null=对应状态未开或已结束） */
  saveSession(room: Room): void {
    db.prepare(
      `UPDATE rooms SET session_started_at = ?, session_ends_at = ?, session_summary_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      room.sessionStartedAt,
      room.sessionEndsAt,
      room.sessionSummary ? JSON.stringify(room.sessionSummary) : null,
      Date.now(),
      room.id,
    )
  }
}

export const rooms = new RoomManager()
export { ROOM_CONFIG_RANGE }
