// WS 消息分发：信封解析 + 输入消毒 + 路由（服务端是信任边界，一切客户端输入在此消毒）
import type { WebSocket } from 'ws'
import { WS_ENVELOPE_VERSION, type BotLevel, type Decl, type Envelope } from '../../src/types.js'
import { extendSession, startGame } from '../gameSession.js'
import { logDelegate, logExtend } from '../gameLog.js'
import { pushLobby, pushRoomState } from '../notify.js'
import { rooms, sanitizeConfig } from '../roomManager.js'
import { getUserById, toPublic } from '../users.js'
import { hub } from './hub.js'

const MAX_MSG_BYTES = 8192

type Payload = Record<string, unknown>

function sendError(ws: WebSocket, code: string, message: string, seq?: number): void {
  hub.send(ws, 'error', { code, message, seq })
}

/** 连接建立：注册 + 下发 session（唯一恢复入口）+ 房间在线状态刷新 */
export function handleConnection(ws: WebSocket, userId: number): void {
  hub.register(ws, userId)
  ws.on('message', (data) => handleMessage(ws, data))
  ws.on('close', () => hub.unregister(ws))
  ws.on('error', () => hub.unregister(ws))

  sendSession(ws, userId)

  const room = rooms.getByUser(userId)
  if (room) pushRoomState(room)
}

/** 下发 session：user + room + 个性化对局快照 */
export function sendSession(ws: WebSocket, userId: number): void {
  const row = getUserById(userId)
  if (!row) return
  const room = rooms.getByUser(userId)
  hub.send(ws, 'session', {
    user: toPublic(row),
    room: room ? rooms.toState(room, hub.onlineUserIds()) : null,
    game: room?.session ? room.session.snapshotFor(userId) : null,
  })
}

export function handleMessage(ws: WebSocket, raw: unknown): void {
  const userId = hub.userIdOf(ws)
  if (userId == null) return

  const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : null
  if (text === null) return
  if (text.length > MAX_MSG_BYTES) {
    sendError(ws, 'MSG_TOO_BIG', '消息过大')
    return
  }
  if (!hub.rateLimit(ws)) {
    sendError(ws, 'RATE_LIMITED', '操作太频繁，请稍后再试')
    return
  }

  let env: Envelope<unknown>
  try {
    env = JSON.parse(text) as Envelope<unknown>
  } catch {
    sendError(ws, 'BAD_JSON', '消息格式错误')
    return
  }
  if (!env || env.v !== WS_ENVELOPE_VERSION || typeof env.type !== 'string') {
    sendError(ws, 'BAD_ENVELOPE', '消息格式错误')
    return
  }
  const seq = typeof env.seq === 'number' ? env.seq : undefined
  const payload: Payload =
    env.payload && typeof env.payload === 'object' && !Array.isArray(env.payload)
      ? (env.payload as Payload)
      : {}

  try {
    route(ws, userId, env.type, payload, seq)
  } catch (e) {
    console.error(`[dispatch] ${env.type} 处理异常:`, e)
    sendError(ws, 'INTERNAL', '服务器内部错误', seq)
  }
}

