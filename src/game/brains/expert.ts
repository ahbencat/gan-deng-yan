// 3 级大脑（expert）：smart 策略 + 记牌推算修正
// E1 领出选未现压牌最少的候选（并列保持 smart 序）；E2 顶张（beatRisk=0）优先甩
// E3 拦截/竞跑压牌选暴露后最难被反压的打法；E4 竞跑遇炸弹风险时顺/连对降级
// 无信息（seenRanks 全 0 且计数无区分度）时与 smart 同序退化
import type { Decl } from '../../types.js'
import type { BotBrain } from '../brain.js'
import { enumerateBeats, pickAutoPlay } from '../rules.js'
import { bombRisk, beatRisk, unseenByRank } from './counting.js'
import { leadPlan, followPlan } from './smart.js'
import {
  aggressiveBeats,
  finisher,
  interceptOrRace,
  threat,
} from './strategy.js'

function pickMinRisk<T extends { decl: Decl }>(list: T[], risk: (d: Decl) => number): T {
  let best = list[0]
  let bestR = Infinity
  for (const c of list) {
    const r = risk(c.decl)
    if (r < bestR) {
      bestR = r
      best = c
      if (r === 0) break // E2：首个顶张即停（保持 smart 序中的第一个 0）
    }
  }
  return best
}

export const expertBrain: BotBrain = {
  id: 'expert',
  decide(ctx) {
    const u = unseenByRank(ctx)
    const bombR = bombRisk(u)
    const risk = (decl: Decl): number => beatRisk(decl, u, bombR)
    const th = threat(ctx)
    const fin = finisher(ctx.hand, ctx.prev)
    if (fin) return { cards: fin.cards, decl: fin.decl } // L1/F1 完胜钉死

    // ---- 领出 ----
    if (ctx.prev === null) {
      const plan = leadPlan(ctx, fin)
      if (plan.length === 0) return pickAutoPlay(ctx.hand)
      // E4：有炸弹风险且威胁 ≤2 张 → 顺/连对降到对/单之后（竞跑中不喂炸弹）
      let list = plan
      if (bombR >= 1 && th.count <= 2) {
        const chains = list.filter(
          (c) => c.decl.type === 'straight' || c.decl.type === 'pairChain',
        )
        const rest = list.filter(
          (c) => c.decl.type !== 'straight' && c.decl.type !== 'pairChain',
        )
        list = [...rest, ...chains]
      }
      // E2/E1：最小 beatRisk（0 顶张优先；并列保持 smart 序）
      const best = pickMinRisk(list, risk)
      return { cards: best.cards, decl: best.decl }
    }

    // ---- 跟牌 ----
    // E3：拦截/竞跑 → 全压法（炸弹按纪律）选 beatRisk 最小；并列保持 cost 序
    if (interceptOrRace(ctx, th, ctx.prev)) {
      const beats = aggressiveBeats(enumerateBeats(ctx.hand, ctx.prev), ctx, th)
      if (beats.length === 0) return null
      const best = pickMinRisk(beats, risk)
      return { cards: best.cards, decl: best.decl }
    }

    // 常规跟牌：与 smart 一致（干净最小压牌 / 过）
    const pick = followPlan(ctx, fin)
    return pick ? { cards: pick.cards, decl: pick.decl } : null
  },
}
