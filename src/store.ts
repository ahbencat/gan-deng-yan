// 全局状态：登录/大厅/房间/对局 + 所有 server 消息的处理器
import { reactive } from 'vue'
import type {
  Card,
  Envelope,
  GameResult,
  GameSnapshot,
  PublicGameState,
  RoomListEntry,
  RoomState,
  UserPublic,
} from './types.js'
import { apiMe } from './net/api.js'
import { WsClient } from './net/ws.js'

export type Phase = 'boot' | 'login' | 'lobby' | 'room' | 'game'
export type Connection = 'connecting' | 'online' | 'reconnecting'

interface Store {
  phase: Phase
  user: UserPublic | null
  room: RoomState | null
  game: GameSnapshot | null
  lobbyRooms: RoomListEntry[]
  connection: Connection
  /** 被踢（4000）或会话失效（4001）时的提示 */
  authMessage: string | null
  lastError: string | null
  /** 终局结果（game.over）；点「返回房间」后清空 */
  result: GameResult | null
  allHands: { seat: number; cards: Card[] }[] | null
  /** 服务端时钟偏移：serverNow ≈ Date.now() + clockOffset */
  clockOffset: number
  pendingHand: { seat: number; hand: Card[] } | null
}

export const store = reactive<Store>({
  phase: 'boot',
  user: null,
  room: null,
  game: null,
  lobbyRooms: [],
  connection: 'connecting',
  authMessage: null,
  lastError: null,
  result: null,
  allHands: null,
  clockOffset: 0,
  pendingHand: null,
})

let ws: WsClient | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null

export function serverNow(): number {
  return Date.now() + store.clockOffset
}

// ---- 连接管理 ----

export function connect(): void {
  if (ws) return
  store.connection = 'connecting'
  store.authMessage = null
  ws = new WsClient({
    onMessage: handleMessage,
    onOpen: () => {
      store.connection = 'online'
      sendPing()
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(sendPing, 30_000)
    },
    onClose: (code) => {
      if (code === 4000) {
        teardownWs()
        store.phase = 'login'
        store.authMessage = '账号已在别处登录'
        resetSession()
      } else if (code === 4001) {
        teardownWs()
        store.phase = 'login'
        store.authMessage = '登录已过期，请重新登录'
        resetSession()
      } else if (code === null) {
        // 主动关闭（登出）
      } else {
        store.connection = 'reconnecting'
      }
    },
  })
  ws.connect()
}

export function disconnect(): void {
  teardownWs()
}

function teardownWs(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
}

function resetSession(): void {
  store.user = null
  store.room = null
  store.game = null
  store.result = null
  store.allHands = null
  store.lobbyRooms = []
  store.pendingHand = null
}

function sendPing(): void {
  ws?.send('ping', {})
}

export function send(type: string, payload: unknown): void {
  if (!ws?.send(type, payload)) {
    store.lastError = '连接已断开，正在重连…'
  }
}

// ---- 启动：REST 恢复登录态 ----

export async function boot(): Promise<void> {
  try {
    const user = await apiMe()
    if (user) {
      store.user = user
      store.phase = 'boot'
      connect()
      return
    }
  } catch {
    // 网络错误也落到登录页
  }
  store.phase = 'login'
}

// ---- 消息处理 ----

function handleMessage(env: Envelope): void {
  switch (env.type) {
    case 'pong': {
      const p = env.payload as { serverTime: number }
      store.clockOffset = p.serverTime - Date.now()
      return
    }
    case 'error': {
      const p = env.payload as { message: string }
      store.lastError = p.message
      setTimeout(() => {
        if (store.lastError === p.message) store.lastError = null
      }, 4000)
      return
    }
    case 'session': {
      const p = env.payload as {
        user: UserPublic
        room: RoomState | null
        game: GameSnapshot | null
      }
      store.user = p.user
      store.room = p.room
      store.game = p.game
      store.result = null
      store.allHands = null
      if (p.room && p.game && p.game.public.phase === 'playing') {
        store.phase = 'game'
      } else if (p.room) {
        store.phase = 'room'
      } else {
        store.phase = 'lobby'
        send('lobby.list', {})
      }
      return
    }
    case 'lobby.list': {
      const p = env.payload as { rooms: RoomListEntry[] }
      store.lobbyRooms = p.rooms
      return
    }
    case 'room.state': {
      store.room = env.payload as RoomState
      // 对局开始时 room.state(playing) 先到，game.state 会把 phase 切到 game
      if (store.room.status === 'closed') {
        store.room = null
        store.game = null
        store.phase = 'lobby'
        send('lobby.list', {})
      }
      return
    }
    case 'room.closed': {
      store.room = null
      store.game = null
      store.phase = 'lobby'
      send('lobby.list', {})
      return
    }
    case 'game.state': {
      const pub = env.payload as PublicGameState
      const you =
        store.game?.you ??
        (store.pendingHand
          ? { seat: store.pendingHand.seat, hand: store.pendingHand.hand }
          : { seat: -1, hand: [] })
      store.pendingHand = null
      store.game = { public: pub, you }
      store.result = null
      store.allHands = null
      store.phase = 'game'
      return
    }
    case 'game.hand': {
      const p = env.payload as { seat: number; hand: Card[] }
      if (store.game) {
        store.game.you = { seat: p.seat, hand: p.hand }
      } else {
        store.pendingHand = p
      }
      return
    }
    case 'game.over': {
      const p = env.payload as { result: GameResult; hands: { seat: number; cards: Card[] }[] }
      store.result = p.result
      store.allHands = p.hands
      store.phase = 'game'
      return
    }
    default:
      return
  }
}

// ---- 动作 ----

export function clearError(): void {
  store.lastError = null
}

export function dismissResult(): void {
  store.result = null
  store.allHands = null
  store.phase = 'room'
}
