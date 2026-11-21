// 基础大脑：薄委托现有 pickAutoPlay / pickBeatingPlay（规则层逻辑零改动，与旧行为逐字节一致）
import type { BotBrain } from '../brain.js'
import { pickAutoPlay, pickBeatingPlay } from '../rules.js'

export const basicBrain: BotBrain = {
  id: 'basic',
  decide(ctx) {
    if (ctx.prev === null) return pickAutoPlay(ctx.hand)
    return pickBeatingPlay(ctx.hand, ctx.prev) // null → 调用方过牌
  },
}
