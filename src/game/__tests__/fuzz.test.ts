import { describe, expect, it } from 'vitest'
import { RANK_2, RANK_A, RANK_MIN, isWild, type Card, type Decl, type GameState, type Play } from '../../types.js'
import { buildDeck } from '../cards.js'
import { canForm } from '../combo.js'
import { applyPass, applyPlay, applyTimeout, createGame, settleTimeout } from '../engine.js'
import { mulberry32, type Rng } from '../rng.js'
import { canBeat, pickAutoPlay } from '../rules.js'

// ---------------------------------------------------------------------------
// 随机合法动作生成器：为声明构造手牌子集，canForm + canBeat 双重校验
// ---------------------------------------------------------------------------

function construct(hand: Card[], decl: Decl): Card[] | null {
  const wilds = hand.filter((c) => isWild(c.rank))
  const byRank = new Map<number, Card[]>()
  for (const c of hand) {
    if (isWild(c.rank)) continue
    const arr = byRank.get(c.rank) ?? []
    arr.push(c)
    byRank.set(c.rank, arr)
  }

  switch (decl.type) {
    case 'single': {
      if (isWild(decl.rank)) return null
      const arr = byRank.get(decl.rank)
      return arr && arr.length >= 1 ? [arr[0]] : null
    }
    case 'pair': {
      const nats = byRank.get(decl.rank) ?? []
      const use = Math.min(2, nats.length)
      const needWild = 2 - use
      if (wilds.length < needWild) return null
      return [...nats.slice(0, use), ...wilds.slice(0, needWild)]
    }
    case 'straight': {
      const out: Card[] = []
      const wildPool = [...wilds]
      for (let r = decl.rank; r < decl.rank + decl.length; r++) {
        const arr = byRank.get(r)
        if (arr && arr.length >= 1) out.push(arr[0])
        else {
          const w = wildPool.pop()
          if (!w) return null
          out.push(w)
        }
      }
      return out
    }
    case 'pairChain': {
      const out: Card[] = []
      const wildPool = [...wilds]
      for (let r = decl.rank; r < decl.rank + decl.length; r++) {
        const arr = byRank.get(r) ?? []
        const use = Math.min(2, arr.length)
        out.push(...arr.slice(0, use))
        for (let k = use; k < 2; k++) {
          const w = wildPool.pop()
          if (!w) return null
          out.push(w)
        }
      }
      return out
    }
    case 'bomb': {
      const nats = byRank.get(decl.rank) ?? []
      const use = Math.min(decl.length, nats.length)
      const needWild = decl.length - use
      if (wilds.length < needWild) return null
      return [...nats.slice(0, use), ...wilds.slice(0, needWild)]
    }
  }
}

/** 候选声明：跟牌=上家派生+全部炸弹（canBeat 过滤）；领出=全牌型采样 */
function sampleDecls(hand: Card[], prev: Play | null): Decl[] {
  const wilds = hand.filter((c) => isWild(c.rank)).length
  const natRanks = [...new Set(hand.filter((c) => !isWild(c.rank)).map((c) => c.rank))].sort(
    (a, b) => a - b,
  )
  const countOf = (r: number) => hand.filter((c) => c.rank === r).length
  const cands: Decl[] = []

  const addBombs = () => {
    for (const r of natRanks) {
      const avail = countOf(r) + wilds
      for (let len = 3; len <= avail; len++) cands.push({ type: 'bomb', rank: r, length: len })
    }
    if (wilds >= 3) {
      for (let r = RANK_MIN; r <= RANK_2; r++) {
        for (let len = 3; len <= wilds; len++) cands.push({ type: 'bomb', rank: r, length: len })
      }
    }
  }

  if (prev === null) {
    // 领出：单张、对子、顺子、连对、炸弹
    for (const r of natRanks) cands.push({ type: 'single', rank: r })
    for (const r of natRanks) cands.push({ type: 'pair', rank: r })
    if (wilds >= 2) for (let r = RANK_MIN; r <= RANK_2; r++) cands.push({ type: 'pair', rank: r })
    for (let len = 3; len <= 6; len++) {
      for (let s = RANK_MIN; s + len - 1 <= RANK_A; s++) cands.push({ type: 'straight', rank: s, length: len })
    }
    for (let len = 2; len <= 3; len++) {
      for (let s = RANK_MIN; s + len - 1 <= RANK_A; s++) cands.push({ type: 'pairChain', rank: s, length: len })
    }
    addBombs()
  } else {
    const a = prev.decl
    if (a.type === 'single' || a.type === 'pair') {
      if (a.rank + 1 <= RANK_2) cands.push({ type: a.type, rank: a.rank + 1 })
      if (a.rank !== RANK_2) cands.push({ type: a.type, rank: RANK_2 })
    } else if (a.type === 'straight' || a.type === 'pairChain') {
      cands.push({ type: a.type, rank: a.rank + 1, length: a.length })
    }
    addBombs()
  }
  return cands
}

/** 洗牌后依次尝试，返回第一个通过 canForm+canBeat 的合法着法 */
function findLegalPlay(
  hand: Card[],
  prev: Play | null,
  rng: Rng,
): { cardIds: number[]; decl: Decl } | null {
  const cands = sampleDecls(hand, prev)
  // Fisher-Yates 打乱尝试顺序
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = cands[i]
    cands[i] = cands[j]
    cands[j] = t
  }
  for (const decl of cands) {
    const cards = construct(hand, decl)
    if (!cards || cards.length === 0) continue
    if (!canForm(cards, decl)) continue
    if (!canBeat(prev, { decl })) continue
    return { cardIds: cards.map((c) => c.id), decl }
  }
  return null
}

