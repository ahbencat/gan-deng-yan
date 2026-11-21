import { describe, expect, it } from 'vitest'
import { STATE_VERSION, type Play } from '../../types.js'
import {
  applyAutoMove,
  applyPass,
  applyPlay,
  applyTimeout,
  createGame,
  settleTimeout,
} from '../engine.js'
import { mulberry32 } from '../rng.js'
import { baseState, mk } from './helpers.js'

const seats4 = Array.from({ length: 4 }, (_, i) => ({
  seat: i,
  userId: i + 1,
  nickname: `P${i + 1}`,
}))

describe('createGame', () => {
  it('庄6闲5，剩余作牌堆，全牌守恒', () => {
    const state = createGame({
      gameId: 1,
      roomId: 1,
      config: { wildCount: 2, maxPlayers: 4, turnSeconds: 30, gameMinutes: 10 },
      seats: seats4,
      dealerSeat: 0,
      rng: mulberry32(42),
      now: 1000,
    })
    expect(state.v).toBe(STATE_VERSION)
    expect(state.hands.map((h) => h.length)).toEqual([6, 5, 5, 5])
    expect(state.pile).toHaveLength(54 - 21)
    const all = [...state.hands.flat(), ...state.pile]
    expect(new Set(all.map((c) => c.id)).size).toBe(54)
    expect(state.trick.turnSeat).toBe(0)
    expect(state.trick.leaderSeat).toBe(0)
    expect(state.trick.lastPlay).toBeNull()
    expect(state.trick.turnDeadline).toBe(1000 + 30_000)
    expect(state.endsAt).toBe(1000 + 10 * 60_000)
    expect(state.multiplier).toBe(1)
    expect(state.result).toBeNull()
  })

  it('百搭3/4时总牌数55/56', () => {
    for (const [wildCount, total] of [
      [3, 55],
      [4, 56],
    ] as const) {
      const state = createGame({
        gameId: 1,
        roomId: 1,
        config: { wildCount, maxPlayers: 8, turnSeconds: 30, gameMinutes: 10 },
        seats: Array.from({ length: 8 }, (_, i) => ({ seat: i, userId: i + 1, nickname: `P${i}` })),
        dealerSeat: 3,
        rng: mulberry32(7),
        now: 0,
      })
      expect(state.hands.map((h) => h.length)).toEqual([5, 5, 5, 6, 5, 5, 5, 5])
      expect(state.hands.flat().length + state.pile.length).toBe(total)
      expect(state.trick.turnSeat).toBe(3)
    }
  })
})

