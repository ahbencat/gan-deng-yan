// ============================================================================
// 前后端唯一类型源。server/ 与 src/game/ 均从这里 import。
//
// 规格来源：look_look.txt + 2026-11-14 用户确认 + 计划评审反馈。
// 显式假设（改动集中在本文件与对应单点函数）：
//  1. 单2/对2 不能被另一个2压，只能被炸弹压
//  2. 自然222是合法炸弹；百搭可配2炸/对2（2+王=对2、22+王=2炸）；全百搭对子/炸弹可声明 3~A 或 2
//  3. 超时并列最少牌 → 流局，不计分
//  4. 首局庄家=房主，再局=上局赢家（离开则房主）
//  5. 对局中不允许主动离房；关浏览器由超时托管
//  6. 计分：输家 = 剩牌张数 × 累计倍率 × (关瞪瞪?2:1)；赢家得总和；恒零和；超时赢家剩牌不计费
//  7. 回合超时：跟牌自动过；领出自动出最小合法牌（single<pair<straight<pairChain<bomb）
//  8. 回合 deadline 给 1s 网络宽限
// ============================================================================

// ---- 牌点 ----
export const RANK_MIN = 3
export const RANK_A = 14
export const RANK_2 = 15
export const RANK_SMALL_JOKER = 16
export const RANK_BIG_JOKER = 17

/** rank >= 16 即百搭（大小王）；花色不参与规则 */
export const isWild = (rank: number): boolean => rank >= RANK_SMALL_JOKER

export interface Card {
  id: number
  rank: number
  suit: number // 0..3 自然牌；王用 4
}

// ---- 牌型声明 ----
export type ComboType = 'single' | 'pair' | 'straight' | 'pairChain' | 'bomb'

/**
 * 出牌必须显式声明。straight/pairChain 的 rank 是起点，length 是张数/对数；
 * 终点 = rank+length-1 必须 ≤ RANK_A（2 不入顺子/连对）。
 * bomb 的 length 是张数（≥3），rank 可为 RANK_2。
 */
export type Decl =
  | { type: 'single'; rank: number }
  | { type: 'pair'; rank: number }
  | { type: 'straight'; rank: number; length: number }
  | { type: 'pairChain'; rank: number; length: number }
  | { type: 'bomb'; rank: number; length: number }

export interface Play {
  seat: number
  cards: Card[]
  decl: Decl
}

// ---- 房间配置 ----
export interface RoomConfig {
  /** 百搭个数：2=1大1小、3=2大1小、4=2大2小 */
  wildCount: 2 | 3 | 4
  maxPlayers: number // 2..8
  turnSeconds: number // 5..120
  /** 本场时长（分钟）：首局开局起算的总预算，局间自动连开直到耗尽 */
  gameMinutes: number // 1..60
}

export const ROOM_CONFIG_RANGE = {
  wildCount: [2, 3, 4] as const,
  maxPlayers: [2, 8] as const,
  turnSeconds: [5, 120] as const,
  gameMinutes: [1, 60] as const,
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  wildCount: 2,
  maxPlayers: 8,
  turnSeconds: 30,
  gameMinutes: 10,
}

// ---- 对局状态（整体持久化进 games.state_json） ----
export const STATE_VERSION = 1

export type TrickLogEntry =
  | { seat: number; kind: 'play'; cards: Card[]; decl: Decl }
  | { seat: number; kind: 'pass' }
  | { seat: number; kind: 'draw'; count: number }

export interface TrickState {
  leaderSeat: number
  /** null = 领出（必须出牌） */
  lastPlay: Play | null
  turnSeat: number
  /** 绝对时间戳 ms */
  turnDeadline: number
  log: TrickLogEntry[]
}

export interface BombHistoryEntry {
  seat: number
  rank: number
  n: number
}

export type GameEndReason = 'empty' | 'timeout' | 'draw'

export interface GameResultPlayer {
  seat: number
  userId: number
  remaining: number
  everPlayed: boolean
  delta: number
}

export interface GameResult {
  winnerSeat: number | null
  reason: GameEndReason
  perPlayer: GameResultPlayer[]
  multiplier: number
}