// ---------------------------------------------------------------------------
// 不变量
// ---------------------------------------------------------------------------

function checkInvariants(
  state: GameState,
  deckIds: ReadonlySet<number>,
  playedIds: ReadonlySet<number>,
): void {
  const seen = new Set<number>()
  for (const h of state.hands) {
    for (const c of h) {
      expect(deckIds.has(c.id)).toBe(true)
      expect(seen.has(c.id)).toBe(false) // 手牌内/手牌间无重复
      expect(playedIds.has(c.id)).toBe(false) // 已出的牌不再回手/回堆
      seen.add(c.id)
    }
  }
  for (const c of state.pile) {
    expect(deckIds.has(c.id)).toBe(true)
    expect(seen.has(c.id)).toBe(false)
    expect(playedIds.has(c.id)).toBe(false)
    seen.add(c.id)
  }
  // 守恒：手牌+牌堆+已出 = 整副牌
  expect(seen.size + playedIds.size).toBe(deckIds.size)

  if (state.phase === 'finished' && state.result) {
    const sum = state.result.perPlayer.reduce((a, p) => a + p.delta, 0)
    expect(sum).toBe(0) // 恒零和
  }
}

function runRandomGame(seed: number, maxActions: number): GameState {
  const rng = mulberry32(seed)
  const wildCount = ([2, 3, 4] as const)[Math.floor(rng() * 3)]
  const playerCount = 2 + Math.floor(rng() * 7) // 2~8
  const seats = Array.from({ length: playerCount }, (_, i) => ({
    seat: i,
    userId: i + 1,
    nickname: `P${i + 1}`,
  }))
  const now = 1_000_000
  let state = createGame({
    gameId: seed,
    roomId: 1,
    config: { wildCount, maxPlayers: playerCount, turnSeconds: 30, gameMinutes: 10 },
    seats,
    dealerSeat: 0,
    rng,
    now,
  })

  const deckIds = new Set(buildDeck(wildCount).map((c) => c.id))
  const playedIds = new Set<number>()
  checkInvariants(state, deckIds, playedIds)

  let actions = 0
  while (state.phase === 'playing' && actions < maxActions) {
    actions++
    const seat = state.trick.turnSeat
    const hand = state.hands[seat]
    const prev = state.trick.lastPlay

    // 偶发：总时长到期结算 / 回合超时托管
    if (rng() < 0.02) {
      const r = settleTimeout(state)
      expect(r.ok).toBe(true)
      if (r.ok) state = r.state
      break
    }
    if (rng() < 0.05) {
      const r = applyTimeout(state, now + actions * 1000)
      expect(r.ok).toBe(true)
      if (r.ok) {
        collectPlayed(state, r.state, playedIds)
        state = r.state
      }
      checkInvariants(state, deckIds, playedIds)
      continue
    }

    if (prev !== null && rng() < 0.4) {
      const r = applyPass(state, seat, now + actions * 1000)
      expect(r.ok).toBe(true)
      if (r.ok) state = r.state
      checkInvariants(state, deckIds, playedIds)
      continue
    }

    const move = findLegalPlay(hand, prev, rng)
    if (move) {
      const r = applyPlay(state, seat, move.cardIds, move.decl, now + actions * 1000)
      expect(r.ok).toBe(true) // 生成器保证合法
      if (r.ok) {
        collectPlayed(state, r.state, playedIds)
        state = r.state
      }
    } else if (prev !== null) {
      const r = applyPass(state, seat, now + actions * 1000)
      expect(r.ok).toBe(true)
      if (r.ok) state = r.state
    } else {
      // 领出必有合法着法：兜底自动出牌
      const auto = pickAutoPlay(hand)
      const r = applyPlay(
        state,
        seat,
        auto.cards.map((c) => c.id),
        auto.decl,
        now + actions * 1000,
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        collectPlayed(state, r.state, playedIds)
        state = r.state
      }
    }
    checkInvariants(state, deckIds, playedIds)
  }

  expect(actions).toBeLessThanOrEqual(maxActions)
  expect(state.phase).toBe('finished')
  checkInvariants(state, deckIds, playedIds)
  return state
}

/** 对比动作前后手牌，收集本动作打出的牌 id */
function collectPlayed(before: GameState, after: GameState, playedIds: Set<number>): void {
  for (let i = 0; i < before.hands.length; i++) {
    const afterIds = new Set(after.hands[i].map((c) => c.id))
    for (const c of before.hands[i]) {
      if (!afterIds.has(c.id)) playedIds.add(c.id)
    }
  }
}

// ---------------------------------------------------------------------------

describe('fuzz 随机对局', () => {
  it('固定 seed 完整对局回放：必然终局且零和', () => {
    const state = runRandomGame(12345, 5000)
    expect(state.result).not.toBeNull()
    expect(state.actionSeq).toBeGreaterThan(0)
  })

  it('1000局随机合法动作：牌守恒/零和/必然终局/不抛错', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      runRandomGame(seed, 5000)
    }
  }, 60_000)
})
