// 7 个固定 NPC 花名册：电脑玩家只从这里出人（旧 bot_N 账号留在库里但不再入选）
// 难度绑定座位（addBot 时房主选定，内存态）；花名册 brainId = 无难度时回退（smart，重启后保持中级）
import { getBrain, type BotBrain } from '../src/game/brain.js'
import type { BotLevel } from '../src/types.js'
import { findUserByUsername, getUserById, insertBotUser } from './users.js'

export interface NpcDef {
  /** 登录名（永不登录，is_bot=1） */
  username: string
  /** 展示昵称「xx xx的 xx」 */
  nickname: string
  /** 大脑 id（注册表未知 id 回退 basic）；无座位难度时回退值（花名册 = smart 中级） */
  brainId: string
}

/** 难度 → 大脑 id（src/game/brain.ts 注册表） */
export const BRAIN_ID_BY_LEVEL: Record<BotLevel, string> = {
  1: 'basic',
  2: 'smart',
  3: 'expert',
}

export const NPC_ROSTER: readonly NpcDef[] = [
  { username: 'npc_1', nickname: '稳如老狗的阿伟', brainId: 'smart' },
  { username: 'npc_2', nickname: '出牌如风的小林', brainId: 'smart' },
  { username: 'npc_3', nickname: '从不放水的陈姐', brainId: 'smart' },
  { username: 'npc_4', nickname: '爱抢出牌的阿香', brainId: 'smart' },
  { username: 'npc_5', nickname: '深藏不露的强哥', brainId: 'smart' },
  { username: 'npc_6', nickname: '运气爆棚的老周', brainId: 'smart' },
  { username: 'npc_7', nickname: '总爱诈唬的小马', brainId: 'smart' },
]

/** 启动幂等补齐 NPC 账号（insertBotUser：随机不可验证哈希、is_bot=1、只增不删） */
export function ensureNpcUsers(): void {
  for (const def of NPC_ROSTER) {
    if (!findUserByUsername(def.username)) insertBotUser(def.username, def.nickname)
  }
}

/** userId → brainId 缓存（账号属性启动后不变） */
const brainIdByUserId = new Map<number, string>()

/**
 * 解析出牌座位的大脑（自动步唯一入口）：座位难度优先（addBot 时选定，内存态）；
 * 无难度：花名册 NPC（重启后）→ brainId = smart 保持中级；
 * 真人托管 / 旧 bot_N / 未知 id → basic。
 * 花名册路径结果缓存，后续自动步零 DB 查询。
 */
export function brainForSeat(
  player: { userId: number; botLevel?: BotLevel } | undefined,
): BotBrain {
  if (player?.botLevel != null) return getBrain(BRAIN_ID_BY_LEVEL[player.botLevel])
  const userId = player?.userId ?? -1
  let brainId = brainIdByUserId.get(userId)
  if (brainId === undefined) {
    const row = getUserById(userId)
    const def = row ? NPC_ROSTER.find((d) => d.username === row.username) : undefined
    brainId = def?.brainId ?? 'basic'
    brainIdByUserId.set(userId, brainId)
  }
  return getBrain(brainId)
}
