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

  it('不拆对/不用2 压便宜单张 → 过（[6,6,2] vs 单5）', () => {
    const d = smartBrain.decide(ctxOf(mk(6, 6, 15), { prev: single(5), handCounts: [3, 5] }))
    expect(d).toBeNull()
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
