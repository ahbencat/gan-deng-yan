import type { GameResult, UserPublic } from '../src/types.js'
import { db, tx } from './db.js'

export interface UserRow {
  id: number
  username: string
  password_hash: string
  nickname: string
  score: number
  games_played: number
  wins: number
  current_room_id: number | null
  created_at: number
  last_login_at: number | null
}

const stmts = {
  byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
  setCurrentRoom: db.prepare('UPDATE users SET current_room_id = ? WHERE id = ?'),
  clearOrphanRooms: db.prepare('UPDATE users SET current_room_id = NULL WHERE current_room_id = ?'),
}

export function findUserByUsername(username: string): UserRow | undefined {
  return stmts.byUsername.get(username) as UserRow | undefined
}

export function getUserById(id: number): UserRow | undefined {
  return stmts.byId.get(id) as UserRow | undefined
}

export function toPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    score: row.score,
    gamesPlayed: row.games_played,
    wins: row.wins,
  }
}

export function touchLogin(userId: number, now: number): void {
  stmts.touchLogin.run(now, userId)
}

export function setCurrentRoom(userId: number, roomId: number | null): void {
  stmts.setCurrentRoom.run(roomId, userId)
}

/** 清理指向不存在房间的恢复锚点（恢复流程调用） */
export function clearCurrentRoomFor(roomId: number): void {
  stmts.clearOrphanRooms.run(roomId)
}

/**
 * 结算落库（一个事务）：
 * games 结果 + game_players 明细 + users 战绩分数 + rooms 回 waiting
 */
export function recordGameResult(params: {
  gameId: number
  roomId: number
  result: GameResult
  finishedAt: number
}): void {
  const { gameId, roomId, result, finishedAt } = params
  tx(() => {
    db.prepare(
      `UPDATE games SET status = 'finished', result_json = ?, finished_at = ? WHERE id = ?`,
    ).run(JSON.stringify(result), finishedAt, gameId)

    const ins = db.prepare(
      `INSERT INTO game_players (game_id, user_id, seat, remaining, ever_played, score_delta, is_winner)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const updUser = db.prepare(
      `UPDATE users SET score = score + ?, games_played = games_played + 1, wins = wins + ? WHERE id = ?`,
    )
    for (const p of result.perPlayer) {
      const isWinner = result.winnerSeat === p.seat ? 1 : 0
      ins.run(gameId, p.userId, p.seat, p.remaining, p.everPlayed ? 1 : 0, p.delta, isWinner)
      updUser.run(p.delta, isWinner, p.userId)
    }

    db.prepare(
      `UPDATE rooms SET status = 'waiting', last_result_json = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(result), finishedAt, roomId)
  })
}

/** 对局作废（版本门禁失败等）：不计分，房间回 waiting */
export function abandonGame(gameId: number, roomId: number, now: number): void {
  tx(() => {
    db.prepare(
      `UPDATE games SET status = 'abandoned', finished_at = ? WHERE id = ?`,
    ).run(now, gameId)
    db.prepare(`UPDATE rooms SET status = 'waiting', updated_at = ? WHERE id = ?`).run(now, roomId)
  })
}
