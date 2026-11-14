import {
  RANK_2,
  RANK_BIG_JOKER,
  RANK_MIN,
  RANK_SMALL_JOKER,
  isWild,
  type Card,
} from '../types.js'
import type { Rng } from './rng.js'
import { shuffle } from './rng.js'

/**
 * buildDeck(wildCount)：52 自然牌 + 大王 ceil(n/2) + 小王 floor(n/2)
 * wildCount ∈ {2,3,4}：2=1大1小、3=2大1小、4=2大2小（总牌数 54/55/56）
 */
export function buildDeck(wildCount: number): Card[] {
  if (wildCount !== 2 && wildCount !== 3 && wildCount !== 4) {
    throw new Error(`非法百搭数: ${wildCount}`)
  }
  const cards: Card[] = []
  let id = 0
  for (let rank = RANK_MIN; rank <= RANK_2; rank++) {
    for (let suit = 0; suit < 4; suit++) {
      cards.push({ id: id++, rank, suit })
    }
  }
  const bigJokers = Math.ceil(wildCount / 2)
  const smallJokers = Math.floor(wildCount / 2)
  for (let i = 0; i < bigJokers; i++) cards.push({ id: id++, rank: RANK_BIG_JOKER, suit: 4 })
  for (let i = 0; i < smallJokers; i++) cards.push({ id: id++, rank: RANK_SMALL_JOKER, suit: 4 })
  return cards
}

export function deckSize(wildCount: number): number {
  return 52 + wildCount
}

/**
 * 发牌：庄家 6 张、闲家各 5 张，剩余为公共牌堆。
 * 8 人最多发 41 张 < 52，牌堆恒非负。
 */
export function deal(
  deck: Card[],
  playerCount: number,
  dealerSeat: number,
): { hands: Card[][]; pile: Card[] } {
  if (playerCount < 2) throw new Error('至少需要 2 名玩家')
  if (dealerSeat < 0 || dealerSeat >= playerCount) throw new Error('庄家座位越界')
  const hands: Card[][] = Array.from({ length: playerCount }, () => [])
  let idx = 0
  for (let i = 0; i < playerCount; i++) {
    const seat = (dealerSeat + i) % playerCount
    const count = seat === dealerSeat ? 6 : 5
    hands[seat] = deck.slice(idx, idx + count)
    idx += count
  }
  const pile = deck.slice(idx)
  return { hands, pile }
}

/** 洗牌并按庄家发牌 */
export function dealShuffled(
  wildCount: number,
  playerCount: number,
  dealerSeat: number,
  rng: Rng,
): { hands: Card[][]; pile: Card[] } {
  const deck = shuffle(buildDeck(wildCount), rng)
  return deal(deck, playerCount, dealerSeat)
}

/** 手牌排序：按 rank 升序，百搭置尾（同 rank 按花色） */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const aw = isWild(a.rank) ? 1 : 0
    const bw = isWild(b.rank) ? 1 : 0
    if (aw !== bw) return aw - bw
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.suit - b.suit
  })
}

export const RANK_LABELS: Record<number, string> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
  16: '小王',
  17: '大王',
}

export const SUIT_SYMBOLS = ['♠', '♥', '♣', '♦']

export function cardLabel(card: Card): string {
  if (isWild(card.rank)) return RANK_LABELS[card.rank]
  return `${SUIT_SYMBOLS[card.suit]}${RANK_LABELS[card.rank]}`
}
