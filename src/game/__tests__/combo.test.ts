import { describe, expect, it } from 'vitest'
import { RANK_2, RANK_A, RANK_SMALL_JOKER } from '../../types.js'
import { canForm, enumerateDeclarations } from '../combo.js'
import { mk } from './helpers.js'

describe('canForm 单张', () => {
  it('自然单张合法', () => {
    expect(canForm(mk(5), { type: 'single', rank: 5 })).toBe(true)
  })
  it('百搭不能单出', () => {
    expect(canForm(mk(RANK_SMALL_JOKER), { type: 'single', rank: 5 })).toBe(false)
    expect(canForm(mk(RANK_SMALL_JOKER), { type: 'single', rank: RANK_2 })).toBe(false)
  })
  it('点数不符不合法', () => {
    expect(canForm(mk(5), { type: 'single', rank: 6 })).toBe(false)
  })
  it('多张不合法', () => {
    expect(canForm(mk(5, 5), { type: 'single', rank: 5 })).toBe(false)
  })
})

describe('canForm 对子', () => {
  it('自然对子合法', () => {
    expect(canForm(mk(7, 7), { type: 'pair', rank: 7 })).toBe(true)
  })
  it('2+王=对2（百搭可配对2）', () => {
    expect(canForm(mk(RANK_2, RANK_SMALL_JOKER), { type: 'pair', rank: RANK_2 })).toBe(true)
  })
  it('双王可声明对2', () => {
    expect(canForm(mk(RANK_SMALL_JOKER, 17), { type: 'pair', rank: RANK_2 })).toBe(true)
    expect(canForm(mk(RANK_SMALL_JOKER, 17), { type: 'pair', rank: 3 })).toBe(true)
  })
  it('5+王=对5，声明对6不合法', () => {
    expect(canForm(mk(5, RANK_SMALL_JOKER), { type: 'pair', rank: 5 })).toBe(true)
    expect(canForm(mk(5, RANK_SMALL_JOKER), { type: 'pair', rank: 6 })).toBe(false)
  })
  it('异点不成对', () => {
    expect(canForm(mk(5, 6), { type: 'pair', rank: 5 })).toBe(false)
  })
  it('三张不成对', () => {
    expect(canForm(mk(7, 7, 7), { type: 'pair', rank: 7 })).toBe(false)
  })
})

describe('canForm 顺子', () => {
  it('345 合法', () => {
    expect(canForm(mk(3, 4, 5), { type: 'straight', rank: 3, length: 3 })).toBe(true)
  })
  it('至少3张', () => {
    expect(canForm(mk(3, 4), { type: 'straight', rank: 3, length: 2 })).toBe(false)
  })
  it('A23 不算顺子', () => {
    expect(canForm(mk(RANK_A, RANK_2, 3), { type: 'straight', rank: 12, length: 3 })).toBe(false)
    expect(canForm(mk(RANK_A, RANK_2, 3), { type: 'straight', rank: 14, length: 3 })).toBe(false)
  })
  it('234 不算顺子', () => {
    expect(canForm(mk(RANK_2, 3, 4), { type: 'straight', rank: 3, length: 3 })).toBe(false)
    expect(canForm(mk(RANK_2, 3, 4), { type: 'straight', rank: 2, length: 3 })).toBe(false)
  })
  it('QKA 封顶合法', () => {
    expect(canForm(mk(12, 13, 14), { type: 'straight', rank: 12, length: 3 })).toBe(true)
  })
  it('KA2 越过A不合法', () => {
    expect(canForm(mk(13, 14, RANK_2), { type: 'straight', rank: 13, length: 3 })).toBe(false)
  })
  it('顺子内自然牌重复不合法', () => {
    expect(canForm(mk(5, 5, 6), { type: 'straight', rank: 5, length: 3 })).toBe(false)
  })
  it('百搭补缺口', () => {
    expect(canForm(mk(3, 5, RANK_SMALL_JOKER), { type: 'straight', rank: 3, length: 3 })).toBe(true)
  })
  it('全百搭可组成顺子', () => {
    expect(canForm(mk(RANK_SMALL_JOKER, 16, 17), { type: 'straight', rank: 5, length: 3 })).toBe(true)
  })
  it('3~A 长顺合法', () => {
    const ranks = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    expect(canForm(mk(...ranks), { type: 'straight', rank: 3, length: 12 })).toBe(true)
  })
})

describe('canForm 连对', () => {
  it('3344 合法', () => {
    expect(canForm(mk(3, 3, 4, 4), { type: 'pairChain', rank: 3, length: 2 })).toBe(true)
  })
  it('至少2组', () => {
    expect(canForm(mk(3, 3), { type: 'pairChain', rank: 3, length: 1 })).toBe(false)
  })
  it('3组连对合法', () => {
    expect(canForm(mk(3, 3, 4, 4, 5, 5), { type: 'pairChain', rank: 3, length: 3 })).toBe(true)
  })
  it('奇数张不合法', () => {
    expect(canForm(mk(3, 3, 4, 4, 5), { type: 'pairChain', rank: 3, length: 2 })).toBe(false)
  })
  it('2 不入连对', () => {
    expect(canForm(mk(14, 14, 15, 15), { type: 'pairChain', rank: 14, length: 2 })).toBe(false)
    expect(canForm(mk(14, 14, 15, 15), { type: 'pairChain', rank: 15, length: 2 })).toBe(false)
  })
  it('百搭补缺口', () => {
    expect(canForm(mk(3, 3, 5, 5, 16, 16), { type: 'pairChain', rank: 3, length: 3 })).toBe(true)
  })
  it('区间外自然牌不合法', () => {
    expect(canForm(mk(3, 3, 4, 4, 7, 7), { type: 'pairChain', rank: 3, length: 3 })).toBe(false)
  })
  it('同点超过2张不合法', () => {
    expect(canForm(mk(3, 3, 3, 4, 4, 4), { type: 'pairChain', rank: 3, length: 2 })).toBe(false)
  })
})

