// 账号管理（唯一建号入口，游戏内无注册接口）：
//   tsx scripts/user.ts add <用户名> <密码> [昵称]
//   tsx scripts/user.ts passwd <用户名> <新密码>
import { hashPassword } from '../server/auth.js'
import { db } from '../server/db.js'

function usage(): never {
  console.log('用法:')
  console.log('  npm run user -- add <用户名> <密码> [昵称]')
  console.log('  npm run user -- passwd <用户名> <新密码>')
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'add') {
  const [username, password, nickname] = rest
  if (!username || !password || password.length < 4) usage()
  const now = Date.now()
  try {
    db.prepare(
      `INSERT INTO users (username, password_hash, nickname, score, games_played, wins, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?)`,
    ).run(username, hashPassword(password), nickname || username, now)
    console.log(`已创建账号: ${username}（昵称: ${nickname || username}）`)
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      console.error(`失败：用户名已存在 -> ${username}`)
      process.exit(1)
    }
    throw e
  }
} else if (cmd === 'passwd') {
  const [username, password] = rest
  if (!username || !password || password.length < 4) usage()
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: number }
    | undefined
  if (!row) {
    console.error(`失败：用户不存在 -> ${username}`)
    process.exit(1)
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id)
  console.log(`已更新密码: ${username}`)
} else {
  usage()
}
