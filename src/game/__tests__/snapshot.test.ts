import { describe, expect, it } from 'vitest'
import { STATE_VERSION } from '../../types.js'
import { applyPlay } from '../engine.js'
import { projectPublic, projectSnapshot } from '../snapshot.js'
import { baseState, mk } from './helpers.js'

/** 收集对象树里出现的所有 card id */
function collectIds(obj: unknown, out = new Set<number>()): Set<number> {
  if (Array.isArray(obj)) {
    for (const item of obj) collectIds(item, out)
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'id' && typeof v === 'number' && 'rank' in (obj as object)) {
        out.add(v)
      }
      collectIds(v, out)
    }
  }
  return out
}

describe('快照投影隐私', () => {
  it('公共快照不含任何手牌/牌堆 card id', () => {
    const a = mk(3, 4, 5)
    const b = mk(6, 7, 8)
    const state = baseState([a, b], { pile: mk(9, 10, 11) })
    const online = new Set([0, 1])
    const pub = projectPublic(state, online)

    const pubIds = collectIds(pub)
    const hidden = new Set<number>()
    for (const h of state.hands) for (const c of h) hidden.add(c.id)
    for (const c of state.pile) hidden.add(c.id)

    for (const id of pubIds) {
      expect(hidden.has(id)).toBe(false)
    }
    // 而手牌张数、牌堆张数等公开信息在
    expect(pub.players.map((p) => p.handCount)).toEqual([3, 3])
    expect(pub.pileCount).toBe(3)
  })

  it('出牌后：打出的牌在公共快照可见（已上桌），其余仍隐藏', () => {
    const a = mk(3, 4, 5)
    const b = mk(6, 7, 8)
    const state = baseState([a, b], { pile: mk(9, 10, 11) })
    const r = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const pub = projectPublic(r.state, new Set([0, 1]))
    const pubIds = collectIds(pub)
    // 打出的牌已上桌：公共快照应包含它
    expect(pubIds.has(a[0].id)).toBe(true)

    // 其余手牌/牌堆仍隐藏
    const hidden = new Set<number>()
    for (const h of r.state.hands) for (const c of h) hidden.add(c.id)
    for (const c of r.state.pile) hidden.add(c.id)
    for (const id of pubIds) {
      expect(hidden.has(id)).toBe(false)
    }
  })

  it('个性化快照含自己的手牌', () => {
    const a = mk(3, 4, 5)
    const b = mk(6, 7, 8)
    const state = baseState([a, b], { pile: mk(9) })
    const snap = projectSnapshot(state, 0, new Set([0]))
    expect(snap.you.seat).toBe(0)
    expect(snap.you.hand.map((c) => c.id)).toEqual(a.map((c) => c.id))
    expect(snap.public.players[1].handCount).toBe(3)
    expect(state.v).toBe(STATE_VERSION)
  })
})

describe('bot/托管投影', () => {
  it('bot 座位恒在线，isBot/delegated 透传', () => {
    const state = baseState([mk(3, 4), mk(6, 7)])
    // 真人 0 号离线；1 号是 bot 且托管 → 仍 online
    const pub = projectPublic(state, new Set(), new Set([1]), new Set([1]))
    expect(pub.players[0]).toMatchObject({
      online: false,
      isBot: false,
      delegated: false,
    })
    expect(pub.players[1]).toMatchObject({
      online: true,
      isBot: true,
      delegated: true,
    })
  })

  it('真人托管：isBot=false、delegated=true、在线不受影响', () => {
    const state = baseState([mk(3, 4), mk(6, 7)])
    const pub = projectPublic(state, new Set([0]), new Set(), new Set([0]))
    expect(pub.players[0]).toMatchObject({ online: true, isBot: false, delegated: true })
    expect(pub.players[1]).toMatchObject({ online: false, isBot: false, delegated: false })
  })

  it('缺省参：两个集合均为空（旧调用兼容）', () => {
    const state = baseState([mk(3, 4), mk(6, 7)])
    const pub = projectPublic(state, new Set([0]))
    for (const p of pub.players) {
      expect(p.isBot).toBe(false)
      expect(p.delegated).toBe(false)
    }
    expect(pub.players[0].online).toBe(true)
    expect(pub.players[1].online).toBe(false)
  })

  it('projectSnapshot 透传 bot/托管标记', () => {
    const state = baseState([mk(3, 4), mk(6, 7)])
    const snap = projectSnapshot(state, 0, new Set(), new Set([1]), new Set([1]))
    expect(snap.public.players[1]).toMatchObject({ isBot: true, delegated: true, online: true })
  })
})

describe('本场累计分投影', () => {
  it('sessionDelta 缺省为 0，按 seat 透传', () => {
    const state = baseState([mk(3, 4), mk(6, 7)])
    expect(
      projectPublic(state, new Set([0, 1])).players.map((p) => p.sessionDelta),
    ).toEqual([0, 0])

    const pub = projectPublic(
      state,
      new Set([0, 1]),
      new Set(),
      new Set(),
      new Map([
        [0, 12],
        [1, -12],
      ]),
    )
    expect(pub.players.map((p) => p.sessionDelta)).toEqual([12, -12])

    const snap = projectSnapshot(
      state,
      0,
      new Set(),
      new Set(),
      new Set(),
      new Map([[0, 12]]),
    )
    expect(snap.public.players[0].sessionDelta).toBe(12)
    expect(snap.public.players[1].sessionDelta).toBe(0)
  })
})
