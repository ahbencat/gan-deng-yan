import type { Card, GameEndReason, GameResult, SeatMeta } from '../types.js'

/**
 * 炸弹倍率：n 张同点炸弹 → 2^(n-2)
 * 3张×2、4张×4、5张×8、6张×16、7张×32、8张×64（推广）
 */
export function bombMultiplier(n: number): number {
  return Math.pow(2, n - 2)
}

/**
 * 结算（假设6）：
 * - 正常/超时：输家 = 剩牌张数 × 累计倍率 × (关瞪瞪?2:1)，赢家得总和，恒零和
 * - 超时赢家自己剩牌不计费
 * - 流局（并列最少牌）：全员 0
 */
export function settleGame(params: {
  seats: SeatMeta[]
  hands: Card[][]
  everPlayed: boolean[]
  multiplier: number
  winnerSeat: number | null
  reason: GameEndReason
}): GameResult {
  const { seats, hands, everPlayed, multiplier, winnerSeat, reason } = params

  if (winnerSeat === null || reason === 'draw') {
    return {
      winnerSeat: null,
      reason: 'draw',
      perPlayer: seats.map((s, i) => ({
        seat: s.seat,
        userId: s.userId,
        remaining: hands[i].length,
        everPlayed: everPlayed[i],
        delta: 0,
      })),
      multiplier,
    }
  }

  const losses = hands.map((h, i) => {
    if (i === winnerSeat) return 0
    const guandengdeng = everPlayed[i] ? 1 : 2 // 关瞪瞪（一张未出）翻倍
    return h.length * multiplier * guandengdeng
  })
  const total = losses.reduce((a, b) => a + b, 0)

  return {
    winnerSeat,
    reason,
    perPlayer: seats.map((s, i) => ({
      seat: s.seat,
      userId: s.userId,
      remaining: hands[i].length,
      everPlayed: everPlayed[i],
      delta: i === winnerSeat ? total : -losses[i],
    })),
    multiplier,
  }
}
