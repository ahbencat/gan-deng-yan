import { describe, expect, it } from 'vitest'
import { applyPlay, createGame, normalizeSeenRanks } from '../engine.js'
import { mulberry32 } from '../rng.js'
import { baseState, mk } from './helpers.js'
import type { GameState } from '../../types.js'

const seats2 = [
  { seat: 0, userId: 1, nickname: 'P1' },
  { seat: 1, userId: 2, nickname: 'P2' },
]

describe('seenRanks 记牌计数', () => {
  it('createGame 初始 seenRanks 全 0（长度 18）', () => {
    const state = createGame({
      gameId: 1,
      roomId: 1,
      config: { wildCount: 2, maxPlayers: 2, turnSeconds: 30, gameMinutes: 10 },
      seats: seats2,
      dealerSeat: 0,
      rng: mulberry32(1),
      now: 0,
    })
    expect(state.seenRanks).toHaveLength(18)
    expect(state.seenRanks.every((v) => v === 0)).toBe(true)
  })

  it('applyPlay 按物理点数累计（声明点数不计）', () => {
    const state = baseState([mk(3, 4), mk(9)])
    const r = applyPlay(state, 0, [state.hands[0][0].id], { type: 'single', rank: 3 }, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.seenRanks[3]).toBe(1)
    expect(r.state.seenRanks[4]).toBe(0)
    expect(r.state.seenRanks[8]).toBe(0)
  })

  it('百搭按 16/17 物理点数计（对8 由王组成时声明点 8 不计）', () => {
    const hands = [mk(16, 16, 5), mk(9)]
    const w1 = hands[0][0]
    const w2 = hands[0][1]
    const r = applyPlay(
      baseState(hands),
      0,
      [w1.id, w2.id],
      { type: 'pair', rank: 8 },
      1000,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.seenRanks[16]).toBe(2)
    expect(r.state.seenRanks[8]).toBe(0) // 声明点数不计
  })

  it('逃生单出的王计 16', () => {
    const hands = [mk(16), mk(9)]
    const r = applyPlay(
      baseState(hands),
      0,
      [hands[0][0].id],
      { type: 'single', rank: 3 },
      1000,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.seenRanks[16]).toBe(1)
  })

  it('炸弹按张数累计', () => {
    const hands = [mk(4, 4, 4, 9), mk(9, 9)]
    const ids = hands[0].slice(0, 3).map((c) => c.id)
    const r = applyPlay(baseState(hands), 0, ids, { type: 'bomb', rank: 4, length: 3 }, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.seenRanks[4]).toBe(3)
  })

  it('normalizeSeenRanks 为旧状态补默认值且幂等', () => {
    const legacy = baseState([mk(3), mk(9)])
    delete (legacy as Partial<GameState>).seenRanks
    expect(Array.isArray((legacy as Partial<GameState>).seenRanks)).toBe(false)

    normalizeSeenRanks(legacy)
    expect(legacy.seenRanks).toHaveLength(18)
    expect(legacy.seenRanks.every((v) => v === 0)).toBe(true)

    const snapshot = [...legacy.seenRanks]
    normalizeSeenRanks(legacy) // 幂等：已有数组不动
    expect(legacy.seenRanks).toEqual(snapshot)
  })
})
