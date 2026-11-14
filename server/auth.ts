// 登录/会话：scrypt 密码哈希 + HMAC-SHA256 自签 token + httpOnly cookie
// 模式借鉴 zion_mission/auth.js（ESM 移植）；账号只由 scripts/user.ts 插入，无注册接口。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SECRET_FILE = process.env.SECRET_FILE || path.join(__dirname, '..', '.secret')

// ---- 签名密钥：环境变量优先，否则读/生成 .secret（0600，保留它以跨重启维持会话） ----
let TOKEN_SECRET: string
if (process.env.TOKEN_SECRET) {
  TOKEN_SECRET = process.env.TOKEN_SECRET
} else if (fs.existsSync(SECRET_FILE)) {
  TOKEN_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim()
  if (!TOKEN_SECRET) {
    TOKEN_SECRET = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(SECRET_FILE, TOKEN_SECRET, { mode: 0o600 })
  }
} else {
  TOKEN_SECRET = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(SECRET_FILE, TOKEN_SECRET, { mode: 0o600 })
  console.log('[auth] 已生成 .secret —— 保留该文件以跨重启维持登录会话')
}

export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
export const COOKIE_NAME = 'gdy_token'

// ---- 密码：scrypt（node:crypto，零依赖），存 "saltHex:hashHex" ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const idx = stored.indexOf(':')
  if (idx <= 0) return false
  const salt = stored.slice(0, idx)
  const hashHex = stored.slice(idx + 1)
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== 64) return false
  const candidate = crypto.scryptSync(password, salt, 64)
  return crypto.timingSafeEqual(candidate, expected)
}

// ---- HMAC 自签 token：payloadB64.sig（base64url）----
interface TokenPayload {
  uid: number
  exp: number
}

export function signToken(userId: number): string {
  const payload: TokenPayload = { uid: userId, exp: Date.now() + TOKEN_TTL_MS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyToken(token: string | null | undefined): { uid: number } | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url')
  const sigBuf = Buffer.from(sig, 'base64url')
  const expectedBuf = Buffer.from(expectedSig, 'base64url')
  if (sigBuf.length !== expectedBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload
    if (typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null
    if (Date.now() > payload.exp) return null
    return { uid: payload.uid }
  } catch {
    return null
  }
}

// ---- Cookie 解析/构造（不引 cookie-parser，手写够用）----
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export function getTokenFromRequest(req: {
  headers: Record<string, string | string[] | undefined>
}): string | null {
  const cookieHeader = req.headers.cookie
  const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : undefined)
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME]
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1]
  }
  return null
}

/** httpOnly cookie；局域网 http 部署，不加 Secure */
export function buildSetCookie(token: string, maxAgeMs = TOKEN_TTL_MS): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    maxAgeMs / 1000,
  )}`
}

export function buildClearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

// ---- 登录限速：每 IP 约 10 次/分钟 ----
const LOGIN_WINDOW_MS = 60_000
const LOGIN_MAX = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

export function checkLoginRate(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= LOGIN_MAX
}
