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