describe('canForm 炸弹', () => {
  it('三张同点=炸弹', () => {
    expect(canForm(mk(7, 7, 7), { type: 'bomb', rank: 7, length: 3 })).toBe(true)
  })
  it('四张=氢弹', () => {
    expect(canForm(mk(7, 7, 7, 7), { type: 'bomb', rank: 7, length: 4 })).toBe(true)
  })
  it('777+王=四张炸', () => {
    expect(canForm(mk(7, 7, 7, RANK_SMALL_JOKER), { type: 'bomb', rank: 7, length: 4 })).toBe(true)
  })
  it('自然222是合法炸弹', () => {
    expect(canForm(mk(RANK_2, RANK_2, RANK_2), { type: 'bomb', rank: RANK_2, length: 3 })).toBe(true)
  })
  it('222+王=四张2炸（百搭可配2炸）', () => {
    expect(
      canForm(mk(RANK_2, RANK_2, RANK_2, RANK_SMALL_JOKER), { type: 'bomb', rank: RANK_2, length: 4 }),
    ).toBe(true)
  })
  it('22+王=三张2炸', () => {
    expect(
      canForm(mk(RANK_2, RANK_2, RANK_SMALL_JOKER), { type: 'bomb', rank: RANK_2, length: 3 }),
    ).toBe(true)
  })
  it('全百搭可组成任意点炸弹', () => {
    expect(canForm(mk(16, 16, 17), { type: 'bomb', rank: 3, length: 3 })).toBe(true)
    expect(canForm(mk(16, 16, 17), { type: 'bomb', rank: RANK_2, length: 3 })).toBe(true)
  })
  it('异点不成炸', () => {
    expect(canForm(mk(7, 7, 8), { type: 'bomb', rank: 7, length: 3 })).toBe(false)
  })
  it('张数不符不合法', () => {
    expect(canForm(mk(7, 7), { type: 'bomb', rank: 7, length: 3 })).toBe(false)
    expect(canForm(mk(7, 7, 7), { type: 'bomb', rank: 7, length: 4 })).toBe(false)
  })
})

describe('enumerateDeclarations', () => {
  it('单张声明唯一', () => {
    expect(enumerateDeclarations(mk(5))).toEqual([{ type: 'single', rank: 5 }])
  })
  it('百搭单出无声明', () => {
    expect(enumerateDeclarations(mk(RANK_SMALL_JOKER))).toEqual([])
  })
  it('5+王只有对5声明', () => {
    expect(enumerateDeclarations(mk(5, RANK_SMALL_JOKER))).toEqual([{ type: 'pair', rank: 5 }])
  })
  it('双王可声明13种对子（3~2）', () => {
    const decls = enumerateDeclarations(mk(16, 17))
    expect(decls).toHaveLength(13)
    expect(decls.every((d) => d.type === 'pair')).toBe(true)
    expect(decls.map((d) => (d as { rank: number }).rank)).toEqual(
      Array.from({ length: 13 }, (_, i) => 3 + i),
    )
  })
  it('无百搭时顺子声明唯一', () => {
    expect(enumerateDeclarations(mk(3, 4, 5))).toEqual([{ type: 'straight', rank: 3, length: 3 }])
  })
  it('百搭歧义：王56 可为456或567', () => {
    expect(enumerateDeclarations(mk(RANK_SMALL_JOKER, 5, 6))).toEqual([
      { type: 'straight', rank: 4, length: 3 },
      { type: 'straight', rank: 5, length: 3 },
    ])
  })
  it('777 只有炸弹声明', () => {
    expect(enumerateDeclarations(mk(7, 7, 7))).toEqual([{ type: 'bomb', rank: 7, length: 3 }])
  })
  it('5566 只有连对声明', () => {
    expect(enumerateDeclarations(mk(5, 5, 6, 6))).toEqual([{ type: 'pairChain', rank: 5, length: 2 }])
  })
  it('2+王 只有对2声明', () => {
    expect(enumerateDeclarations(mk(RANK_2, RANK_SMALL_JOKER))).toEqual([
      { type: 'pair', rank: RANK_2 },
    ])
  })
  it('3333 只有四张炸声明', () => {
    expect(enumerateDeclarations(mk(3, 3, 3, 3))).toEqual([{ type: 'bomb', rank: 3, length: 4 }])
  })
  it('34567 声明唯一', () => {
    expect(enumerateDeclarations(mk(3, 4, 5, 6, 7))).toEqual([
      { type: 'straight', rank: 3, length: 5 },
    ])
  })
  it('异点两牌无声明', () => {
    expect(enumerateDeclarations(mk(5, 8))).toEqual([])
  })
  it('空选牌无声明', () => {
    expect(enumerateDeclarations([])).toEqual([])
  })
})
