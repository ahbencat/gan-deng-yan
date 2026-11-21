import {
  RANK_2,
  RANK_MIN,
  STATE_VERSION,
  isWild,
  type Card,
  type Decl,
  type GameState,
  type Play,
  type RoomConfig,
  type SeatMeta,
} from '../types.js'
import { buildBrainContext, type BotBrain } from './brain.js'
import { basicBrain } from './brains/basic.js'
import { dealShuffled } from './cards.js'
import { canForm } from './combo.js'
import type { Rng } from './rng.js'
import { canBeat, pickAutoPlay } from './rules.js'
import { bombMultiplier, settleGame } from './score.js'

/** 动作日志保留最近 N 条 */
export const LOG_LIMIT = 40

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string }

const fail = (error: string): ActionResult => ({ ok: false, error })

function trimLog(state: GameState): void {
  if (state.trick.log.length > LOG_LIMIT) {
    state.trick.log.splice(0, state.trick.log.length - LOG_LIMIT)
  }
}

/** 创建对局：庄家 6 张、闲家 5 张，剩余作公共牌堆 */
export function createGame(params: {
  gameId: number
  roomId: number
  config: RoomConfig
  seats: SeatMeta[]
  dealerSeat: number
  rng: Rng
  now: number
  /** 本场截止时刻；缺省 = 单局时长（引擎单测用） */
  endsAt?: number
}): GameState {
  const { gameId, roomId, config, seats, dealerSeat, rng, now, endsAt } = params
  const n = seats.length
  if (n < 2 || n > 8) throw new Error('玩家数须在 2~8 之间')
  if (dealerSeat < 0 || dealerSeat >= n) throw new Error('庄家座位越界')
  if (config.turnSeconds < 1 || config.gameMinutes < 1) throw new Error('配置非法')

  const { hands, pile } = dealShuffled(config.wildCount, n, dealerSeat, rng)
  return {
    v: STATE_VERSION,
    gameId,
    roomId,
    config,
    seats,
    dealerSeat,
    hands,
    pile,
    phase: 'playing',
    trick: {
      leaderSeat: dealerSeat,
      lastPlay: null,
      turnSeat: dealerSeat,
      turnDeadline: now + config.turnSeconds * 1000,
      log: [],
    },
    bombHistory: [],
    multiplier: 1,
    everPlayed: seats.map(() => false),
    startedAt: now,
    endsAt: endsAt ?? now + config.gameMinutes * 60_000,
    result: null,
    actionSeq: 0,
  }
}

/** 出牌：校验回合/持牌/牌型/压牌，应用后进入下一回合（出完即赢） */
export function applyPlay(
  state: GameState,
  seat: number,
  cardIds: number[],
  decl: Decl,
  now: number,
): ActionResult {
  if (state.phase !== 'playing') return fail('对局已结束')
  if (seat !== state.trick.turnSeat) return fail('还没轮到你出牌')
  if (!Array.isArray(cardIds) || cardIds.length === 0) return fail('没有选择要出的牌')

  const hand = state.hands[seat]
  const idSet = new Set(cardIds)
  if (idSet.size !== cardIds.length) return fail('选择的牌有重复')
  const selected: Card[] = hand.filter((c) => idSet.has(c.id))
  if (selected.length !== cardIds.length) return fail('有牌不在你手中')

  // 逃生单出：领出且手中仅剩 1 张百搭（假设，见 types.ts）
  const isEscape =
    state.trick.lastPlay === null &&
    selected.length === 1 &&
    isWild(selected[0].rank) &&
    hand.length === 1

  if (isEscape) {
    if (decl.type !== 'single') return fail('百搭单出须声明单张')
    if (decl.rank < RANK_MIN || decl.rank > RANK_2) return fail('声明点数越界')
  } else {
    if (!canForm(selected, decl)) return fail('牌型不合法')
    if (!canBeat(state.trick.lastPlay, { decl })) return fail('压不过上家的牌')
  }

  const next = structuredClone(state)
  next.hands[seat] = next.hands[seat].filter((c) => !idSet.has(c.id))
  const play: Play = { seat, cards: selected, decl }
  next.trick.lastPlay = play
  next.trick.log.push({ seat, kind: 'play', cards: selected, decl })
  trimLog(next)
  next.everPlayed[seat] = true
  next.actionSeq++

  if (decl.type === 'bomb') {
    next.bombHistory.push({ seat, rank: decl.rank, n: decl.length })
    next.multiplier *= bombMultiplier(decl.length)
  }

  // 出完即赢：立即终局，他人再无响应机会
  if (next.hands[seat].length === 0) {
    next.phase = 'finished'
    next.result = settleGame({
      seats: next.seats,
      hands: next.hands,
      everPlayed: next.everPlayed,
      multiplier: next.multiplier,
      winnerSeat: seat,
      reason: 'empty',
    })
    return { ok: true, state: next }
  }

  advanceTurn(next, now)
  return { ok: true, state: next }
}

