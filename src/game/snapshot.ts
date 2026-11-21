import type {
  GameSnapshot,
  GameState,
  PublicGameState,
  PublicTrickState,
} from '../types.js'

/**
 * 公共快照投影：只含公开信息（手牌张数、牌堆张数、桌上牌、日志），
 * 绝不泄露任何手牌/牌堆内容。单测断言输出不含未公开 card id。
 * botSeats/delegatedSeats 缺省空集（电脑恒在线、非托管）。
 * sessionDeltaBySeat 缺省空（sessionDelta=0）——本场累计分由服务端按会话窗口聚合后传入。
 */
export function projectPublic(
  state: GameState,
  onlineSeats: ReadonlySet<number>,
  botSeats: ReadonlySet<number> = new Set(),
  delegatedSeats: ReadonlySet<number> = new Set(),
  sessionDeltaBySeat?: ReadonlyMap<number, number>,
): PublicGameState {
  const players = state.seats.map((s, i) => ({
    seat: s.seat,
    userId: s.userId,
    nickname: s.nickname,
    handCount: state.hands[i].length,
    online: onlineSeats.has(s.seat) || botSeats.has(s.seat),
    everPlayed: state.everPlayed[i],
    isDealer: s.seat === state.dealerSeat,
    isBot: botSeats.has(s.seat),
    delegated: delegatedSeats.has(s.seat),
    sessionDelta: sessionDeltaBySeat?.get(s.seat) ?? 0,
  }))

  const trick: PublicTrickState = {
    leaderSeat: state.trick.leaderSeat,
    lastPlay: state.trick.lastPlay,
    turnSeat: state.trick.turnSeat,
    turnDeadline: state.trick.turnDeadline,
    log: state.trick.log,
  }

  return {
    actionSeq: state.actionSeq,
    phase: state.phase,
    players,
    pileCount: state.pile.length,
    trick,
    multiplier: state.multiplier,
    bombHistory: state.bombHistory,
    endsAt: state.endsAt,
  }
}

/** 个性化快照：公共部分 + 自己的手牌 */
export function projectSnapshot(
  state: GameState,
  seat: number,
  onlineSeats: ReadonlySet<number>,
  botSeats: ReadonlySet<number> = new Set(),
  delegatedSeats: ReadonlySet<number> = new Set(),
  sessionDeltaBySeat?: ReadonlyMap<number, number>,
): GameSnapshot {
  return {
    public: projectPublic(state, onlineSeats, botSeats, delegatedSeats, sessionDeltaBySeat),
    you: { seat, hand: state.hands[seat] },
  }
}