describe('applyPlay', () => {
  it('合法领出：更新 lastPlay/回合/出牌标记，且不改动原状态', () => {
    const a = mk(3, 4)
    const state = baseState([a, mk(5, 6)])
    const r = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay).toEqual({
      seat: 0,
      cards: [a[0]],
      decl: { type: 'single', rank: 3 },
    })
    expect(r.state.trick.turnSeat).toBe(1)
    expect(r.state.everPlayed[0]).toBe(true)
    expect(r.state.actionSeq).toBe(1)
    expect(r.state.hands[0]).toHaveLength(1)
    expect(state.hands[0]).toHaveLength(2) // 纯函数：原状态不变
    expect(state.actionSeq).toBe(0)
  })

  it('非本人回合拒绝', () => {
    const state = baseState([mk(3, 4), mk(5, 6)])
    const r = applyPlay(state, 1, [999], { type: 'single', rank: 5 }, 0)
    expect(r).toEqual({ ok: false, error: '还没轮到你出牌' })
  })

  it('空选牌/重复/不在手牌均拒绝', () => {
    const a = mk(3, 4)
    const state = baseState([a, mk(5, 6)])
    expect(applyPlay(state, 0, [], { type: 'single', rank: 3 }, 0)).toEqual({
      ok: false,
      error: '没有选择要出的牌',
    })
    expect(applyPlay(state, 0, [a[0].id, a[0].id], { type: 'single', rank: 3 }, 0)).toEqual({
      ok: false,
      error: '选择的牌有重复',
    })
    expect(applyPlay(state, 0, [99999], { type: 'single', rank: 3 }, 0)).toEqual({
      ok: false,
      error: '有牌不在你手中',
    })
  })

  it('牌型不合法拒绝', () => {
    const a = mk(5, 5, 6)
    const state = baseState([a, mk(3, 4)])
    const r = applyPlay(state, 0, [a[0].id, a[1].id, a[2].id], { type: 'straight', rank: 5, length: 3 }, 0)
    expect(r).toEqual({ ok: false, error: '牌型不合法' })
  })

  it('压不过上家拒绝', () => {
    const state = baseState([mk(3, 4), mk(5, 6)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: mk(4), decl: { type: 'single', rank: 4 } },
        turnSeat: 0,
        turnDeadline: 30_000,
        log: [],
      },
    })
    const r = applyPlay(state, 0, [state.hands[0][0].id], { type: 'single', rank: 3 }, 0)
    expect(r).toEqual({ ok: false, error: '压不过上家的牌' })
  })

  it('炸弹压单张2（引擎层）', () => {
    const a = mk(7, 7, 7, 3)
    const state = baseState([a, mk(5, 6)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: mk(15), decl: { type: 'single', rank: 15 } },
        turnSeat: 0,
        turnDeadline: 30_000,
        log: [],
      },
    })
    const r = applyPlay(state, 0, [a[0].id, a[1].id, a[2].id], { type: 'bomb', rank: 7, length: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.multiplier).toBe(2)
    expect(r.state.bombHistory).toEqual([{ seat: 0, rank: 7, n: 3 }])
    expect(r.state.trick.turnSeat).toBe(1)
  })

  it('出完最后一张牌立即获胜', () => {
    const a = mk(3)
    const state = baseState([a, mk(5, 6)])
    const r = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
    expect(r.state.result?.reason).toBe('empty')
    // P1 关瞪瞪（整局未出牌）：2张×1×2=4
    expect(r.state.result?.perPlayer.map((p) => p.delta)).toEqual([4, -4])
    expect(r.state.result?.perPlayer.reduce((s, p) => s + p.delta, 0)).toBe(0)
  })

  it('领出且仅剩1张百搭可单出（逃生）并获胜', () => {
    const w = mk(16)
    const state = baseState([w, mk(5, 6)])
    const r = applyPlay(state, 0, [w[0].id], { type: 'single', rank: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
  })

  it('跟牌时百搭不能单出', () => {
    const w = mk(16)
    const state = baseState([w, mk(6, 7)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: mk(5), decl: { type: 'single', rank: 5 } },
        turnSeat: 0,
        turnDeadline: 30_000,
        log: [],
      },
    })
    const r = applyPlay(state, 0, [w[0].id], { type: 'single', rank: 5 }, 0)
    expect(r).toEqual({ ok: false, error: '牌型不合法' })
  })
})

