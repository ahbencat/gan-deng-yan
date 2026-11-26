import { describe, expect, it } from 'vitest'
import { getBrain } from '../brain.js'
import { applyAutoMove } from '../engine.js'
import type { Play } from '../../types.js'
import { basicBrain } from '../brains/basic.js'
import { smartBrain } from '../brains/smart.js'
import { baseState, ctxOf, mk, single } from './helpers.js'

describe('smart 大脑（2级）', () => {
  // ---- 领出 ----

  it('领出拆长弱结构：4567 顺，不动对3/单2', () => {
    const d = smartBrain.decide(ctxOf(mk(3, 3, 4, 5, 6, 7, 15), { handCounts: [7, 6] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'straight', rank: 4, length: 4 })
    expect(d!.cards.map((c) => c.rank).sort()).toEqual([4, 5, 6, 7])
  })

  it('无结构领孤张最小单，保留对子（[5,5,8] → 单8 不拆对）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 5, 8), { handCounts: [3, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 8 })
  })

  it('拆一对的顺子放行：留一张单换一次甩 3 张（[5,5,6,7] → 顺5-7）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 5, 6, 7), { handCounts: [4, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'straight', rank: 5, length: 3 })
  })

  it('不拆三条领顺子（[5,5,5,6,7] 保 3 炸潜力 → 单6）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 5, 5, 6, 7), { handCounts: [5, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 6 })
  })

  it('百搭补位顺子一次甩 5 张（[5,6,8,9,小王,J] → 顺5-9）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 6, 8, 9, 16, 11), { handCounts: [6, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'straight', rank: 5, length: 5 })
    expect(d!.cards.map((c) => c.rank)).toContain(16)
  })

  it('百搭纪律：手牌 7 张不为 3 张补顺烧百搭（[5,6,小王,9,10,K,A] 仅 3 张补顺 → 单5）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 6, 16, 9, 10, 14, 13), { handCounts: [7, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 5 })
  })

  it('百搭纪律：手牌 ≤6 张时允许 3 张补顺止损（[5,6,小王,9,10,K] → 顺4-6）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 6, 16, 9, 10, 13), { handCounts: [6, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'straight', rank: 4, length: 3 })
    expect(d!.cards.map((c) => c.rank)).toContain(16)
  })

  it('百搭补位连对（[5,5,6,小王,9] → 连对5×2）', () => {
    const d = smartBrain.decide(ctxOf(mk(5, 5, 6, 16, 9), { handCounts: [5, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'pairChain', rank: 5, length: 2 })
    expect(d!.cards.map((c) => c.rank)).toContain(16)
  })

  it('一手出完优先：两手对子直接领出获胜', () => {
    const d = smartBrain.decide(ctxOf(mk(7, 7)))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'pair', rank: 7 })

    const r = applyAutoMove(baseState([mk(7, 7), mk(9)]), 1000, smartBrain)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
  })

  it('对 1 张对手领出最难压的单张（有 2 出 2）', () => {
    const d = smartBrain.decide(ctxOf(mk(15, 9, 10), { handCounts: [3, 1] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 15 })
  })

  // ---- 跟牌 ----

  it('干净最小单张跟进不拆牌（[6,8,8] vs 单5 → 单6）', () => {
    const d = smartBrain.decide(ctxOf(mk(6, 8, 8), { prev: single(5), handCounts: [3, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 6 })
  })

  it('不拆对/不为白费功夫用2 压便宜单张 → 过（[6,6,2,9] vs 单5）', () => {
    const d = smartBrain.decide(ctxOf(mk(6, 6, 15, 9), { prev: single(5), handCounts: [4, 5] }))
    expect(d).toBeNull()
  })

  it('结构性竞跑：用 2 压 A 后剩一手对子 → 压（[2,6,6] vs 单A）', () => {
    const d = smartBrain.decide(ctxOf(mk(15, 6, 6), { prev: single(14), handCounts: [3, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 15 })
  })

  it('结构性竞跑：百搭补对压后剩一手顺子 → 压（[5,小王,9,10,J] vs 对4）', () => {
    const prev: Play = { seat: 1, cards: mk(4, 4), decl: { type: 'pair', rank: 4 } }
    const d = smartBrain.decide(ctxOf(mk(5, 16, 9, 10, 11), { prev, handCounts: [5, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'pair', rank: 5 })
    expect(d!.cards.map((c) => c.rank)).toContain(16)
  })

  it('关门优先于省牌：干净单6不停手、用2压完剩顺子（[6,2,7,8,9] vs 单5 → 单2）', () => {
    const d = smartBrain.decide(ctxOf(mk(6, 15, 7, 8, 9), { prev: single(5), handCounts: [5, 5] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 15 })
  })

  it('关瞪瞪止损：从未出过牌 → 拆对也要出（[6,6,2,9] vs 单5 → 单6）', () => {
    const d = smartBrain.decide(
      ctxOf(mk(6, 6, 15, 9), { prev: single(5), handCounts: [4, 5], everPlayed: false }),
    )
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 6 })
  })

  it('关瞪瞪止损不毁炸：宁用 2 也不拆三条（[5,5,5,2,9] vs 单4 → 单2）', () => {
    const d = smartBrain.decide(
      ctxOf(mk(5, 5, 5, 15, 9), { prev: single(4), handCounts: [5, 5], everPlayed: false }),
    )
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'single', rank: 15 })
  })

  it('不炸便宜单张（[4,4,4,9] vs 单3，威胁 5 张 → 过）', () => {
    const d = smartBrain.decide(ctxOf(mk(4, 4, 4, 9), { prev: single(3), handCounts: [4, 5] }))
    expect(d).toBeNull()
  })

  it('拦截：1 张对手且只有炸弹能压 → 炸弹夺回领出（非完胜）', () => {
    const d = smartBrain.decide(
      ctxOf(mk(4, 4, 4, 9), { prev: single(15), handCounts: [4, 1] }),
    )
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'bomb', rank: 4, length: 3 })
  })

  it('倍率纪律：离出完还远时不引 4 张炸（手牌 6 张 → 过）', () => {
    const prev: Play = { seat: 1, cards: mk(3, 3, 3, 3), decl: { type: 'bomb', rank: 3, length: 4 } }
    const d = smartBrain.decide(ctxOf(mk(4, 4, 4, 4, 9, 6), { prev, handCounts: [6, 1] }))
    expect(d).toBeNull()
  })

  it('倍率纪律：炸完只剩 1 张时仍可压（手牌 5 张 → 4 张炸）', () => {
    const prev: Play = { seat: 1, cards: mk(3, 3, 3, 3), decl: { type: 'bomb', rank: 3, length: 4 } }
    const d = smartBrain.decide(ctxOf(mk(4, 4, 4, 4, 9), { prev, handCounts: [5, 1] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'bomb', rank: 4, length: 4 })
  })

  it('压顺子：有天然 counter → 出同长顺', () => {
    const prev: Play = {
      seat: 1,
      cards: mk(3, 4, 5),
      decl: { type: 'straight', rank: 3, length: 3 },
    }
    const d = smartBrain.decide(ctxOf(mk(4, 5, 6, 9), { prev, handCounts: [4, 4] }))
    expect(d).not.toBeNull()
    expect(d!.decl).toEqual({ type: 'straight', rank: 4, length: 3 })
  })

  // ---- 注册表 ----

  it('getBrain 已注册 smart/expert，未知 id 回退 basic', () => {
    expect(getBrain('smart').id).toBe('smart')
    expect(getBrain('expert').id).toBe('expert')
    expect(getBrain('no-such-brain')).toBe(basicBrain)
  })
})
