import { describe, expect, it } from 'vitest'
import { RANK_2, type Decl, type Play } from '../../types.js'
import { canBeat, pickAutoPlay } from '../rules.js'
import { mk } from './helpers.js'

const play = (decl: Decl): Play => ({ seat: 1, cards: [], decl })

describe('canBeat 领出', () => {
  it('领出时任意合法牌型可出', () => {
    expect(canBeat(null, { decl: { type: 'single', rank: 3 } })).toBe(true)
    expect(canBeat(null, { decl: { type: 'bomb', rank: 7, length: 3 } })).toBe(true)
  })
})

describe('canBeat 单张与2通管', () => {
  it('正好大1可压', () => {
    expect(canBeat(play({ type: 'single', rank: 3 }), { decl: { type: 'single', rank: 4 } })).toBe(true)
  })
  it('越级不可压', () => {
    expect(canBeat(play({ type: 'single', rank: 3 }), { decl: { type: 'single', rank: 5 } })).toBe(false)
  })
  it('单2可压任意非2单张（通管）', () => {
    expect(canBeat(play({ type: 'single', rank: 3 }), { decl: { type: 'single', rank: RANK_2 } })).toBe(true)
    expect(canBeat(play({ type: 'single', rank: 14 }), { decl: { type: 'single', rank: RANK_2 } })).toBe(true)
  })
  it('单2不能被压，也不能被另一个2压', () => {
    expect(canBeat(play({ type: 'single', rank: RANK_2 }), { decl: { type: 'single', rank: 3 } })).toBe(false)
    expect(canBeat(play({ type: 'single', rank: RANK_2 }), { decl: { type: 'single', rank: RANK_2 } })).toBe(false)
  })
  it('单A只能被2或炸弹压', () => {
    expect(canBeat(play({ type: 'single', rank: 14 }), { decl: { type: 'single', rank: 13 } })).toBe(false)
    expect(canBeat(play({ type: 'single', rank: 14 }), { decl: { type: 'bomb', rank: 7, length: 3 } })).toBe(true)
  })
})

describe('canBeat 对子', () => {
  it('正好大1可压', () => {
    expect(canBeat(play({ type: 'pair', rank: 6 }), { decl: { type: 'pair', rank: 7 } })).toBe(true)
  })
  it('越级不可压', () => {
    expect(canBeat(play({ type: 'pair', rank: 6 }), { decl: { type: 'pair', rank: 8 } })).toBe(false)
  })
  it('对2可压任意非2对子（通管）', () => {
    expect(canBeat(play({ type: 'pair', rank: 14 }), { decl: { type: 'pair', rank: RANK_2 } })).toBe(true)
    expect(canBeat(play({ type: 'pair', rank: RANK_2 }), { decl: { type: 'pair', rank: 3 } })).toBe(false)
  })
})

describe('canBeat 顺子与连对', () => {
  it('同长度正好大1可压', () => {
    expect(
      canBeat(play({ type: 'straight', rank: 3, length: 3 }), {
        decl: { type: 'straight', rank: 4, length: 3 },
      }),
    ).toBe(true)
    expect(
      canBeat(play({ type: 'pairChain', rank: 3, length: 2 }), {
        decl: { type: 'pairChain', rank: 4, length: 2 },
      }),
    ).toBe(true)
  })
  it('长度不同不可压', () => {
    expect(
      canBeat(play({ type: 'straight', rank: 3, length: 3 }), {
        decl: { type: 'straight', rank: 4, length: 4 },
      }),
    ).toBe(false)
  })
  it('越级不可压', () => {
    expect(
      canBeat(play({ type: 'straight', rank: 3, length: 3 }), {
        decl: { type: 'straight', rank: 5, length: 3 },
      }),
    ).toBe(false)
  })
  it('牌型不同不可压', () => {
    expect(
      canBeat(play({ type: 'straight', rank: 3, length: 3 }), { decl: { type: 'pair', rank: 4 } }),
    ).toBe(false)
  })
})

describe('canBeat 炸弹', () => {
  it('炸弹可压任意非炸弹', () => {
    expect(canBeat(play({ type: 'single', rank: RANK_2 }), { decl: { type: 'bomb', rank: 3, length: 3 } })).toBe(true)
    expect(canBeat(play({ type: 'straight', rank: 3, length: 3 }), { decl: { type: 'bomb', rank: 3, length: 3 } })).toBe(true)
    expect(canBeat(play({ type: 'pair', rank: RANK_2 }), { decl: { type: 'bomb', rank: 3, length: 3 } })).toBe(true)
  })
  it('非炸弹压不了炸弹', () => {
    expect(canBeat(play({ type: 'bomb', rank: 3, length: 3 }), { decl: { type: 'single', rank: RANK_2 } })).toBe(false)
    expect(canBeat(play({ type: 'bomb', rank: 3, length: 3 }), { decl: { type: 'pair', rank: 4 } })).toBe(false)
  })
  it('炸弹互压：张数多者胜', () => {
    expect(
      canBeat(play({ type: 'bomb', rank: 7, length: 3 }), { decl: { type: 'bomb', rank: 3, length: 4 } }),
    ).toBe(true)
    expect(
      canBeat(play({ type: 'bomb', rank: 3, length: 4 }), { decl: { type: 'bomb', rank: 7, length: 3 } }),
    ).toBe(false)
  })
  it('同张数比点数', () => {
    expect(
      canBeat(play({ type: 'bomb', rank: 7, length: 3 }), { decl: { type: 'bomb', rank: 8, length: 3 } }),
    ).toBe(true)
    expect(
      canBeat(play({ type: 'bomb', rank: 7, length: 3 }), { decl: { type: 'bomb', rank: 7, length: 3 } }),
    ).toBe(false)
    expect(
      canBeat(play({ type: 'bomb', rank: 8, length: 3 }), { decl: { type: 'bomb', rank: 7, length: 3 } }),
    ).toBe(false)
  })
})

describe('pickAutoPlay 领出超时自动出牌', () => {
  it('有自然牌时出最小单张', () => {
    const { cards, decl } = pickAutoPlay(mk(7, 3, 10))
    expect(decl).toEqual({ type: 'single', rank: 3 })
    expect(cards).toHaveLength(1)
  })
  it('仅剩1张百搭时逃生单出', () => {
    const hand = mk(16)
    const { cards, decl } = pickAutoPlay(hand)
    expect(cards).toEqual(hand)
    expect(decl.type).toBe('single')
  })
  it('全百搭≥2张时出最小对子', () => {
    const hand = mk(16, 17, 16)
    const { cards, decl } = pickAutoPlay(hand)
    expect(decl).toEqual({ type: 'pair', rank: 3 })
    expect(cards).toHaveLength(2)
    expect(cards.every((c) => c.rank >= 16)).toBe(true)
  })
  it('有百搭有自然牌时出自然单张（百搭留手里）', () => {
    const { cards, decl } = pickAutoPlay(mk(16, 9))
    expect(decl).toEqual({ type: 'single', rank: 9 })
    expect(cards[0].rank).toBe(9)
  })
})
