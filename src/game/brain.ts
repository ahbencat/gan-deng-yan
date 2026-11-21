// 电脑大脑抽象：decide 只产出「意图」，合法性仍由 engine.applyPlay/applyPass 把关（输出不受信）
// 扩展方式见 README「电脑大脑（BotBrain）」：新大脑放 src/game/brains/，在本文件注册，
// 再把 server/npc.ts 花名册里对应 NPC 的 brainId 改掉。
import type { Card, Decl, GameState, Play, TrickLogEntry } from '../types.js'
import { basicBrain } from './brains/basic.js'

export interface BotDecision {
  cards: Card[]
  decl: Decl
}

/** 大脑可见信息：自己手牌 + 公开信息（绝不含他人手牌） */
export interface BotContext {
  hand: Card[]
  /** null = 领出（必须出牌） */
  prev: Play | null
  /** 公开出牌记录（含各家出的牌，不含任何手牌） */
  log: TrickLogEntry[]
  multiplier: number
  /** 各座位剩牌数（下标 = seat） */
  handCounts: number[]
}

export interface BotBrain {
  id: string
  /** 返回 null = 过牌（仅跟牌态合法；领出态由 applyAutoMove 兜底出牌） */
  decide(ctx: BotContext): BotDecision | null
}

/** 从引擎状态构造大脑上下文（只暴露公开信息 + 自己手牌） */
export function buildBrainContext(state: GameState, seat: number): BotContext {
  return {
    hand: state.hands[seat],
    prev: state.trick.lastPlay,
    log: state.trick.log,
    multiplier: state.multiplier,
    handCounts: state.hands.map((h) => h.length),
  }
}

const registry = new Map<string, BotBrain>()

export function registerBrain(brain: BotBrain): void {
  registry.set(brain.id, brain)
}

/** 未知 id 回退 basic（真人托管 / 旧 bot_N / 花名册笔误均安全） */
export function getBrain(id: string): BotBrain {
  return registry.get(id) ?? basicBrain
}

registerBrain(basicBrain)
