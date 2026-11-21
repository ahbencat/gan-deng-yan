// 管理员 REST：.env 密码验证 → 独立 gdy_admin cookie 会话 → 生成/删除用户。
// 管理员没有 users 行、不参与游戏；与游戏路由/WS 完全分离。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router, type NextFunction, type Request, type Response } from 'express'
import {
  ADMIN_COOKIE_NAME,
  ADMIN_TTL_MS,
  buildClearCookie,
  buildSetCookie,
  checkAdminLoginRate,
  hashPassword,
  parseCookies,
  safeEqual,
  signAdminToken,
  verifyAdminToken,
} from './auth.js'
import { db } from './db.js'
import { rooms } from './roomManager.js'
import { hub } from './ws/hub.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- 管理密码：process.env.ADMIN_PASSWORD 优先，否则读项目根 .env ----
// 兼容 `admin_password: xxx`（现格式）与 `ADMIN_PASSWORD=xxx` 两种写法；启动时缓存。
let adminPassword: string | null = null

function loadAdminPassword(): void {
  if (process.env.ADMIN_PASSWORD) {
    adminPassword = process.env.ADMIN_PASSWORD
    return
  }
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:admin_password|ADMIN_PASSWORD)\s*[:=]\s*(.+?)\s*$/)
      if (m) {
        adminPassword = m[1]
        return
      }
    }
  } catch {
    // .env 不存在 → 未配置
  }
  adminPassword = null
}
loadAdminPassword()

export const adminRouter = Router()

function getAdminCookie(req: Request): string | null {
  return parseCookies(req.headers.cookie)[ADMIN_COOKIE_NAME] ?? null
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!verifyAdminToken(getAdminCookie(req))) {
    res.status(401).json({ error: '需要管理员登录' })
    return
  }
  next()
}

// POST /login —— 独立限速桶（5 次/分/IP），timingSafeEqual 比对
adminRouter.post('/login', (req, res) => {
  const ip = req.ip ?? 'unknown'
  if (!checkAdminLoginRate(ip)) {
    res.status(429).json({ error: '尝试太频繁，请稍后再试' })
    return
  }
  if (!adminPassword) {
    res.status(503).json({ error: '管理密码未配置（.env 的 admin_password）' })
    return
  }
  const { password } = (req.body ?? {}) as { password?: unknown }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: '请输入管理密码' })
    return
  }
  if (!safeEqual(password, adminPassword)) {
    res.status(401).json({ error: '管理密码错误' })
    return
  }
  res.setHeader('Set-Cookie', buildSetCookie(signAdminToken(), ADMIN_TTL_MS, ADMIN_COOKIE_NAME))
  res.json({ ok: true })
})

adminRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', buildClearCookie(ADMIN_COOKIE_NAME))
  res.json({ ok: true })
})

// GET /users —— 全量账号（含电脑）；绝不返回 password_hash
adminRouter.get('/users', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, username, nickname, score, games_played, wins, is_bot, created_at
       FROM users ORDER BY id`,
    )
    .all() as unknown as {
    id: number
    username: string
    nickname: string
    score: number
    games_played: number
    wins: number
    is_bot: number
    created_at: number
  }[]
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      nickname: r.nickname,
      score: r.score,
      gamesPlayed: r.games_played,
      wins: r.wins,
      isBot: !!r.is_bot,
      inRoom: rooms.getByUser(r.id) !== undefined,
      createdAt: r.created_at,
    })),
  })
})

// POST /users —— 生成账号（校验口径同 scripts/user.ts）
adminRouter.post('/users', requireAdmin, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const nicknameRaw = typeof body.nickname === 'string' ? body.nickname.trim() : ''
  if (!username || username.length > 32) {
    res.status(400).json({ error: '用户名需为 1~32 字' })
    return
  }
  if (password.length < 4 || password.length > 64) {
    res.status(400).json({ error: '密码需为 4~64 位' })
    return
  }
  const nickname = (nicknameRaw || username).slice(0, 32)
  const now = Date.now()
  try {
    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, nickname, score, games_played, wins, created_at)
         VALUES (?, ?, ?, 0, 0, 0, ?)`,
      )
      .run(username, hashPassword(password), nickname, now)
    res.json({
      user: {
        id: Number(result.lastInsertRowid),
        username,
        nickname,
        score: 0,
        gamesPlayed: 0,
        wins: 0,
        isBot: false,
        inRoom: false,
        createdAt: now,
      },
    })
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      res.status(409).json({ error: '用户名已存在' })
      return
    }
    throw e
  }
})

// DELETE /users/:id —— bot 与在房用户不可删；删除时踢掉其在线连接
adminRouter.delete('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '参数非法' })
    return
  }
  const row = db.prepare(`SELECT id, is_bot FROM users WHERE id = ?`).get(id) as
    | { id: number; is_bot: number }
    | undefined
  if (!row) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  if (row.is_bot) {
    // bot 只增不删：保住 game_players 历史与零和
    res.status(400).json({ error: '电脑账号不可删除' })
    return
  }
  // 在房间中不可删（room_players 外键 + 对局完整性）：内存权威 + DB 兜底（仅未关闭房间）
  const inRoom =
    rooms.getByUser(id) !== undefined ||
    db
      .prepare(
        `SELECT 1 FROM room_players rp JOIN rooms r ON r.id = rp.room_id
         WHERE rp.user_id = ? AND r.status != 'closed'`,
      )
      .get(id) !== undefined
  if (inRoom) {
    res.status(400).json({ error: '该玩家在房间中，不能删除' })
    return
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id)
  hub.kick(id, 4001, '账号已被管理员删除')
  res.json({ ok: true })
})
