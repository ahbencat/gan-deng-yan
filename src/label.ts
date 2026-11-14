// 牌型/牌点中文标签（前端展示用）
import { RANK_LABELS } from './game/cards.js'
import type { Card, Decl } from './types.js'

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank)
}

export function cardText(card: Card): string {
  if (card.rank >= 16) return RANK_LABELS[card.rank]
  const suits = ['♠', '♥', '♣', '♦']
  return `${suits[card.suit] ?? ''}${RANK_LABELS[card.rank]}`
}

function straightText(rank: number, length: number): string {
  const parts: string[] = []
  for (let i = 0; i < length; i++) parts.push(rankLabel(rank + i))
  return parts.join('')
}

function pairChainText(rank: number, length: number): string {
  const parts: string[] = []
  for (let i = 0; i < length; i++) {
    const r = rankLabel(rank + i)
    parts.push(r + r)
  }
  return parts.join('')
}

export function declLabel(decl: Decl): string {
  switch (decl.type) {
    case 'single':
      return `单张${rankLabel(decl.rank)}`
    case 'pair':
      return `对${rankLabel(decl.rank)}`
    case 'straight':
      return `顺子${straightText(decl.rank, decl.length)}`
    case 'pairChain':
      return `连对${pairChainText(decl.rank, decl.length)}`
    case 'bomb': {
      const name = decl.length === 4 ? '氢弹' : '炸弹'
      return `${name}${rankLabel(decl.rank)}×${decl.length}`
    }
  }
}

/** 房间配置摘要 */
export function configSummary(c: {
  wildCount: number
  maxPlayers: number
  turnSeconds: number
  gameMinutes: number
}): string {
  const wild =
    c.wildCount === 2 ? '2张(1大1小)' : c.wildCount === 3 ? '3张(2大1小)' : '4张(2大2小)'
  return `${wild} · ${c.maxPlayers}人 · 回合${c.turnSeconds}s · 总时长${c.gameMinutes}分钟`
}