/** 过牌：仅跟牌态可用；领出必须出牌 */
export function applyPass(state: GameState, seat: number, now: number): ActionResult {
  if (state.phase !== 'playing') return fail('对局已结束')
  if (seat !== state.trick.turnSeat) return fail('还没轮到你')
  if (state.trick.lastPlay === null) return fail('领出必须出牌，不能过')

  const next = structuredClone(state)
  next.trick.log.push({ seat, kind: 'pass' })
  trimLog(next)
  next.actionSeq++
  advanceTurn(next, now)
  return { ok: true, state: next }
}

/** 回合超时的自动动作：跟牌自动过；领出自动出最小合法牌（假设7） */
export function applyTimeout(state: GameState, now: number): ActionResult {
  if (state.phase !== 'playing') return fail('对局已结束')
  const seat = state.trick.turnSeat
  if (state.trick.lastPlay === null) {
    const { cards, decl } = pickAutoPlay(state.hands[seat])
    return applyPlay(state, seat, cards.map((c) => c.id), decl, now)
  }
  return applyPass(state, seat, now)
}

/**
 * 自动出牌（电脑/托管共用）：大脑 decide 产出意图 → applyPlay/applyPass 把关（输出不受信）。
 * 缺省 basicBrain 与旧行为逐字节一致：领出最小合法牌；跟牌尝试最小压牌，压不过过牌。
 * 非法输出/领出过牌意图均落入兜底，保证 onTimer 重挂循环不卡死。
 * 内部读 turnSeat（仿 applyTimeout）；applyTimeout 语义保持不变。
 */
export function applyAutoMove(state: GameState, now: number, brain: BotBrain = basicBrain): ActionResult {
  if (state.phase !== 'playing') return fail('对局已结束')
  const seat = state.trick.turnSeat
  const decision = brain.decide(buildBrainContext(state, seat))
  if (decision) {
    const r = applyPlay(state, seat, decision.cards.map((c) => c.id), decision.decl, now)
    if (r.ok) return r
    // 非法输出被 applyPlay 拒绝 → 落入兜底
  }
  if (state.trick.lastPlay !== null) return applyPass(state, seat, now)
  // 领出兜底（大脑返回 null / 非法牌）：最小合法牌
  const { cards, decl } = pickAutoPlay(state.hands[seat])
  return applyPlay(state, seat, cards.map((c) => c.id), decl, now)
}

/** 对局总时长到期：剩牌最少者赢，并列流局（假设3） */
export function settleTimeout(state: GameState): ActionResult {
  if (state.phase !== 'playing') return fail('对局已结束')

  const next = structuredClone(state)
  const counts = next.hands.map((h) => h.length)
  const min = Math.min(...counts)
  const leaders = counts.flatMap((c, i) => (c === min ? [i] : []))
  const winnerSeat = leaders.length === 1 ? leaders[0] : null

  next.phase = 'finished'
  next.result = settleGame({
    seats: next.seats,
    hands: next.hands,
    everPlayed: next.everPlayed,
    multiplier: next.multiplier,
    winnerSeat,
    reason: winnerSeat === null ? 'draw' : 'timeout',
  })
  next.actionSeq++
  return { ok: true, state: next }
}

/** 推进到下一回合；若转回最后出牌者 → 本轮结束（补1张并领出） */
function advanceTurn(state: GameState, now: number): void {
  const n = state.seats.length
  const nextSeat = (state.trick.turnSeat + 1) % n
  state.trick.turnSeat = nextSeat
  if (state.trick.lastPlay !== null && nextSeat === state.trick.lastPlay.seat) {
    endTrick(state, now)
  } else {
    state.trick.turnDeadline = now + state.config.turnSeconds * 1000
  }
}

/** 本轮无人接：最后出牌者从牌堆补1张（堆空跳过），成为新轮领出 */
function endTrick(state: GameState, now: number): void {
  const leader = state.trick.lastPlay!.seat
  if (state.pile.length > 0) {
    const card = state.pile.pop()!
    state.hands[leader].push(card)
    state.trick.log.push({ seat: leader, kind: 'draw', count: 1 })
    trimLog(state)
  }
  state.trick.leaderSeat = leader
  state.trick.lastPlay = null
  state.trick.turnSeat = leader
  state.trick.turnDeadline = now + state.config.turnSeconds * 1000
}
