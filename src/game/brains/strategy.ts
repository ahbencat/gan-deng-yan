// 2/3 级大脑共享的候选生成与局面评估（纯函数，不依赖引擎状态转换）
// 候选输出仅供大脑排序挑选；最终合法性仍由 engine.applyPlay 把关（输出不受信）
import {
  RANK_2,
  RANK_A,
  RANK_MIN,
  isWild,
  type Card,
  type Decl,
  type Play,
} from '../../types.js'
import type { BotContext } from '../brain.js'
import { enumerateDeclarations, groupByRank } from '../combo.js'
import { beatCost, canBeat, pickAutoPlay, type BeatCandidate } from '../rules.js'

/** 威胁：剩牌最少的他家座位（并列取小座号）；无他家时 count=Infinity */
export function threat(ctx: BotContext): { seat: number; count: number } {
  let best = -1
  let bestCount = Infinity
  for (let i = 0; i < ctx.handCounts.length; i++) {
    if (i === ctx.seat) continue
    if (ctx.handCounts[i] < bestCount) {
      bestCount = ctx.handCounts[i]
      best = i
    }
  }
  return { seat: best, count: bestCount }
}

/** 炸弹纪律：B2 威胁仅1张夺领出；B3 自己≤2且威胁≤2（B1 出完手由 finisher 先行） */
export function bombOk(
  isBomb: boolean,
  ctx: BotContext,
  th: { count: number },
): boolean {
  if (!isBomb) return true
  return th.count === 1 || (ctx.hand.length <= 2 && th.count <= 2)
}

/** F3 拦截（威胁≤2 且上家=威胁）或 F4 竞跑（自己≤2）：smart 跟牌与 expert E3 共用闸门 */
export function interceptOrRace(
  ctx: BotContext,
  th: { seat: number; count: number },
  prev: Play,
): boolean {
  return (th.count <= 2 && prev.seat === th.seat) || ctx.hand.length <= 2
}

/** 拦截/竞跑放宽后的压牌候选（全压法经炸弹纪律过滤，保持 cost 序） */
export function aggressiveBeats(
  beats: BeatCandidate[],
  ctx: BotContext,
  th: { count: number },
): BeatCandidate[] {
  return beats.filter((c) => bombOk(c.isBomb, ctx, th))
}

// ---- 领出候选 ----

export interface LeadCandidate {
  cards: Card[]
  decl: Decl
  /** 出牌只消费了牌组的一部分（留下残对/残炸） */
  breaksSet: boolean
  /** 用到 2（通管特权 / 对2 / 炸2） */
  usesTwo: boolean
}

/**
 * 领出候选：只枚举天然牌（百搭留作储备；整手完胜走 finisher 的 enumerateDeclarations）。
 * breaksSet：从某点数组只取走一部分且有剩余 → 拆组。
 */
export function generateLeads(hand: Card[]): LeadCandidate[] {
  const { byRank } = groupByRank(hand)
  const out: LeadCandidate[] = []
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const countOf = (r: number): number => byRank.get(r)?.length ?? 0
  const takeN = (r: number, n: number): Card[] => (byRank.get(r) ?? []).slice(0, n)

  // 顺子：窗口内每点至少 1 张天然牌，长度 ≥3，终点 ≤ A
  for (let start = RANK_MIN; start <= RANK_A; start++) {
    for (let len = 3; start + len - 1 <= RANK_A; len++) {
      let ok = true
      let breaksSet = false
      for (let r = start; r < start + len; r++) {
        const n = countOf(r)
        if (n < 1) {
          ok = false
          break
        }
        if (n > 1) breaksSet = true
      }
      if (!ok) continue
      const cards: Card[] = []
      for (let r = start; r < start + len; r++) cards.push(...takeN(r, 1))
      out.push({
        cards,
        decl: { type: 'straight', rank: start, length: len },
        breaksSet,
        usesTwo: false,
      })
    }
  }

  // 连对：窗口内每点至少 2 张天然牌，对数 ≥2，终点 ≤ A
  for (let start = RANK_MIN; start <= RANK_A; start++) {
    for (let len = 2; start + len - 1 <= RANK_A; len++) {
      let ok = true
      let breaksSet = false
      for (let r = start; r < start + len; r++) {
        const n = countOf(r)
        if (n < 2) {
          ok = false
          break
        }
        if (n > 2) breaksSet = true
      }
      if (!ok) continue
      const cards: Card[] = []
      for (let r = start; r < start + len; r++) cards.push(...takeN(r, 2))
      out.push({
        cards,
        decl: { type: 'pairChain', rank: start, length: len },
        breaksSet,
        usesTwo: false,
      })
    }
  }

  for (const r of ranks) {
    const n = countOf(r)
    // 对子
    if (n >= 2) {
      out.push({
        cards: takeN(r, 2),
        decl: { type: 'pair', rank: r },
        breaksSet: n > 2,
        usesTwo: r === RANK_2,
      })
    }
    // 单张
    out.push({
      cards: takeN(r, 1),
      decl: { type: 'single', rank: r },
      breaksSet: n > 1,
      usesTwo: r === RANK_2,
    })
  }
  return out
}

// ---- 完胜候选 ----

/**
 * 整手一次出完（含百搭补位）：枚举整手全部合法声明，能领出/压过 prev 的取成本最低者。
 * 领出态另兜底逃生单出（仅剩 1 张百搭）。
 */
export function finisher(
  hand: Card[],
  prev: Play | null,
): { cards: Card[]; decl: Decl } | null {
  if (prev === null && hand.length === 1 && isWild(hand[0].rank)) {
    // 逃生单出：唯一能单出百搭的情形（与 pickAutoPlay 的全百搭逃生分支同源）
    return pickAutoPlay(hand)
  }
  const decls = enumerateDeclarations(hand)
  let best: { cards: Card[]; decl: Decl } | null = null
  let bestCost = Infinity
  for (const decl of decls) {
    if (prev !== null && !canBeat(prev, { decl })) continue
    const cost = beatCost(decl)
    if (cost < bestCost) {
      bestCost = cost
      best = { cards: hand, decl }
    }
  }
  return best
}
