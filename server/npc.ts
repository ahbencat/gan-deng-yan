// 7 个固定 NPC 花名册：电脑玩家只从这里出人（旧 bot_N 账号留在库里但不再入选）
// 每个 NPC 绑定一个大脑 brainId（src/game/brain.ts 注册表；扩展方式见 README）
import { getBrain, type BotBrain } from '../src/game/brain.js'
import { findUserByUsername, getUserById, insertBotUser } from './users.js'

export interface NpcDef {
  /** 登录名（永不登录，is_bot=1） */
  username: string
  /** 展示昵称「xx xx的 xx」 */
  nickname: string
  /** 大脑 id（注册表未知 id 回退 basic） */
  brainId: string
}

export const NPC_ROSTER: readonly NpcDef[] = [
  { username: 'npc_1', nickname: '稳如老狗的阿伟', brainId: 'basic' },
  { username: 'npc_2', nickname: '出牌如风的小林', brainId: 'basic' },
  { username: 'npc_3', nickname: '从不放水的陈姐', brainId: 'basic' },
  { username: 'npc_4', nickname: '爱抢出牌的阿香', brainId: 'basic' },
  { username: 'npc_5', nickname: '深藏不露的强哥', brainId: 'basic' },
  { username: 'npc_6', nickname: '运气爆棚的老周', brainId: 'basic' },
  { username: 'npc_7', nickname: '总爱诈唬的小马', brainId: 'basic' },
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
 * 解析座位用户的大脑：NPC 按花名册；真人托管 / 旧 bot_N / 未知 → basic。
 * 结果缓存，后续自动步零 DB 查询。
 */
export function brainForUser(userId: number): BotBrain {
  let brainId = brainIdByUserId.get(userId)
  if (brainId === undefined) {
    const row = getUserById(userId)
    const def = row ? NPC_ROSTER.find((d) => d.username === row.username) : undefined
    brainId = def?.brainId ?? 'basic'
    brainIdByUserId.set(userId, brainId)
  }
  return getBrain(brainId)
}