describe('applyPass 与补牌', () => {
  it('领出不能过', () => {
    const state = baseState([mk(3, 4), mk(5, 6)])
    expect(applyPass(state, 0, 0)).toEqual({ ok: false, error: '领出必须出牌，不能过' })
  })

  it('非本人回合不能过', () => {
    const state = baseState([mk(3, 4), mk(5, 6)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: mk(5), decl: { type: 'single', rank: 5 } },
        turnSeat: 0,
        turnDeadline: 30_000,
        log: [],
      },
    })
    expect(applyPass(state, 1, 0)).toEqual({ ok: false, error: '还没轮到你' })
  })

  it('2人局过牌循环：回到出牌者补1张并领出', () => {
    const a = mk(3, 4)
    const state = baseState([a, mk(5, 6)], { pile: mk(9) })
    const r1 = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyPass(r1.state, 1, 1000)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const s = r2.state
    expect(s.trick.lastPlay).toBeNull()
    expect(s.trick.turnSeat).toBe(0)
    expect(s.trick.leaderSeat).toBe(0)
    expect(s.pile).toHaveLength(0)
    expect(s.hands[0].map((c) => c.rank)).toEqual([4, 9]) // 补到9
    expect(s.trick.log.some((e) => e.kind === 'draw')).toBe(true)
    expect(s.trick.turnDeadline).toBe(1000 + 30_000)
  })

  it('牌堆空时跳过补牌', () => {
    const a = mk(3, 4)
    const state = baseState([a, mk(5, 6)], { pile: [] })
    const r1 = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = applyPass(r1.state, 1, 1000)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.state.hands[0].map((c) => c.rank)).toEqual([4])
    expect(r2.state.trick.log.some((e) => e.kind === 'draw')).toBe(false)
    expect(r2.state.trick.lastPlay).toBeNull()
  })

  it('3人局：跟牌者出牌后轮转，过牌回到出牌者', () => {
    const a = mk(3, 4, 5)
    const state = baseState([a, mk(7, 8), mk(9, 10)], { pile: mk(11) })
    // P0 出3 → P1 出4 → P2 过 → 回到 P0（=lastPlay.seat? 不，lastPlay 是 P1 的4）
    const r1 = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    // P1 手里是7,8 —— 单7压不了单3（正好大1才行）
    const r2 = applyPlay(r1.state, 1, [r1.state.hands[1][0].id], { type: 'single', rank: 7 }, 0)
    expect(r2).toEqual({ ok: false, error: '压不过上家的牌' })
    // P1 过 → 轮到 P2，P2 过 → 回到 P0（lastPlay.seat=0）→ P0 补牌领出
    const p1 = applyPass(r1.state, 1, 0)
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    expect(p1.state.trick.turnSeat).toBe(2)
    const p2 = applyPass(p1.state, 2, 0)
    expect(p2.ok).toBe(true)
    if (!p2.ok) return
    expect(p2.state.trick.turnSeat).toBe(0)
    expect(p2.state.trick.lastPlay).toBeNull()
    expect(p2.state.hands[0]).toHaveLength(3) // 4,5 + 补的11
    expect(p2.state.pile).toHaveLength(0)
  })
})

describe('applyTimeout', () => {
  it('跟牌超时自动过', () => {
    // P1 已出的5不再在其手牌中（数据与 lastPlay 一致）
    const playedFive = mk(5)
    const state = baseState([mk(3, 4), mk(6)], {
      pile: mk(9),
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: playedFive, decl: { type: 'single', rank: 5 } },
        turnSeat: 0,
        turnDeadline: 0,
        log: [],
      },
    })
    const r = applyTimeout(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.log).toContainEqual({ seat: 0, kind: 'pass' })
    // 2人局：P0过 → 回到P1（lastPlay.seat）→ 本轮结束，P1领出（补到9）
    expect(r.state.trick.lastPlay).toBeNull()
    expect(r.state.trick.turnSeat).toBe(1)
    expect(r.state.hands[1].map((c) => c.rank)).toEqual([6, 9])
  })

  it('领出超时自动出最小单张', () => {
    const state = baseState([mk(7, 3), mk(5, 6)])
    const r = applyTimeout(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay?.decl).toEqual({ type: 'single', rank: 3 })
    expect(r.state.trick.turnSeat).toBe(1)
  })

  it('领出超时仅剩1张百搭：逃生单出即胜', () => {
    const state = baseState([mk(16), mk(5, 6)])
    const r = applyTimeout(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
  })

  it('领出超时全百搭≥2张：出最小对子', () => {
    const state = baseState([mk(16, 17), mk(5, 6)])
    const r = applyTimeout(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay?.decl).toEqual({ type: 'pair', rank: 3 })
    expect(r.state.hands[0]).toHaveLength(0)
  })
})