export interface SeatMeta {
  seat: number
  userId: number
  nickname: string
}

export interface GameState {
  v: number
  gameId: number
  roomId: number
  config: RoomConfig
  /** 下标即 seat（0..n-1） */
  seats: SeatMeta[]
  dealerSeat: number
  /** 下标即 seat */
  hands: Card[][]
  pile: Card[]
  phase: 'playing' | 'finished'
  trick: TrickState
  bombHistory: BombHistoryEntry[]
  /** 炸弹倍率累乘结果 */
  multiplier: number
  /** 关瞪瞪判定：是否成功出过牌 */
  everPlayed: boolean[]
  startedAt: number
  endsAt: number
  result: GameResult | null
  actionSeq: number
}

// ---- 快照（下发客户端） ----
export interface PublicPlayerState {
  seat: number
  userId: number
  nickname: string
  handCount: number
  online: boolean
  everPlayed: boolean
  isDealer: boolean
}

export interface PublicTrickState {
  leaderSeat: number
  lastPlay: Play | null
  turnSeat: number
  turnDeadline: number
  log: TrickLogEntry[]
}

/** 公共快照：绝不含任何手牌/牌堆内容 */
export interface PublicGameState {
  actionSeq: number
  phase: 'playing' | 'finished'
  players: PublicPlayerState[]
  pileCount: number
  trick: PublicTrickState
  multiplier: number
  bombHistory: BombHistoryEntry[]
  endsAt: number
}

/** 个性化快照：公共部分 + 自己的手牌 */
export interface GameSnapshot {
  public: PublicGameState
  you: { seat: number; hand: Card[] }
}

// ---- 用户 / 房间视图 ----
export interface UserPublic {
  id: number
  username: string
  nickname: string
  score: number
  gamesPlayed: number
  wins: number
}

export interface RoomPlayerState {
  userId: number
  nickname: string
  seat: number
  online: boolean
  score: number
}

export interface RoomState {
  id: number
  hostUserId: number
  status: 'waiting' | 'playing' | 'closed'
  config: RoomConfig
  players: RoomPlayerState[]
  lastResult: GameResult | null
  /** 本场截止时刻（绝对 ms）；null=未开局/本场已结束 */
  sessionEndsAt: number | null
  /** 自动开局下一局的时刻（绝对 ms）；局间等待期非 null */
  nextGameAt: number | null
}

export interface RoomListEntry {
  id: number
  hostName: string
  playerCount: number
  maxPlayers: number
  config: RoomConfig
  status: 'waiting' | 'playing'
}

// ---- WS 信封与消息 ----
export const WS_ENVELOPE_VERSION = 1

export interface Envelope<P = unknown> {
  v: typeof WS_ENVELOPE_VERSION
  type: string
  seq?: number
  payload: P
}

export interface ClientMessages {
  ping: Record<string, never>
  'lobby.list': Record<string, never>
  'room.create': { config: RoomConfig }
  'room.join': { roomId: number }
  'room.leave': Record<string, never>
  'room.config': { config: RoomConfig }
  'room.start': Record<string, never>
  'game.play': { cardIds: number[]; decl: Decl }
  'game.pass': Record<string, never>
  'game.sync': Record<string, never>
}

export interface ServerMessages {
  pong: { serverTime: number }
  error: { code: string; message: string; seq?: number }
  session: { user: UserPublic; room: RoomState | null; game: GameSnapshot | null }
  'lobby.list': { rooms: RoomListEntry[] }
  'room.state': RoomState
  'room.closed': { roomId: number; reason: string }
  'game.state': PublicGameState
  'game.hand': { seat: number; hand: Card[] }
  'game.over': { result: GameResult; hands: { seat: number; cards: Card[] }[] }
}

/** 关闭码约定（grand_strategy 同款思路） */
export const WS_CLOSE_KICKED = 4000 // 同账号在别处登录，被踢
export const WS_CLOSE_UNAUTHORIZED = 4001 // upgrade 鉴权失败

// ---- REST ----
export interface ApiMeResponse {
  user: UserPublic | null
}

export interface ApiLoginRequest {
  username: string
  password: string
}
