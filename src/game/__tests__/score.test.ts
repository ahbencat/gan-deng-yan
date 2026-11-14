import { describe, expect, it } from 'vitest'
import type { SeatMeta } from '../../types.js'
import { bombMultiplier, settleGame } from '../score.js'
import { mk } from './helpers.js'

const seats: SeatMeta[] = [
  { seat: 0, userId: 101, nickname: 'A' },
  { seat: 1, userId: 102, nickname: 'B' },
  { seat: 2, userId: 103, nickname: 'C' },
]

describe('bombMultiplier', () => {
  it('3张×2、4张×4、5张×8、6张×16', () => {
    expect(bombMultiplier(3)).toBe(2)
    expect(bombMultiplier(4)).toBe(4)
    expect(bombMultiplier(5)).toBe(8)
    expect(bombMultiplier(6)).toBe(16)
  })
  it('7张以上按 2^(n-2) 推广', () => {
    expect(bombMultiplier(7)).toBe(32)
    expect(bombMultiplier(8)).toBe(64)
  })
})

describe('settleGame', () => {
  it('正常结算：剩牌×倍率×关瞪瞪翻倍，恒零和', () => {
    // 赢家 seat0（剩0），P1剩3（出过牌），P2剩2（关瞪瞪），倍率2
    const result = settleGame({
      seats,
      hands: [mk(), mk(5, 6, 7), mk(8, 9)],
      everPlayed: [true, true, false],
      multiplier: 2,
      winnerSeat: 0,
      reason: 'empty',
    })
    expect(result.winnerSeat).toBe(0)
    expect(result.reason).toBe('empty')
    // P1: 3×2×1=6；P2: 2×2×2=8（关瞪瞪）；总14
    expect(result.perPlayer.map((p) => p.delta)).toEqual([14, -6, -8])
    expect(result.perPlayer.reduce((a, p) => a + p.delta, 0)).toBe(0)
    expect(result.perPlayer[2].everPlayed).toBe(false)
  })

  it('超时结算：赢家剩牌不计费', () => {
    const result = settleGame({
      seats,
      hands: [mk(3, 4), mk(5, 6, 7, 8, 9), mk(10, 11, 12)],
      everPlayed: [true, true, true],
      multiplier: 1,
      winnerSeat: 0,
      reason: 'timeout',
    })
    // 赢家剩2张不计费；P1:5、P2:3 → 赢家+8
    expect(result.perPlayer.map((p) => p.delta)).toEqual([8, -5, -3])
    expect(result.perPlayer.reduce((a, p) => a + p.delta, 0)).toBe(0)
  })

  it('流局：全员0分', () => {
    const result = settleGame({
      seats,
      hands: [mk(3, 4, 5), mk(6, 7, 8), mk(9, 10, 11)],
      everPlayed: [true, false, true],
      multiplier: 4,
      winnerSeat: null,
      reason: 'draw',
    })
    expect(result.winnerSeat).toBeNull()
    expect(result.reason).toBe('draw')
    expect(result.perPlayer.every((p) => p.delta === 0)).toBe(true)
  })
})