describe('applyAutoMove', () => {
  it('领出：出最小单张（同 pickAutoPlay）', () => {
    const state = baseState([mk(7, 3), mk(5, 6)])
    const r = applyAutoMove(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay?.decl).toEqual({ type: 'single', rank: 3 })
    expect(r.state.trick.turnSeat).toBe(1)
  })

  it('跟牌：压最小合法牌', () => {
    const playedFive = mk(5)
    const state = baseState([mk(6, 3), mk(9)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: playedFive, decl: { type: 'single', rank: 5 } },
        turnSeat: 0,
        turnDeadline: 0,
        log: [],
      },
    })
    const r = applyAutoMove(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.lastPlay?.decl).toEqual({ type: 'single', rank: 6 })
    expect(r.state.trick.log).toContainEqual({
      seat: 0,
      kind: 'play',
      cards: [expect.objectContaining({ rank: 6 })],
      decl: { type: 'single', rank: 6 },
    })
  })

  it('跟牌压不过：过牌（与 applyTimeout 不同——不弃权也能压时会压）', () => {
    const playedTen = mk(10)
    const state = baseState([mk(3, 4), mk(9)], {
      trick: {
        leaderSeat: 1,
        lastPlay: { seat: 1, cards: playedTen, decl: { type: 'single', rank: 10 } },
        turnSeat: 0,
        turnDeadline: 0,
        log: [],
      },
    })
    const r = applyAutoMove(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.trick.log).toContainEqual({ seat: 0, kind: 'pass' })
  })

  it('跟牌可压时不会像超时那样直接过（基础 bot 主动压）', () => {
    // 对照：applyTimeout 在跟牌态必过；applyAutoMove 有解必压
    const playedThree = mk(3)
    const mkState = () =>
      baseState([mk(4), mk(9)], {
        trick: {
          leaderSeat: 1,
          lastPlay: { seat: 1, cards: playedThree, decl: { type: 'single', rank: 3 } },
          turnSeat: 0,
          turnDeadline: 0,
          log: [],
        },
      })
    const timeoutR = applyTimeout(mkState(), 1000)
    expect(timeoutR.ok && timeoutR.state.trick.log.at(-1)).toEqual({ seat: 0, kind: 'pass' })
    const autoR = applyAutoMove(mkState(), 1000)
    expect(autoR.ok).toBe(true)
    if (!autoR.ok) return
    expect(autoR.state.trick.lastPlay?.decl).toEqual({ type: 'single', rank: 4 })
  })

  it('出完即赢：phase finished', () => {
    const state = baseState([mk(3), mk(5, 6)])
    const r = applyAutoMove(state, 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
  })

  it('已结束的对局拒绝', () => {
    const done = baseState([mk(3), mk(5, 6)], { phase: 'finished' as const })
    expect(applyAutoMove(done, 0)).toEqual({ ok: false, error: '对局已结束' })
  })
})

describe('settleTimeout', () => {
  it('总时长到期：剩牌最少者赢', () => {
    const state = baseState([mk(3, 4), mk(5, 6, 7, 8, 9), mk(10, 11, 12)], {
      everPlayed: [true, true, true],
    })
    const r = settleTimeout(state)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.phase).toBe('finished')
    expect(r.state.result?.winnerSeat).toBe(0)
    expect(r.state.result?.reason).toBe('timeout')
    expect(r.state.result?.perPlayer.map((p) => p.delta)).toEqual([8, -5, -3])
  })

  it('并列最少牌流局，不计分', () => {
    const state = baseState([mk(3, 4), mk(5, 6), mk(10, 11, 12)], {
      everPlayed: [true, true, true],
    })
    const r = settleTimeout(state)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.result?.winnerSeat).toBeNull()
    expect(r.state.result?.reason).toBe('draw')
    expect(r.state.result?.perPlayer.every((p) => p.delta === 0)).toBe(true)
  })
})

describe('已结束的对局拒绝一切动作', () => {
  const done = () =>
    baseState([mk(3), mk(5, 6)], { phase: 'finished' as const })

  it('出牌/过/超时/结算均拒绝', () => {
    expect(applyPlay(done(), 0, [1], { type: 'single', rank: 3 }, 0)).toEqual({
      ok: false,
      error: '对局已结束',
    })
    expect(applyPass(done(), 0, 0)).toEqual({ ok: false, error: '对局已结束' })
    expect(applyTimeout(done(), 0)).toEqual({ ok: false, error: '对局已结束' })
    expect(applyAutoMove(done(), 0)).toEqual({ ok: false, error: '对局已结束' })
    expect(settleTimeout(done())).toEqual({ ok: false, error: '对局已结束' })
  })
})

describe('lastPlay 结构（Play 类型）', () => {
  it('出牌产生完整 Play 结构', () => {
    const a = mk(3, 4)
    const state = baseState([a, mk(5, 6)])
    const r = applyPlay(state, 0, [a[0].id], { type: 'single', rank: 3 }, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const last: Play | null = r.state.trick.lastPlay
    expect(last?.seat).toBe(0)
    expect(last?.cards).toHaveLength(1)
    expect(last?.decl.type).toBe('single')
  })
})
