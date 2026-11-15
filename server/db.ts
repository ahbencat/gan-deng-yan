import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'game.db')

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA synchronous = NORMAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    current_room_id INTEGER,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('waiting','playing','closed')),
    config_json TEXT NOT NULL,
    last_result_json TEXT,
    session_ends_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_players (
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    seat INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id),
    UNIQUE (room_id, seat)
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    status TEXT NOT NULL CHECK(status IN ('playing','finished','abandoned')),
    config_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    result_json TEXT,
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER NOT NULL REFERENCES games(id),
    user_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    ever_played INTEGER NOT NULL,
    score_delta INTEGER NOT NULL,
    is_winner INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_games_room_status ON games(room_id, status);
  CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
`)

// 旧库迁移：本场截止时刻列
const roomCols = db.prepare('PRAGMA table_info(rooms)').all() as unknown as { name: string }[]
if (!roomCols.some((c) => c.name === 'session_ends_at')) {
  db.exec('ALTER TABLE rooms ADD COLUMN session_ends_at INTEGER')
}

/** 事务助手：失败自动回滚（node:sqlite 同步执行，单线程无竞态） */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
