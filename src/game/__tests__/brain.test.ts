import { describe, expect, it } from 'vitest'
import type { BotBrain } from '../brain.js'
import { applyAutoMove } from '../engine.js'
import { pickAutoPlay, pickBeatingPlay } from '../rules.js'
import { basicBrain } from '../brains/basic.js'
import { baseState, mk } from './helpers.js'
import { emptyRankTally } from '../../types.js'

describe('BotBrain 抽象', () => {
  it('basicBrain 领出 = pickAutoPlay，跟牌 = pickBeatingPlay（薄委托一致）', () => {
    const leadHand = mk(3, 4, 9)
    expect(
      basicBrain.decide({
        hand: leadHand,
        prev: null,
        log: [],
        multiplier: 1,
        handCounts: [3, 2],
        seat: 0,
        wildCount: 2,
        seenRanks: emptyRankTally(),
      }),
    ).toEqual(pickAutoPlay(leadHand))

    const followHand = mk(5, 9)
    const prev = { seat: 1, cards: mk(7), decl: { type: 'single' as const, rank: 7 } }
    expect(
      basicBrain.decide({
        hand: followHand,
        prev,
        log: [],
        multiplier: 1,
        handCounts: [2, 1],
        seat: 0,
        wildCount: 2,
        seenRanks: emptyRankTally(),
      }),
    ).toEqual(pickBeatingPlay(followHand, prev))
  })

  it('applyAutoMove 缺省大脑与显式 basicBrain 决策一致', () => {
    // 同一手牌构造两份状态（applyAutoMove 不改入参，可安全复用 hands）
    const leadHands = [mk(3, 4), mk(9)]
    expect(applyAutoMove(baseState(leadHands), 1000)).toEqual(
      applyAutoMove(baseState(leadHands), 1000, basicBrain),
    )

    const beatHands = [mk(4), mk(9)]
    const beatPrev = { seat: 1, cards: mk(3), decl: { type: 'single' as const, rank: 3 } }
    const beatState = () =>
      baseState(beatHands, {
        trick: {
          leaderSeat: 1,
          lastPlay: beatPrev,
          turnSeat: 0,
          turnDeadline: 0,
          log: [],
        },
      })
    expect(applyAutoMove(beatState(), 1000)).toEqual(
      applyAutoMove(beatState(), 1000, basicBrain),
    )

    const passHands = [mk(3, 4), mk(9)]
    const passPrev = { seat: 1, cards: mk(10), decl: { type: 'single' as const, rank: 10 } }
    const passState = () =>
      baseState(passHands, {
        trick: {
          leaderSeat: 1,
          lastPlay: passPrev,
          turnSeat: 0,
          turnDeadline: 0,
          log: [],
        },
      })
    expect(applyAutoMove(passState(), 1000)).toEqual(
      applyAutoMove(passState(), 1000, basicBrain),
    )
  })

  it('非法大脑输出被 applyPlay 拒绝 → 兜底仍出合法牌（不卡死）', () => {
    const garbage: BotBrain = {
      id: 'garbage',
      decide: () => ({ cards: [mk(99)[0]], decl: { type: 'single', rank: 3 } }),
    }
    const r = applyAutoMove(baseState([mk(3, 4), mk(9)]), 1000, garbage)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay?.cards[0]?.rank).toBe(3) // 兜底 = pickAutoPlay 最小自然单
    expect(r.state.trick.log.at(-1)?.kind).toBe('play')
  })

  it('领出态大脑返回 null（非法过牌意图）→ 兜底出牌', () => {
    const passOnLead: BotBrain = { id: 'pass-lead', decide: () => null }
    const r = applyAutoMove(baseState([mk(3, 4), mk(9)]), 1000, passOnLead)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.log.at(-1)).toEqual(
      expect.objectContaining({ kind: 'play', seat: 0 }),
    )
  })

  it('跟牌态大脑返回 null → 过牌（与 basic 压不过时一致）', () => {
    const alwaysPass: BotBrain = { id: 'pass', decide: () => null }
    const hands = [mk(4), mk(9)]
    const prev = { seat: 1, cards: mk(3), decl: { type: 'single' as const, rank: 3 } }
    const state = () =>
      baseState(hands, {
        trick: {
          leaderSeat: 1,
          lastPlay: prev,
          turnSeat: 0,
          turnDeadline: 0,
          log: [],
        },
      })
    const r = applyAutoMove(state(), 1000, alwaysPass)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.log.at(-1)).toEqual({ seat: 0, kind: 'pass' })
  })
})
