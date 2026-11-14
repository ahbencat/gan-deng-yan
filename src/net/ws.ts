// WS 客户端：信封封装、seq 递增、指数退避重连（1s×1.5 封顶 10s）、
// 4000（别处登录）/4001（未登录）特殊处理
import type { Envelope } from '../types.js'

const WS_ENVELOPE_VERSION = 1

export interface WsCallbacks {
  onMessage: (env: Envelope) => void
  onOpen: () => void
  /** code=4000 被踢；4001 未登录；null 表示主动关闭 */
  onClose: (code: number | null) => void
}

export class WsClient {
  private ws: WebSocket | null = null
  private seq = 1
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private manuallyClosed = false
  private cb: WsCallbacks

  constructor(cb: WsCallbacks) {
    this.cb = cb
  }

  connect(): void {
    this.manuallyClosed = false
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      this.cb.onOpen()
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        const env = JSON.parse(ev.data) as Envelope
        if (env && env.v === WS_ENVELOPE_VERSION && typeof env.type === 'string') {
          this.cb.onMessage(env)
        }
      } catch {
        // 忽略非法消息
      }
    }
    ws.onclose = (ev) => {
      this.ws = null
      if (this.manuallyClosed) {
        this.cb.onClose(null)
        return
      }
      if (ev.code === 4000 || ev.code === 4001) {
        this.cb.onClose(ev.code)
        return
      }
      this.cb.onClose(ev.code)
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose 会随后触发，由其负责重连
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.retryTimer) return
    const delay = Math.min(1000 * Math.pow(1.5, this.retry), 10_000)
    this.retry++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  send(type: string, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const env: Envelope = { v: WS_ENVELOPE_VERSION, type, seq: this.seq++, payload }
    this.ws.send(JSON.stringify(env))
    return true
  }

  close(): void {
    this.manuallyClosed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'client close')
      this.ws = null
    }
  }
}
