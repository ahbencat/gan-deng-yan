import { describe, expect, it } from 'vitest'
import { emptyRankTally } from '../../types.js'
import { expertBrain } from '../brains/expert.js'
import { smartBrain } from '../brains/smart.js'
import { ctxOf, mk, single } from './helpers.js'

/** seenRanks 构造：按 [rank, count] 对填充，其余为 0 */
function seen(pairs: Array<[number, number]>): number[] {
  const s = emptyRankTally()
  for (const [r, n] of pairs) s[r] = n
  return s
}

describe('expert 大脑（3级）', () => {
  it('记牌：2 全现 → A 为顶张优先领出（smart 领单8）', () => {
    const hand = mk(14, 5, 5, 8) // A,5,5,8
    const s = seen([[15, 4]]) // 4 张 2 全部已现
    const smart = smartBrain.decide(ctxOf(hand, { handCounts: [4, 6], seenRanks: s }))
    expect(smart!.decl).toEqual({ type: 'single', rank: 8 })

    const expert = expertBrain.decide(ctxOf(hand, { handCounts: [4, 6], seenRanks: s }))
    expect(expert).not.toBeNull()
    expect(expert!.decl).toEqual({ type: 'single', rank: 14 })
  })

  it('领出选 counter 残余最少的点数（6 全现 → 领5 不领3）', () => {
    const hand = mk(3, 5)
    const s = seen([[6, 4]]) // 6 全现 → 压5 的牌没了
    const smart = smartBrain.decide(ctxOf(hand, { handCounts: [2, 6], seenRanks: s }))
    expect(smart!.decl).toEqual({ type: 'single', rank: 3 })

    const expert = expertBrain.decide(ctxOf(hand, { handCounts: [2, 6], seenRanks: s }))
    expect(expert).not.toBeNull()
    expect(expert!.decl).toEqual({ type: 'single', rank: 5 })
  })

  it('长顺遇炸弹风险 + 威胁将出完 → 改出对子（smart 会领顺）', () => {
    const hand = mk(3, 4, 5, 7, 7)
    // 8/2 全现 → 对7 的 counter 与通管都没了（beatRisk 最低）；炸弹风险仍 ≥1
    const s = seen([
      [8, 4],
      [15, 4],
    ])
    const smart = smartBrain.decide(ctxOf(hand, { handCounts: [5, 2], seenRanks: s }))
    expect(smart!.decl).toEqual({ type: 'straight', rank: 3, length: 3 })

    const expert = expertBrain.decide(ctxOf(hand, { handCounts: [5, 2], seenRanks: s }))
    expect(expert).not.toBeNull()
    expect(expert!.decl).toEqual({ type: 'pair', rank: 7 })
  })

  it('拦截 1 张对手选最难反压的牌（[6,2] vs 单5 → 用 2 压）', () => {
    const d = expertBrain.decide(ctxOf(mk(6, 15), { prev: single(5), handCounts: [2, 1] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 15 })
    // smart 同局面用干净最小压牌（单6）——记牌拉开差距
    const s = smartBrain.decide(ctxOf(mk(6, 15), { prev: single(5), handCounts: [2, 1] }))
    expect(s!.decl).toEqual({ type: 'single', rank: 6 })
  })

  it('beatRisk 并列时保持 smart 排序（[3,5] 默认计数 → 与 smart 同选单3）', () => {
    const hand = mk(3, 5)
    const smart = smartBrain.decide(ctxOf(hand, { handCounts: [2, 6] }))
    const expert = expertBrain.decide(ctxOf(hand, { handCounts: [2, 6] }))
    expect(smart!.decl).toEqual({ type: 'single', rank: 3 })
    expect(expert).not.toBeNull()
    expect(expert!.decl).toEqual(smart!.decl)
  })
})
