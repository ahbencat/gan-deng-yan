// 2 级大脑（smart）：出牌策略 + 竞跑拦截
// 领出：完胜优先 → 威胁仅1张时领最难压单张 → 结构类别的序（顺/连对 > 孤张单 > 对 > 拆组单）
// 跟牌：完胜优先 → 干净最小压牌 → 拦截/竞跑时允许拆组与用2（炸弹按纪律）→ 否则过
// 落选兜底由 applyAutoMove 负责；输出不受信，仍经 applyPlay 校验
import { RANK_2, isWild, type Card, type Decl } from '../../types.js'
import type { BotBrain, BotContext } from '../brain.js'
import { beatCost, enumerateBeats, pickAutoPlay, type BeatCandidate } from '../rules.js'
import {
  aggressiveBeats,
  finisher,
  generateLeads,
  interceptOrRace,
  threat,
  type LeadCandidate,
} from './strategy.js'

function toLead(fin: { cards: Card[]; decl: Decl }): LeadCandidate {
  return {
    cards: fin.cards,
    decl: fin.decl,
    breaksSet: false,
    usesTwo: fin.decl.rank === RANK_2,
  }
}

function toBeat(fin: { cards: Card[]; decl: Decl }): BeatCandidate {
  const isBomb = fin.decl.type === 'bomb'
  return {
    cards: fin.cards,
    decl: fin.decl,
    usesWild: fin.cards.some((c) => isWild(c.rank)),
    breaksSet: false,
    isBomb,
    usesTwo: fin.decl.rank === RANK_2,
    cost: beatCost(fin.decl),
  }
}

/**
 * 领出候选（smart 策略序，首项即 smart 的选择）：
 * L1 完胜（整手，含百搭补位/逃生）→ L3 反竞跑单张 → L4 类别序。
 * L2 竞跑（手≤3）并入 L4 类别序：顺/连对本来就是最大甩牌，完胜由 L1 覆盖。
 * fin 可传入预计算完胜结果（expert 已算过则传入，避免重复枚举）。
 */
export function leadPlan(ctx: BotContext, fin?: { cards: Card[]; decl: Decl } | null): LeadCandidate[] {
  const f = fin === undefined ? finisher(ctx.hand, null) : fin
  if (f) return [toLead(f)]

  const cands = generateLeads(ctx.hand)
  const th = threat(ctx)
  const dedup = (pick: LeadCandidate): LeadCandidate[] => [
    pick,
    ...cands.filter((c) => c !== pick),
  ]

  // L3 反竞跑：威胁只剩 1 张 → 领最难压的单张（有2出2；否则不拆组的最大单张）
  if (th.count === 1) {
    const two = cands.find(
      (c) => c.decl.type === 'single' && c.decl.rank === RANK_2 && !c.breaksSet,
    )
    if (two) return dedup(two)
    const lones = cands.filter((c) => c.decl.type === 'single' && !c.breaksSet && !c.usesTwo)
    if (lones.length > 0) {
      let best = lones[0]
      for (const c of lones) if (c.decl.rank > best.decl.rank) best = c
      return dedup(best)
    }
    // 无可领的干净单张 → 落入 L4
  }

  // L4 类别序（均须 !usesTwo；拆组单只在前三类为空时兜底）
  const usable = cands.filter((c) => !c.usesTwo)
  const chains = usable
    .filter(
      (c) => !c.breaksSet && (c.decl.type === 'straight' || c.decl.type === 'pairChain'),
    )
    .sort((a, b) => b.cards.length - a.cards.length || a.decl.rank - b.decl.rank)
  const lones = usable
    .filter((c) => !c.breaksSet && c.decl.type === 'single')
    .sort((a, b) => a.decl.rank - b.decl.rank)
  const pairs = usable
    .filter((c) => !c.breaksSet && c.decl.type === 'pair')
    .sort((a, b) => a.decl.rank - b.decl.rank)
  const breaks = usable
    .filter((c) => c.breaksSet && c.decl.type === 'single')
    .sort((a, b) => a.decl.rank - b.decl.rank)
  return [...chains, ...lones, ...pairs, ...breaks]
}

/**
 * 跟牌选择（smart 策略序，返回 null = 过）：
 * F1 完胜 → F2 干净最小压牌（不拆组/不用王/不用2/非炸弹）
 * → F3 拦截（威胁≤2 且上家是威胁）或 F4 竞跑（手≤2）：允许拆组/用2，炸弹按纪律
 * → F5 过。fin 同 leadPlan：可传入预计算完胜结果。
 */
export function followPlan(
  ctx: BotContext,
  fin?: { cards: Card[]; decl: Decl } | null,
): BeatCandidate | null {
  const prev = ctx.prev
  if (!prev) return null
  const f = fin === undefined ? finisher(ctx.hand, prev) : fin
  if (f) return toBeat(f)

  const beats = enumerateBeats(ctx.hand, prev)
  const th = threat(ctx)

  // F2 干净最小压牌（enumerateBeats 已按 cost 升序，干净项保持该序）
  const clean = beats.filter((c) => !c.breaksSet && !c.usesWild && !c.usesTwo && !c.isBomb)
  if (clean.length > 0) return clean[0]

  // F3 拦截 / F4 竞跑：放宽到全部压法（炸弹按纪律过滤）
  if (interceptOrRace(ctx, th, prev)) {
    return aggressiveBeats(beats, ctx, th)[0] ?? null
  }
  return null
}

export const smartBrain: BotBrain = {
  id: 'smart',
  decide(ctx) {
    if (ctx.prev === null) {
      const plan = leadPlan(ctx)
      if (plan.length > 0) return { cards: plan[0].cards, decl: plan[0].decl }
      return pickAutoPlay(ctx.hand) // 全王手等退化情形
    }
    const pick = followPlan(ctx)
    return pick ? { cards: pick.cards, decl: pick.decl } : null
  },
}