function route(ws: WebSocket, userId: number, type: string, payload: Payload, seq?: number): void {
  const row = getUserById(userId)
  if (!row) {
    ws.close(4001, '账号不存在')
    return
  }
  const user = toPublic(row)

  switch (type) {
    case 'ping': {
      hub.send(ws, 'pong', { serverTime: Date.now() })
      return
    }
    case 'lobby.list': {
      hub.send(ws, 'lobby.list', { rooms: rooms.list() })
      return
    }
    case 'room.create': {
      if (rooms.getByUser(userId)) {
        sendError(ws, 'IN_ROOM', '你已在房间中', seq)
        return
      }
      const config = sanitizeConfig(payload.config)
      if (!config) {
        sendError(ws, 'BAD_CONFIG', '房间配置非法', seq)
        return
      }
      const room = rooms.create(user, config)
      pushRoomState(room)
      pushLobby()
      return
    }
    case 'room.join': {
      const roomId = payload.roomId
      if (!Number.isInteger(roomId) || (roomId as number) <= 0) {
        sendError(ws, 'BAD_ROOM_ID', '房间号非法', seq)
        return
      }
      const r = rooms.join(roomId as number, user)
      if (!r.ok) {
        sendError(ws, 'JOIN_FAILED', r.error, seq)
        return
      }
      pushRoomState(r.room)
      pushLobby()
      return
    }
    case 'room.leave': {
      const r = rooms.leave(userId)
      if (!r.ok) {
        sendError(ws, 'LEAVE_FAILED', r.error, seq)
        return
      }
      if (!r.closed) {
        const room = rooms.get(r.roomId)
        if (room) pushRoomState(room)
      }
      pushLobby()
      return
    }
    case 'room.dissolve': {
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (room.hostUserId !== userId) {
        sendError(ws, 'NOT_HOST', '只有房主可以解散房间', seq)
        return
      }
      if (room.status !== 'waiting') {
        sendError(ws, 'NOT_WAITING', '对局进行中，不能解散房间', seq)
        return
      }
      // 先广播再关房：room.closed 含全体成员；closeRoom 清锚点后 pushLobby 才能触达他们
      const memberIds = rooms.memberIds(room)
      const roomId = room.id
      hub.broadcast(memberIds, 'room.closed', { roomId, reason: 'dissolved' })
      rooms.dissolve(roomId)
      pushLobby()
      return
    }
    case 'room.config': {
      const config = sanitizeConfig(payload.config)
      if (!config) {
        sendError(ws, 'BAD_CONFIG', '房间配置非法', seq)
        return
      }
      const r = rooms.updateConfig(userId, config)
      if (!r.ok) {
        sendError(ws, 'CONFIG_FAILED', r.error, seq)
        return
      }
      pushRoomState(r.room)
      pushLobby()
      return
    }
    case 'room.start': {
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (room.hostUserId !== userId) {
        sendError(ws, 'NOT_HOST', '只有房主可以开始游戏', seq)
        return
      }
      const r = startGame(room)
      if (!r.ok) {
        sendError(ws, 'START_FAILED', r.error, seq)
        return
      }
      pushRoomState(room)
      pushLobby()
      r.session.broadcastStart()
      return
    }
    case 'room.addBot': {
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (room.hostUserId !== userId) {
        sendError(ws, 'NOT_HOST', '只有房主可以添加电脑', seq)
        return
      }
      const level = sanitizeBotLevel(payload.level)
      if (level === null) {
        sendError(ws, 'BAD_BOT_LEVEL', '难度参数非法', seq)
        return
      }
      const r = rooms.addBot(room.id, level)
      if (!r.ok) {
        sendError(ws, 'ADD_BOT_FAILED', r.error, seq)
        return
      }
      pushRoomState(r.room)
      pushLobby()
      return
    }
    case 'room.removeBot': {
      const targetId = payload.userId
      if (!Number.isInteger(targetId) || (targetId as number) <= 0) {
        sendError(ws, 'BAD_USER_ID', '参数非法', seq)
        return
      }
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (room.hostUserId !== userId) {
        sendError(ws, 'NOT_HOST', '只有房主可以移除电脑', seq)
        return
      }
      const r = rooms.removeBot(room, targetId as number)
      if (!r.ok) {
        sendError(ws, 'REMOVE_BOT_FAILED', r.error, seq)
        return
      }
      pushRoomState(room)
      pushLobby()
      return
    }
    case 'game.play': {
      const session = getSession(userId)
      if (!session) return
      const cardIds = sanitizeCardIds(payload.cardIds)
      const decl = sanitizeDecl(payload.decl)
      if (!cardIds || !decl) {
        sendError(ws, 'BAD_MOVE', '出牌参数非法', seq)
        return
      }
      const r = session.play(userId, cardIds, decl, seq)
      if (!r.ok) sendError(ws, 'ILLEGAL_MOVE', r.error, r.seq)
      return
    }
    case 'game.pass': {
      const session = getSession(userId)
      if (!session) return
      const r = session.pass(userId, seq)
      if (!r.ok) sendError(ws, 'ILLEGAL_MOVE', r.error, r.seq)
      return
    }
    case 'game.sync': {
      const session = getSession(userId)
      if (!session) return
      session.sync(userId)
      return
    }
    case 'game.delegate': {
      const delegated = payload.delegated
      if (typeof delegated !== 'boolean') {
        sendError(ws, 'BAD_DELEGATE', '参数非法', seq)
        return
      }
      // 用 getByUser（非 getSession）：等待/局间也可切换托管；仅影响本人
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (delegated) room.delegated.add(userId)
      else room.delegated.delete(userId)
      logDelegate(room, userId, delegated)
      if (room.session) room.session.refresh()
      pushRoomState(room)
      return
    }
    case 'session.extend': {
      const minutes = payload.minutes
      if (typeof minutes !== 'number') {
        sendError(ws, 'BAD_EXTEND', '参数非法', seq)
        return
      }
      const room = rooms.getByUser(userId)
      if (!room) {
        sendError(ws, 'NOT_IN_ROOM', '你不在任何房间', seq)
        return
      }
      if (room.hostUserId !== userId) {
        sendError(ws, 'NOT_HOST', '只有房主可以加时', seq)
        return
      }
      const r = extendSession(room, minutes)
      if (!r.ok) {
        sendError(ws, 'EXTEND_FAILED', r.error, seq)
        return
      }
      logExtend(room, minutes)
      return
    }
    default:
      sendError(ws, 'UNKNOWN_TYPE', `未知消息类型: ${type}`, seq)
  }
}

/** 找到该用户所在对局的会话；不在局中则发错误并返回 null */
function getSession(userId: number) {
  const room = rooms.getByUser(userId)
  if (!room || !room.session || room.status !== 'playing') {
    sendErrorToUser(userId, 'NO_GAME', '当前没有进行中的对局')
    return null
  }
  return room.session
}

function sendErrorToUser(userId: number, code: string, message: string): void {
  hub.sendToUser(userId, 'error', { code, message })
}

// ---- 参数消毒 ----

function sanitizeCardIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) return null
  const ids: number[] = []
  const seen = new Set<number>()
  for (const v of raw) {
    if (!Number.isInteger(v)) return null
    const id = v as number
    if (seen.has(id)) return null
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/** 电脑难度：缺省 2（中级）；仅接受整数 1|2|3；其余返回 null（调用方报 BAD_BOT_LEVEL） */
function sanitizeBotLevel(raw: unknown): BotLevel | null {
  if (raw === undefined) return 2
  if (raw === 1 || raw === 2 || raw === 3) return raw
  return null
}

function sanitizeDecl(raw: unknown): Decl | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Payload
  const type = o.type
  const rank = o.rank
  if (!Number.isInteger(rank)) return null
  const r = rank as number
  if (r < 3 || r > 17) return null

  if (type === 'single' || type === 'pair') return { type, rank: r }
  if (type === 'straight' || type === 'pairChain' || type === 'bomb') {
    const length = o.length
    if (!Number.isInteger(length)) return null
    const l = length as number
    if (l < 2 || l > 16) return null
    return { type, rank: r, length: l }
  }
  return null
}
