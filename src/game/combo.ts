import { RANK_2, RANK_A, RANK_MIN, isWild, type Card, type Decl } from '../types.js'

/** 自然牌按点分组（保留牌对象）+ 百搭列表 */
export function groupByRank(hand: Card[]): { byRank: Map<number, Card[]>; wilds: Card[] } {
  const byRank = new Map<number, Card[]>()
  const wilds: Card[] = []
  for (const c of hand) {
    if (isWild(c.rank)) {
      wilds.push(c)
    } else {
      const arr = byRank.get(c.rank)
      if (arr) arr.push(c)
      else byRank.set(c.rank, [c])
    }
  }
  return { byRank, wilds }
}

/** 自然牌按点计数 + 百搭张数 */
export function analyze(cards: Card[]): { counts: Map<number, number>; wilds: number } {
  const counts = new Map<number, number>()
  let wilds = 0
  for (const c of cards) {
    if (isWild(c.rank)) wilds++
    else counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
  }
  return { counts, wilds }
}

/**
 * 校验选牌能否构成声明 decl。
 * 逃生单出百搭（领出且仅剩1张）由 engine 层放行，这里 single 永不接受百搭。
 */
export function canForm(cards: Card[], decl: Decl): boolean {
  const { counts, wilds } = analyze(cards)
  switch (decl.type) {
    case 'single': {
      if (cards.length !== 1) return false
      if (wilds > 0) return false
      return cards[0].rank === decl.rank
    }
    case 'pair': {
      if (cards.length !== 2) return false
      if (counts.size === 0) {
        // 全百搭对子：可声明 3~A 或 2（百搭可配对2）
        return decl.rank >= RANK_MIN && decl.rank <= RANK_2
      }
      if (counts.size !== 1) return false
      const [r, n] = [...counts.entries()][0]
      if (n + wilds !== 2) return false
      return decl.rank === r
    }
    case 'straight': {
      const { rank: start, length } = decl
      if (length < 3) return false
      if (start < RANK_MIN) return false
      if (start + length - 1 > RANK_A) return false // 2 不入顺子，终点≤A
      if (cards.length !== length) return false
      for (const [r, n] of counts) {
        if (n > 1) return false // 自然牌点互异
        if (r < start || r > end(decl)) return false
      }
      return wilds === length - counts.size
    }
    case 'pairChain': {
      const { rank: start, length } = decl // length = 对数
      if (length < 2) return false
      if (start < RANK_MIN) return false
      if (start + length - 1 > RANK_A) return false
      if (cards.length !== length * 2) return false
      let missing = 0
      for (let r = start; r <= start + length - 1; r++) {
        const n = counts.get(r) ?? 0
        if (n > 2) return false
        missing += 2 - n
      }
      for (const r of counts.keys()) {
        if (r < start || r > start + length - 1) return false // 区间外自然牌
      }
      return wilds === missing
    }
    case 'bomb': {
      const { rank, length } = decl
      if (length < 3) return false
      if (cards.length !== length) return false
      if (rank < RANK_MIN || rank > RANK_2) return false
      if (counts.size === 0) return true // 全百搭炸弹，声明 3~A 或 2
      if (counts.size !== 1) return false
      const [r, n] = [...counts.entries()][0]
      if (n + wilds !== length) return false
      return decl.rank === r
    }
  }
}

function end(decl: { rank: number; length: number }): number {
  return decl.rank + decl.length - 1
}

/** 枚举选牌的全部合法声明（前后端共用：前端渲染弹窗、后端超时自动出牌） */
export function enumerateDeclarations(cards: Card[]): Decl[] {
  const decls: Decl[] = []
  const n = cards.length
  if (n === 0) return decls
  const { counts, wilds } = analyze(cards)

  // 单张：仅自然牌（百搭不能单出，逃生由 engine 处理）
  if (n === 1 && wilds === 0) {
    decls.push({ type: 'single', rank: cards[0].rank })
    return decls
  }

  // 对子
  if (n === 2) {
    if (counts.size === 0) {
      for (let r = RANK_MIN; r <= RANK_2; r++) decls.push({ type: 'pair', rank: r })
    } else if (counts.size === 1) {
      decls.push({ type: 'pair', rank: [...counts.keys()][0] })
    }
  }

  // 顺子（≥3 张）
  if (n >= 3) {
    decls.push(...enumerateWindows(cards, counts, n, 'straight'))
  }

  // 连对（≥4 张且偶数）
  if (n >= 4 && n % 2 === 0) {
    decls.push(...enumerateWindows(cards, counts, n / 2, 'pairChain'))
  }

  // 炸弹（≥3 张同点）
  if (n >= 3) {
    if (counts.size === 0) {
      for (let r = RANK_MIN; r <= RANK_2; r++) decls.push({ type: 'bomb', rank: r, length: n })
    } else if (counts.size === 1) {
      decls.push({ type: 'bomb', rank: [...counts.keys()][0], length: n })
    }
  }

  return decls
}

/** 枚举顺子/连对的起点窗口（length=张数或对数），逐一 canForm 精确校验 */
function enumerateWindows(
  cards: Card[],
  counts: Map<number, number>,
  length: number,
  kind: 'straight' | 'pairChain',
): Decl[] {
  const ranks = [...counts.keys()]
  const lo0 =
    ranks.length === 0 ? RANK_MIN : Math.max(RANK_MIN, Math.max(...ranks) - length + 1)
  const hi0 = Math.min(ranks.length === 0 ? RANK_MIN : Math.min(...ranks), RANK_A - length + 1)
  const lo = ranks.length === 0 ? RANK_MIN : lo0
  const hi = ranks.length === 0 ? RANK_A - length + 1 : hi0
  const out: Decl[] = []
  for (let start = lo; start <= hi; start++) {
    const decl: Decl =
      kind === 'straight'
        ? { type: 'straight', rank: start, length }
        : { type: 'pairChain', rank: start, length }
    if (canForm(cards, decl)) out.push(decl)
  }
  return out
}
