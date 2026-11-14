import { RANK_2, RANK_MIN, isWild, type Card, type Decl, type Play } from '../types.js'

/**
 * 跟牌合法性：next 能否压 prev。
 * - 炸弹压任意非炸弹；炸弹互压：张数多者胜，同张数比点数
 * - 其余必须同牌型：
 *   single/pair：点数正好+1，或 2 的通管特权（next=2 且 prev≠2）
 *   straight/pairChain：同长度且起点正好+1
 */
export function canBeat(prev: Play | null, next: { decl: Decl }): boolean {
  if (prev === null) return true // 领出：任意合法牌型
  const a = prev.decl
  const b = next.decl
  const prevBomb = a.type === 'bomb'
  const nextBomb = b.type === 'bomb'

  if (nextBomb) {
    if (!prevBomb) return true
    if (b.length !== a.length) return b.length > a.length
    return b.rank > a.rank
  }
  if (prevBomb) return false // 非炸弹压不了炸弹

  if (a.type === 'single') {
    if (b.type !== 'single') return false
    if (b.rank === a.rank + 1) return true
    // 2 的通管特权：单2压任意单张（非2）
    return b.rank === RANK_2 && a.rank !== RANK_2
  }
  if (a.type === 'pair') {
    if (b.type !== 'pair') return false
    if (b.rank === a.rank + 1) return true
    // 对2压任意对子（非2）
    return b.rank === RANK_2 && a.rank !== RANK_2
  }
  if (a.type === 'straight' || a.type === 'pairChain') {
    if (b.type !== 'straight' && b.type !== 'pairChain') return false
    if (b.type !== a.type) return false
    if (b.length !== a.length) return false
    return b.rank === a.rank + 1
  }
  return false // a 为炸弹而 b 非炸弹 —— 前面已处理
}

/**
 * 领出超时的自动出牌：牌型优先级 single < pair < straight < pairChain < bomb，
 * 同型比点数。简化：有自然牌 → 最小自然单张；全百搭 → 1张逃生单出 / ≥2张最小对子。
 * （领出态只要有牌必有合法着法，本函数是全函数）
 */
export function pickAutoPlay(hand: Card[]): { cards: Card[]; decl: Decl } {
  const naturals = hand.filter((c) => !isWild(c.rank))
  const wilds = hand.filter((c) => isWild(c.rank))

  if (naturals.length > 0) {
    let min = naturals[0]
    for (const c of naturals) if (c.rank < min.rank) min = c
    return { cards: [min], decl: { type: 'single', rank: min.rank } }
  }
  // 全百搭
  if (wilds.length === 1) {
    // 逃生单出（领出且仅剩1张百搭）；声明仅用于展示
    return { cards: [wilds[0]], decl: { type: 'single', rank: RANK_MIN } }
  }
  return { cards: [wilds[0], wilds[1]], decl: { type: 'pair', rank: RANK_MIN } }
}
