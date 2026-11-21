// 入口：开库（db.ts 副作用）→ 恢复房间/对局 → Express(json/static/api) →
// http + ws upgrade 鉴权（HMAC cookie）→ listen
import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import {
  buildClearCookie,
  buildSetCookie,
  checkLoginRate,
  getTokenFromRequest,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.js'
import { adminRouter } from './admin.js'
import { ensureNpcUsers } from './npc.js'
import { restoreAll } from './restore.js'
import { findUserByUsername, getUserById, toPublic, touchLogin } from './users.js'
import { handleConnection } from './ws/dispatch.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3002)

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() })
})

// ---- 登录（关闭注册：账号仅由 scripts/user.ts 插入）----
app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'unknown'
  if (!checkLoginRate(ip)) {
    res.status(429).json({ error: '尝试太频繁，请稍后再试' })
    return
  }
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' })
    return
  }
  const row = findUserByUsername(username)
  if (!row || row.is_bot || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }
  touchLogin(row.id, Date.now())
  res.setHeader('Set-Cookie', buildSetCookie(signToken(row.id)))
  res.json({ user: toPublic(row) })
})

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', buildClearCookie())
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  const payload = verifyToken(getTokenFromRequest(req))
  if (!payload) {
    res.json({ user: null })
    return
  }
  const row = getUserById(payload.uid)
  res.json({ user: row ? toPublic(row) : null })
})

// ---- 管理员（独立 cookie 会话；页面公开、数据靠鉴权；管理员不参与游戏）----
app.use('/api/admin', adminRouter)
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'adminPage.html'))
})

// 生产模式托管前端构建产物（dev 模式由 vite 起 5174 并代理 /api、/ws）
const distDir = path.join(__dirname, '..', 'dist')
app.use(express.static(distDir))

// ---- 启动恢复 ----
ensureNpcUsers() // 先补齐 7 个固定 NPC 账号，再恢复房间（addBot 依赖花名册存在）
restoreAll()

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const payload = verifyToken(getTokenFromRequest({ headers: req.headers }))
  if (!payload || !getUserById(payload.uid)) {
    // 握手完成后立刻 close(4001)，让客户端能读到鉴权失败码
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.close(4001, '未登录或登录已过期')
    })
    return
  }
  const uid = payload.uid
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, uid)
  })
})

server.listen(PORT, () => {
  console.log(`[look_at_it] server listening on http://localhost:${PORT}`)
})
