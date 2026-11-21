import { RANK_2, RANK_MIN, isWild, type Card, type Decl, type Play } from '../types.js'
import { canForm } from './combo.js'

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

/**
 * 跟牌态的最省压牌（基础 bot / 托管共用）：
 * - 同型压优先（single/pair：目标点数升序，rank+1 优先、2 特权兜底），其次炸弹
 *   （按 张数升 → 点数升 → 用百搭升）；压不过返回 null（调用方过牌）
 * - 顺子/连对不尝试（直接 null）；单2/对2 的 prev 只有炸弹能压
 * - 返回前经 canForm + canBeat 守卫校验
 */
export function pickBeatingPlay(
  hand: Card[],
  prev: Play,
): { cards: Card[]; decl: Decl } | null {
  const a = prev.decl
  if (a.type === 'straight' || a.type === 'pairChain') return null

  const byRank = new Map<number, Card[]>()
  const wildCards: Card[] = []
  for (const c of hand) {
    if (isWild(c.rank)) {
      wildCards.push(c)
    } else {
      const arr = byRank.get(c.rank)
      if (arr) arr.push(c)
      else byRank.set(c.rank, [c])
    }
  }

  const ok = (cards: Card[], decl: Decl): boolean =>
    canForm(cards, decl) && canBeat(prev, { decl })

  /** 组 n 张点数 r：自然优先，不足补百搭；不够返回 null */
  const take = (r: number, n: number): Card[] | null => {
    const nat = byRank.get(r) ?? []
    if (nat.length + wildCards.length < n) return null
    const useWild = Math.max(0, n - nat.length)
    return [...nat.slice(0, n), ...wildCards.slice(0, useWild)]
  }

  // 同型压（仅 single/pair）
  if (a.type === 'single' || a.type === 'pair') {
    const targets: number[] = []
    if (a.rank + 1 <= RANK_2) targets.push(a.rank + 1)
    if (a.rank !== RANK_2) targets.push(RANK_2)
    for (const t of [...new Set(targets)].sort((x, y) => x - y)) {
      if (a.type === 'single') {
        const nat = byRank.get(t)
        if (nat && nat.length > 0) {
          const cards = [nat[0]]
          const decl: Decl = { type: 'single', rank: t }
          if (ok(cards, decl)) return { cards, decl }
        }
      } else {
        const cards = take(t, 2)
        if (cards) {
          const decl: Decl = { type: 'pair', rank: t }
          if (ok(cards, decl)) return { cards, decl }
        }
      }
    }
  }

  // 炸弹候选（单张/对子同型压不到、或 prev 本身是炸弹时的唯一手段）
  interface Cand {
    cards: Card[]
    decl: Decl
    len: number
    rank: number
    wilds: number
  }
  const bombs: Cand[] = []
  for (const [r, nat] of byRank) {
    const total = nat.length + wildCards.length
    for (let len = 3; len <= total; len++) {
      const cards = take(r, len)
      if (!cards) continue
      bombs.push({
        cards,
        decl: { type: 'bomb', rank: r, length: len },
        len,
        rank: r,
        wilds: Math.max(0, len - nat.length),
      })
    }
  }
  if (wildCards.length >= 3) {
    // 全百搭炸弹自由选点：非炸弹 prev 用最小点；同长压炸弹需声明 prev.rank+1
    for (let len = 3; len <= wildCards.length; len++) {
      const cards = wildCards.slice(0, len)
      const ranks =
        a.type === 'bomb' && a.length === len && a.rank < RANK_2
          ? [RANK_MIN, a.rank + 1]
          : [RANK_MIN]
      for (const rank of ranks) {
        bombs.push({ cards, decl: { type: 'bomb', rank, length: len }, len, rank, wilds: len })
      }
    }
  }
  bombs.sort((x, y) => x.len - y.len || x.rank - y.rank || x.wilds - y.wilds)
  for (const c of bombs) {
    if (ok(c.cards, c.decl)) return { cards: c.cards, decl: c.decl }
  }
  return null
}
