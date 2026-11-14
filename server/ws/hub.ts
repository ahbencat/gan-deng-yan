// WS 连接注册表：同账号踢旧连接、按用户/房间广播、限速（借鉴 grand_strategy 思路）
import type { WebSocket } from 'ws'
import { WS_CLOSE_KICKED, type Envelope } from '../../src/types.js'

const RATE_WINDOW_MS = 1000
const RATE_MAX = 20 // 20 条/秒/连接

interface Conn {
  ws: WebSocket
  userId: number
  windowStart: number
  count: number
}

export class Hub {
  private byUser = new Map<number, Conn>()
  private byConn = new Map<WebSocket, Conn>()

  /** 注册连接；同账号旧连接被踢（close 4000） */
  register(ws: WebSocket, userId: number): void {
    const old = this.byUser.get(userId)
    if (old && old.ws !== ws) {
      try {
        old.ws.close(WS_CLOSE_KICKED, '账号已在别处登录')
      } catch {
        // 忽略关闭异常
      }
    }
    const conn: Conn = { ws, userId, windowStart: Date.now(), count: 0 }
    this.byUser.set(userId, conn)
    this.byConn.set(ws, conn)
  }

  unregister(ws: WebSocket): void {
    const conn = this.byConn.get(ws)
    if (!conn) return
    this.byConn.delete(ws)
    // 仅当仍指向本连接时才移除（防止误删同账号的新连接）
    if (this.byUser.get(conn.userId)?.ws === ws) {
      this.byUser.delete(conn.userId)
    }
  }

  userIdOf(ws: WebSocket): number | null {
    return this.byConn.get(ws)?.userId ?? null
  }

  isOnline(userId: number): boolean {
    return this.byUser.has(userId)
  }

  onlineUserIds(): Set<number> {
    return new Set(this.byUser.keys())
  }

  /** 连接级限速：超过 20 条/秒返回 false（调用方丢弃或报错） */
  rateLimit(ws: WebSocket): boolean {
    const conn = this.byConn.get(ws)
    if (!conn) return false
    const now = Date.now()
    if (now - conn.windowStart > RATE_WINDOW_MS) {
      conn.windowStart = now
      conn.count = 0
    }
    conn.count++
    return conn.count <= RATE_MAX
  }

  send(ws: WebSocket, type: string, payload: unknown): void {
    if (ws.readyState !== ws.OPEN) return
    const env: Envelope = { v: 1, type, payload }
    ws.send(JSON.stringify(env))
  }

  sendToUser(userId: number, type: string, payload: unknown): void {
    const conn = this.byUser.get(userId)
    if (conn) this.send(conn.ws, type, payload)
  }

  broadcast(userIds: Iterable<number>, type: string, payload: unknown): void {
    for (const uid of userIds) this.sendToUser(uid, type, payload)
  }
}

export const hub = new Hub()
