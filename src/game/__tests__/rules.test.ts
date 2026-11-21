import { describe, expect, it } from 'vitest'
import { RANK_2, type Card, type Decl, type Play } from '../../types.js'
import { canForm } from '../combo.js'
import { mulberry32 } from '../rng.js'
import { canBeat, pickAutoPlay, pickBeatingPlay } from '../rules.js'
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

describe('pickBeatingPlay 跟牌最省压牌', () => {
  const prev = (decl: Decl): Play => ({ seat: 1, cards: [], decl })

  it('单张+1 优先', () => {
    const r = pickBeatingPlay(mk(4, 7), prev({ type: 'single', rank: 3 }))
    expect(r).not.toBeNull()
    expect(r!.decl).toEqual({ type: 'single', rank: 4 })
    expect(r!.cards).toHaveLength(1)
  })

  it('无+1 时用 2 通管特权', () => {
    const r = pickBeatingPlay(mk(15, 7), prev({ type: 'single', rank: 14 }))
    expect(r!.decl).toEqual({ type: 'single', rank: RANK_2 })
  })

  it('单2 prev：单张无解（仅炸弹可压）', () => {
    expect(pickBeatingPlay(mk(3, 4, 5), prev({ type: 'single', rank: RANK_2 }))).toBeNull()
    const r = pickBeatingPlay(mk(3, 3, 3), prev({ type: 'single', rank: RANK_2 }))
    expect(r!.decl).toEqual({ type: 'bomb', rank: 3, length: 3 })
  })

  it('优先自然牌、省百搭', () => {
    const r = pickBeatingPlay(mk(4, 16, 17), prev({ type: 'single', rank: 3 }))
    expect(r!.decl).toEqual({ type: 'single', rank: 4 })
    expect(r!.cards[0].rank).toBe(4) // 用自然 4，不是百搭
  })

  it('对子+1 自然对', () => {
    const r = pickBeatingPlay(mk(6, 6, 9), prev({ type: 'pair', rank: 5 }))
    expect(r!.decl).toEqual({ type: 'pair', rank: 6 })
    expect(r!.cards).toHaveLength(2)
  })

  it('对子：1 自然 + 1 百搭', () => {
    const r = pickBeatingPlay(mk(6, 16), prev({ type: 'pair', rank: 5 }))
    expect(r!.decl).toEqual({ type: 'pair', rank: 6 })
    expect(r!.cards.some((c) => c.rank === 16)).toBe(true)
  })

  it('全百搭对子可声明任意点（压 +1）', () => {
    const r = pickBeatingPlay(mk(16, 17), prev({ type: 'pair', rank: 5 }))
    expect(r!.decl).toEqual({ type: 'pair', rank: 6 })
    expect(r!.cards.every((c) => c.rank >= 16)).toBe(true)
  })

  it('对2 prev：对子无解（仅炸弹可压）', () => {
    expect(pickBeatingPlay(mk(3, 3, 4, 4), prev({ type: 'pair', rank: RANK_2 }))).toBeNull()
    const r = pickBeatingPlay(mk(9, 9, 9), prev({ type: 'pair', rank: RANK_2 }))
    expect(r!.decl).toEqual({ type: 'bomb', rank: 9, length: 3 })
  })

  it('炸弹互压：张数优先于点数', () => {
    const r = pickBeatingPlay(mk(3, 3, 3, 3), prev({ type: 'bomb', rank: 7, length: 3 }))
    expect(r!.decl).toEqual({ type: 'bomb', rank: 3, length: 4 })
  })

  it('炸弹互压：同张数比点数', () => {
    const r = pickBeatingPlay(mk(8, 8, 8), prev({ type: 'bomb', rank: 7, length: 3 }))
    expect(r!.decl).toEqual({ type: 'bomb', rank: 8, length: 3 })
    expect(pickBeatingPlay(mk(6, 6, 6), prev({ type: 'bomb', rank: 7, length: 3 }))).toBeNull()
  })

  it('全百搭炸弹压同张炸弹：声明 prev.rank+1', () => {
    const r = pickBeatingPlay(mk(16, 17, 16), prev({ type: 'bomb', rank: 7, length: 3 }))
    expect(r!.decl).toEqual({ type: 'bomb', rank: 8, length: 3 })
    expect(r!.cards.every((c) => c.rank >= 16)).toBe(true)
  })

  it('顺子/连对 prev：直接 null（基础 bot 不尝试）', () => {
    expect(
      pickBeatingPlay(mk(4, 5, 6, 7), prev({ type: 'straight', rank: 3, length: 3 })),
    ).toBeNull()
    expect(
      pickBeatingPlay(mk(4, 4, 5, 5), prev({ type: 'pairChain', rank: 3, length: 2 })),
    ).toBeNull()
  })

  it('无解 → null', () => {
    expect(pickBeatingPlay(mk(3, 4, 5), prev({ type: 'single', rank: 10 }))).toBeNull()
  })

  it('属性循环：非空结果满足 canForm && canBeat && cards ⊆ hand', () => {
    const rng = mulberry32(42)
    const sampleHand = (): Card[] => {
      const out: Card[] = []
      let id = 100_000
      for (let r = 3; r <= 15; r++) {
        const n = Math.floor(rng() * 5) // 0..4
        for (let k = 0; k < n; k++) out.push({ id: id++, rank: r, suit: 0 })
      }
      const wilds = Math.floor(rng() * 5)
      for (let k = 0; k < wilds; k++) out.push({ id: id++, rank: 16 + (k % 2), suit: 4 })
      return out
    }
    const prevDecls: Decl[] = [
      { type: 'single', rank: 3 },
      { type: 'single', rank: 14 },
      { type: 'single', rank: RANK_2 },
      { type: 'pair', rank: 7 },
      { type: 'pair', rank: RANK_2 },
      { type: 'straight', rank: 5, length: 4 },
      { type: 'pairChain', rank: 4, length: 3 },
      { type: 'bomb', rank: 9, length: 3 },
      { type: 'bomb', rank: 6, length: 5 },
    ]
    let nonNull = 0
    for (let i = 0; i < 800; i++) {
      const hand = sampleHand()
      const decl = prevDecls[Math.floor(rng() * prevDecls.length)]
      const r = pickBeatingPlay(hand, prev(decl))
      if (r === null) continue
      nonNull++
      const ids = new Set(hand.map((c) => c.id))
      expect(r.cards.length).toBeGreaterThan(0)
      for (const c of r.cards) expect(ids.has(c.id)).toBe(true)
      expect(new Set(r.cards.map((c) => c.id)).size).toBe(r.cards.length)
      expect(canForm(r.cards, r.decl)).toBe(true)
      expect(canBeat(prev(decl), { decl: r.decl })).toBe(true)
    }
    expect(nonNull).toBeGreaterThan(0) // 样本里必须出现过非空解
  })
})
