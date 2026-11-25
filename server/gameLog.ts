// 对局 JSONL 日志：按「局」（本场 session）一文件，记录初始手牌与逐步出牌序，供复盘分析结算准确性。
// 文件：<日志目录>/room<roomId>_<YYYYMMDD-HHmmss>.jsonl，首行 session 元信息（本进程首次写入该文件时生成）。
// 日志目录默认跟随数据库落点（DB_PATH 同级 logs/），可用 GAME_LOG_DIR 覆盖；写失败只记 console，绝不影响对局。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameState } from '../src/types.js'
import type { Room } from './roomManager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 日志目录（惰性读取，便于测试覆盖 env） */
function logDir(): string {
  if (process.env.GAME_LOG_DIR) return process.env.GAME_LOG_DIR
  if (process.env.DB_PATH) return path.join(path.dirname(process.env.DB_PATH), 'logs')
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
  return path.join(dataDir, 'logs')
}

/** roomId → 当前本场文件路径（本场切换/重启后首条事件重新确认） */
const opened = new Map<number, string>()

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 确保本场文件存在（新文件先写 session 元信息行）；返回文件路径，本场未开局返回 null */
function fileFor(room: Room): string | null {
  const started = room.sessionStartedAt
  if (started == null) return null
  const fp = path.join(logDir(), `room${room.id}_${stamp(started)}.jsonl`)
  if (opened.get(room.id) === fp) return fp
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  if (!fs.existsSync(fp)) {
    const meta = {
      v: 1,
      type: 'session',
      roomId: room.id,
      sessionStartedAt: started,
      config: room.config,
      players: [...room.players.values()].map((pl) => ({
        userId: pl.userId,
        nickname: pl.nickname,
        seat: pl.seat,
        isBot: pl.isBot,
        botLevel: pl.botLevel ?? null,
      })),
    }
    fs.appendFileSync(fp, JSON.stringify(meta) + '\n')
  }
  opened.set(room.id, fp)
  return fp
}

function append(room: Room, ev: Record<string, unknown>): void {
  try {
    const fp = fileFor(room)
    if (!fp) return
    fs.appendFileSync(fp, JSON.stringify({ t: Date.now(), ...ev }) + '\n')
  } catch (e) {
    console.error('[gameLog] 写入失败:', e)
  }
}

/** 开局：本场文件与 game.start 行（含各家初始手牌） */
export function logGameStart(room: Room, state: GameState, gameId: number): void {
  append(room, {
    type: 'game.start',
    gameId,
    dealerSeat: state.dealerSeat,
    hands: state.hands.map((cards, seat) => ({ seat, cards })),
  })
}

export type MoveBy = 'manual' | 'bot' | 'delegate' | 'timeout'

/**
 * 引擎动作行：从 apply 后状态的 trick.log 尾部取本步（play/pass），
 * 若尾部是补牌行（本轮无人接）则一并记录。
 * trick.log 只裁前不裁后，最新条目必在尾部，不受 LOG_LIMIT 截断影响。
 */
export function logMove(room: Room, gameId: number, state: GameState, by: MoveBy): void {
  const log = state.trick.log
  const last = log[log.length - 1]
  if (!last) return
  const action = last.kind === 'draw' ? log[log.length - 2] : last
  if (action) {
    const who = state.seats[action.seat]
    const base = {
      gameId,
      seat: action.seat,
      userId: who?.userId ?? null,
      nickname: who?.nickname ?? null,
      by,
    }
    if (action.kind === 'play') {
      append(room, {
        type: 'play',
        ...base,
        cards: action.cards,
        decl: action.decl,
        bomb: action.decl.type === 'bomb',
        multiplier: state.multiplier,
      })
    } else {
      append(room, { type: 'pass', ...base })
    }
  }
  if (last.kind === 'draw') {
    const who = state.seats[last.seat]
    append(room, {
      type: 'draw',
      gameId,
      seat: last.seat,
      userId: who?.userId ?? null,
      nickname: who?.nickname ?? null,
      count: last.count,
    })
  }
}

/** 终局：game.over 行（结果 + 终盘手牌 + 本盘炸弹） */
export function logGameEnd(
  room: Room,
  gameId: number,
  state: GameState,
  hands: { seat: number; cards: unknown[] }[],
): void {
  append(room, {
    type: 'game.over',
    gameId,
    result: state.result,
    bombHistory: state.bombHistory,
    hands,
  })
}

/** 托管切换（本场未开局则跳过） */
export function logDelegate(room: Room, userId: number, delegated: boolean): void {
  const pl = room.players.get(userId)
  append(room, {
    type: 'delegate',
    userId,
    seat: pl?.seat ?? null,
    nickname: pl?.nickname ?? null,
    delegated,
  })
}

/** 加时（分析本场分数窗口用） */
export function logExtend(room: Room, minutes: number): void {
  append(room, { type: 'extend', minutes, sessionEndsAt: room.sessionEndsAt })
}
