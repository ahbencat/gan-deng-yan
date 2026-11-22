import type { Card, GameState, Play, SeatMeta } from '../../types.js'
import { STATE_VERSION, emptyRankTally } from '../../types.js'
import type { BotContext } from '../brain.js'

let counter = 1

/** 按牌点批量造牌（id 自增保证唯一；王 suit=4） */
export function mk(...ranks: number[]): Card[] {
  return ranks.map((rank) => ({ id: counter++, rank, suit: rank >= 16 ? 4 : 0 }))
}

/** 手动构造可玩的测试局面（默认 0 号位领出） */
export function baseState(
  hands: Card[][],
  overrides: Partial<GameState> = {},
): GameState {
  const n = hands.length
  const seats: SeatMeta[] = hands.map((_, i) => ({
    seat: i,
    userId: i + 1,
    nickname: `P${i + 1}`,
  }))
  const now = 0
  return {
    v: STATE_VERSION,
    gameId: 1,
    roomId: 1,
    config: { wildCount: 2, maxPlayers: n, turnSeconds: 30, gameMinutes: 10 },
    seats,
    dealerSeat: 0,
    hands,
    pile: [],
    phase: 'playing',
    trick: {
      leaderSeat: 0,
      lastPlay: null,
      turnSeat: 0,
      turnDeadline: now + 30_000,
      log: [],
    },
    bombHistory: [],
    multiplier: 1,
    everPlayed: seats.map(() => false),
    seenRanks: emptyRankTally(),
    startedAt: now,
    endsAt: now + 600_000,
    result: null,
    actionSeq: 0,
    ...overrides,
  }
}

/** 大脑测试共用：构造 BotContext（默认 0 号位单挑、百搭 2 张） */
export function ctxOf(
  hand: Card[],
  opts: {
    prev?: Play | null
    handCounts?: number[]
    seat?: number
    seenRanks?: number[]
    wildCount?: number
  } = {},
): BotContext {
  return {
    hand,
    prev: opts.prev ?? null,
    log: [],
    multiplier: 1,
    handCounts: opts.handCounts ?? [hand.length, 5],
    seat: opts.seat ?? 0,
    wildCount: opts.wildCount ?? 2,
    seenRanks: opts.seenRanks ?? emptyRankTally(),
  }
}

/** 大脑测试共用：他家打出的单张 */
export function single(rank: number, seat = 1): Play {
  return { seat, cards: mk(rank), decl: { type: 'single', rank } }
}
