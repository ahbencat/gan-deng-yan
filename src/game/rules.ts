import { RANK_2, RANK_A, RANK_MIN, isWild, type Card, type Decl, type Play } from '../types.js'
import { canForm, groupByRank } from './combo.js'

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

// ---- 合法压牌枚举（大脑候选与基础 bot 共用的唯一枚举源） ----

export interface BeatCandidate {
  cards: Card[]
  decl: Decl
  usesWild: boolean
  breaksSet: boolean
  isBomb: boolean
  usesTwo: boolean
  /** 排序成本：普通牌 = 点数；炸弹 = 100 + 张数 */
  cost: number
}

export function beatCost(decl: Decl): number {
  return decl.type === 'bomb' ? 100 + decl.length : decl.rank
}

/**
 * 枚举 hand 压 prev 的全部合法打法（含百搭补对 / 纯王炸弹），逐个经 canForm + canBeat 校验。
 * 排序：非炸弹按 cost 升序（同 cost 稳定保留生成序），炸弹按 张数→点数→用百搭升。
 */
export function enumerateBeats(hand: Card[], prev: Play): BeatCandidate[] {
  const { byRank, wilds } = groupByRank(hand)
  const out: BeatCandidate[] = []
  const a = prev.decl

  const ok = (cards: Card[], decl: Decl): boolean =>
    canForm(cards, decl) && canBeat(prev, { decl })

  /** 组 n 张点数 r：自然优先，不足补百搭；不够返回 null */
  const take = (r: number, n: number): Card[] | null => {
    const nat = byRank.get(r) ?? []
    if (nat.length + wilds.length < n) return null
    const useWild = Math.max(0, n - nat.length)
    return [...nat.slice(0, n), ...wilds.slice(0, useWild)]
  }

  const push = (cards: Card[], decl: Decl, usesWild: boolean, breaksSet: boolean): void => {
    if (!ok(cards, decl)) return
    out.push({
      cards,
      decl,
      usesWild,
      breaksSet,
      isBomb: decl.type === 'bomb',
      usesTwo: decl.rank === RANK_2,
      cost: beatCost(decl),
    })
  }

  // 同型压：单张/对子（rank+1 优先，其次 2 通管）
  if (a.type === 'single' || a.type === 'pair') {
    const targets: number[] = []
    if (a.rank + 1 <= RANK_2) targets.push(a.rank + 1)
    if (a.rank !== RANK_2) targets.push(RANK_2)
    for (const t of [...new Set(targets)].sort((x, y) => x - y)) {
      if (a.type === 'single') {
        const nat = byRank.get(t)
        if (nat && nat.length > 0) {
          // 单张恒天然（百搭不能单出）；拆组 = 该点有剩余
          push([nat[0]], { type: 'single', rank: t }, false, nat.length > 1)
        }
      } else {
        const cards = take(t, 2)
        if (cards) {
          const natN = (byRank.get(t) ?? []).length
          const usesWild = cards.some((c) => isWild(c.rank))
          // 对子：该点自然牌 >2 且只取 2 张 → 拆组
          push(cards, { type: 'pair', rank: t }, usesWild, natN > 2)
        }
      }
    }
  }

  // 顺子/连对 counter：同型同长、起点 +1（只取天然牌）
  if (a.type === 'straight' || a.type === 'pairChain') {
    const start = a.rank + 1
    const len = a.length
    if (start + len - 1 <= RANK_A) {
      const perRank = a.type === 'straight' ? 1 : 2
      const cards: Card[] = []
      let okWin = true
      let breaksSet = false
      for (let r = start; r < start + len; r++) {
        const nat = byRank.get(r) ?? []
        if (nat.length < perRank) {
          okWin = false
          break
        }
        if (nat.length > perRank) breaksSet = true
        cards.push(...nat.slice(0, perRank))
      }
      if (okWin) {
        const decl: Decl =
          a.type === 'straight'
            ? { type: 'straight', rank: start, length: len }
            : { type: 'pairChain', rank: start, length: len }
        push(cards, decl, false, breaksSet)
      }
    }
  }

  // 炸弹候选（任意 prev 都可；单2/对2/炸弹的 prev 只有炸弹能压）
  // wilds 值仅作炸弹间排序的末位键（张数→点数→用百搭升）
  const bombs: { cand: BeatCandidate; wilds: number }[] = []
  const pushBomb = (
    cards: Card[],
    decl: Decl,
    breaksSet: boolean,
    wildCount: number,
  ): void => {
    if (!ok(cards, decl)) return
    bombs.push({
      cand: {
        cards,
        decl,
        usesWild: wildCount > 0,
        breaksSet,
        isBomb: true,
        usesTwo: decl.rank === RANK_2,
        cost: beatCost(decl),
      },
      wilds: wildCount,
    })
  }
  for (const [r, nat] of byRank) {
    const total = nat.length + wilds.length
    for (let len = 3; len <= total; len++) {
      const cards = take(r, len)
      if (!cards) continue
      pushBomb(cards, { type: 'bomb', rank: r, length: len }, nat.length > len, Math.max(0, len - nat.length))
    }
  }
  if (wilds.length >= 3) {
    // 全百搭炸弹自由选点：非炸弹 prev 用最小点；同长压炸弹需声明 prev.rank+1
    for (let len = 3; len <= wilds.length; len++) {
      const cards = wilds.slice(0, len)
      const ranks =
        a.type === 'bomb' && a.length === len && a.rank < RANK_2
          ? [RANK_MIN, a.rank + 1]
          : [RANK_MIN]
      for (const rank of ranks) {
        pushBomb(cards, { type: 'bomb', rank, length: len }, false, len)
      }
    }
  }
  bombs.sort(
    (x, y) =>
      (x.cand.decl.type === 'bomb' ? x.cand.decl.length : 0) -
        (y.cand.decl.type === 'bomb' ? y.cand.decl.length : 0) ||
      x.cand.decl.rank - y.cand.decl.rank ||
      x.wilds - y.wilds,
  )
  // 非炸弹按 cost 升序（同 cost 稳定保留生成序）
  out.sort((x, y) => x.cost - y.cost)
  return [...out, ...bombs.map((b) => b.cand)]
}

/**
 * 跟牌态的最省压牌（基础 bot / 托管共用）：enumerateBeats 的首项即最省合法压法。
 * - 顺子/连对不尝试（直接 null）；压不过返回 null（调用方过牌）
 */
export function pickBeatingPlay(
  hand: Card[],
  prev: Play,
): { cards: Card[]; decl: Decl } | null {
  if (prev.decl.type === 'straight' || prev.decl.type === 'pairChain') return null
  const best = enumerateBeats(hand, prev)[0]
  return best ? { cards: best.cards, decl: best.decl } : null
}
