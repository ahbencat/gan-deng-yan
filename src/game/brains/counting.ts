// 3 级大脑记牌推算：由公开已打出牌（seenRanks）+ 自己手牌 + 牌堆构成 估计未现牌
// 全部为粗粒度整数启发式（非概率），保证决策确定性可测
import { RANK_2, RANK_BIG_JOKER, RANK_MIN, emptyRankTally, type Decl } from '../../types.js'
import type { BotContext } from '../brain.js'
import { buildDeck } from '../cards.js'

/**
 * 各点数未现张数（下标=rank，3..17）：
 * 牌堆各点总数直接取自 buildDeck（唯一构成来源），seen = 已公开打出，own = 自己手牌。
 * unseen = deckTotal − seen − own，下限 0。
 */
export function unseenByRank(ctx: BotContext): number[] {
  const totals = emptyRankTally()
  for (const c of buildDeck(ctx.wildCount)) totals[c.rank]++
  const u = emptyRankTally()
  const own = emptyRankTally()
  for (const c of ctx.hand) own[c.rank]++
  for (let r = RANK_MIN; r <= RANK_BIG_JOKER; r++) {
    u[r] = Math.max(0, totals[r] - (ctx.seenRanks[r] ?? 0) - own[r])
  }
  return u
}

/** 潜在未现炸弹的点数个数（自然牌未现 ≥3；粗估，不含王补位） */
export function bombRisk(u: number[]): number {
  let n = 0
  for (let r = RANK_MIN; r <= RANK_2; r++) if (u[r] >= 3) n++
  return n
}

/**
 * 估计压过 decl 所需的未现牌数（越小 = 自己这张牌越安全）：
 * - 单 r：未现 r+1 +（非2时未现2 通管）+ 炸弹风险；单2 只有炸弹
 * - 对 r：floor(未现 r+1 / 2) +（非2时 floor(未现2 / 2)）+ 炸弹风险；对2 只有炸弹
 * - 顺/连对：counter 窗口最薄弱点 + 炸弹风险（counter 起点超 A 则只剩炸弹）
 * - 炸弹：未现 ≥长+1 的点数个数（只有更大炸弹能压）
 */
export function beatRisk(decl: Decl, u: number[], bombR: number): number {
  switch (decl.type) {
    case 'single': {
      if (decl.rank === RANK_2) return bombR
      const next = u[decl.rank + 1] ?? 0
      // A(rank=14) 的 rank+1 就是 2，通管项不再重复计
      const two = decl.rank < 14 ? u[RANK_2] : 0
      return next + two + bombR
    }
    case 'pair': {
      if (decl.rank === RANK_2) return bombR
      const next = Math.floor((u[decl.rank + 1] ?? 0) / 2)
      const two = decl.rank < 14 ? Math.floor(u[RANK_2] / 2) : 0
      return next + two + bombR
    }
    case 'straight':
    case 'pairChain': {
      // counter 起点 = decl.rank+1，同长；窗口 [rank+1, rank+length]
      if (decl.rank + decl.length > 14) return bombR // counter 终点超 A → 无天然 counter
      let min = Infinity
      const per = decl.type === 'straight' ? 1 : 2
      for (let i = 1; i <= decl.length; i++) {
        const v = per === 1 ? u[decl.rank + i] : Math.floor(u[decl.rank + i] / 2)
        if (v < min) min = v
      }
      return min + bombR
    }
    case 'bomb': {
      let n = 0
      for (let r = RANK_MIN; r <= RANK_2; r++) if (u[r] >= decl.length + 1) n++
      return n
    }
  }
}
