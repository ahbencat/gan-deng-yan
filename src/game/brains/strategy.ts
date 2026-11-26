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

/**
 * 炸弹纪律：B2 威胁仅1张夺领出；B3 自己≤2且威胁≤2（B1 出完手由 finisher 先行）。
 * 倍率纪律：n≥4 的炸弹（bombMultiplier ≥ 4）只在「炸完剩 ≤1 张」时放行 —— 零和计分下倍率放大
 * 的是剩牌差，自己离出完还远时引爆只是把自身亏损一起放大（同长度下仍优先选小炸，见枚举排序）。
 */
export function bombOk(
  isBomb: boolean,
  bombLen: number,
  ctx: BotContext,
  th: { count: number },
): boolean {
  if (!isBomb) return true
  if (!(th.count === 1 || (ctx.hand.length <= 2 && th.count <= 2))) return false
  if (bombLen >= 4) return ctx.hand.length - bombLen <= 1
  return true
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
  return beats.filter((c) => bombOk(c.isBomb, c.decl.type === 'bomb' ? c.decl.length : 0, ctx, th))
}

/** 去掉已打出的牌（按 id 匹配） */
export function withoutCards(hand: Card[], played: Card[]): Card[] {
  const ids = new Set(played.map((c) => c.id))
  return hand.filter((c) => !ids.has(c.id))
}

/**
 * 结构性关门候选：不拆组即可压、且压完剩牌能一手出完（总步数 ≤2），保持 cost 序。
 * 值得动用 2/百搭抢领出；smart 取首个，expert 在其中再按 beatRisk 挑。
 */
export function closersOf(ctx: BotContext, aggressive: BeatCandidate[]): BeatCandidate[] {
  return aggressive.filter(
    (b) => !b.breaksSet && finisher(withoutCards(ctx.hand, b.cards), null) !== null,
  )
}

// ---- 领出候选 ----

export interface LeadCandidate {
  cards: Card[]
  decl: Decl
  /** 出牌只消费了牌组的一部分（留下残对/残炸） */
  breaksSet: boolean
  /** 窗口内单点最多张数（单/对 = 该点张数；顺/连对 = 窗口内最大点数张数） */
  maxGroup: number
  /** 用百搭补了 1 个缺口（顺子缺 1 点 / 连对缺 1 张） */
  usesWild: boolean
  /** 用到 2（通管特权 / 对2 / 炸2） */
  usesTwo: boolean
}

/**
 * 领出候选：天然牌为主；顺/连对允许用 1 张百搭补 1 个缺口（是否值得动用由 smart 层的纪律决定）。
 * 整手完胜走 finisher 的 enumerateDeclarations，不走这里。
 * breaksSet：从某点数组只取走一部分且有剩余 → 拆组。
 */
export function generateLeads(hand: Card[]): LeadCandidate[] {
  const { byRank, wilds } = groupByRank(hand)
  const out: LeadCandidate[] = []
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const countOf = (r: number): number => byRank.get(r)?.length ?? 0
  const takeN = (r: number, n: number): Card[] => (byRank.get(r) ?? []).slice(0, n)

  // 顺子：窗口内最多缺 1 点天然牌（用 1 张百搭补位），长度 ≥3，终点 ≤ A
  for (let start = RANK_MIN; start <= RANK_A; start++) {
    for (let len = 3; start + len - 1 <= RANK_A; len++) {
      let missing = 0
      let maxGroup = 0
      for (let r = start; r < start + len; r++) {
        const n = countOf(r)
        if (n === 0) missing++
        if (n > maxGroup) maxGroup = n
      }
      if (missing > 1 || (missing === 1 && wilds.length === 0)) continue
      const cards: Card[] = []
      for (let r = start; r < start + len; r++) cards.push(...takeN(r, 1))
      if (missing === 1) cards.push(wilds[0])
      out.push({
        cards,
        decl: { type: 'straight', rank: start, length: len },
        breaksSet: maxGroup > 1,
        maxGroup,
        usesWild: missing === 1,
        usesTwo: false,
      })
    }
  }

  // 连对：窗口内最多缺 1 张天然牌（同样只补 1 张百搭），对数 ≥2，终点 ≤ A
  for (let start = RANK_MIN; start <= RANK_A; start++) {
    for (let len = 2; start + len - 1 <= RANK_A; len++) {
      let missing = 0
      let maxGroup = 0
      for (let r = start; r < start + len; r++) {
        const n = countOf(r)
        if (n < 2) missing += 2 - n
        if (n > maxGroup) maxGroup = n
      }
      if (missing > 1 || (missing === 1 && wilds.length === 0)) continue
      const cards: Card[] = []
      for (let r = start; r < start + len; r++) cards.push(...takeN(r, 2))
      if (missing === 1) cards.push(wilds[0])
      out.push({
        cards,
        decl: { type: 'pairChain', rank: start, length: len },
        breaksSet: maxGroup > 2,
        maxGroup,
        usesWild: missing === 1,
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
        maxGroup: n,
        usesWild: false,
        usesTwo: r === RANK_2,
      })
    }
    // 单张
    out.push({
      cards: takeN(r, 1),
      decl: { type: 'single', rank: r },
      breaksSet: n > 1,
      maxGroup: n,
      usesWild: false,
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
