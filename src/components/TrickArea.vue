<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { iconStyle } from '../base.js'
import { declLabel, rankLabel } from '../label.js'
import { serverNow } from '../store.js'
import type { PublicTrickState, TrickLogEntry } from '../types.js'
import CardView from './Card.vue'

const props = defineProps<{
  trick: PublicTrickState
  /** 座位公开信息（含本场累计分，集中条由此派生，不再单独传） */
  players: { seat: number; nickname: string; sessionDelta: number }[]
  pileCount: number
  multiplier: number
  endsAt: number
  bombHistory: { seat: number; rank: number; n: number }[]
  /** 房主 + 本场进行中 → 显示加时按钮 */
  canExtend?: boolean
}>()

const emit = defineEmits<{ extend: [] }>()

const lastPlay = computed(() => props.trick.lastPlay)
const lastPlayerName = computed(() =>
  lastPlay.value ? playerName(lastPlay.value.seat) : '',
)
// 出牌动画触发键：座位 + 牌 id 组合变化 → 整块重建 → CSS 入场动画重放；
// 「过」等不改变 lastPlay 的动作不会改键，旧牌不重播动画
const playSig = computed(() => {
  const lp = lastPlay.value
  return lp ? `${lp.seat}:${lp.cards.map((c) => c.id).join(',')}` : 'lead'
})

function playerName(seat: number): string {
  return props.players.find((p) => p.seat === seat)?.nickname ?? `P${seat + 1}`
}

/** 本场积分集中条（players 已按座位序下发） */
const scores = computed(() =>
  props.players.map((p) => ({ seat: p.seat, nickname: p.nickname, delta: p.sessionDelta })),
)

function logText(e: TrickLogEntry): string {
  const name = playerName(e.seat)
  if (e.kind === 'pass') return `${name}：过`
  if (e.kind === 'draw') return `${name}：补 ${e.count} 张`
  return `${name}：${declLabel(e.decl)}`
}

const recentLog = computed(() => props.trick.log.slice(-7).reverse())

// 本场剩余倒计时（endsAt = 本场截止时刻）
const tick = ref(serverNow())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => {
    tick.value = serverNow()
  }, 500)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
const totalRemain = computed(() => Math.max(0, props.endsAt - tick.value))
const totalText = computed(() => {
  const s = Math.ceil(totalRemain.value / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
})
/** 本场已到点但当前局未结束 → 提示等待（不强制结算） */
const sessionExpired = computed(() => tick.value >= props.endsAt)
</script>

<template>
  <div class="trick">
    <div class="topbar">
      <span class="stat">牌堆 <b>{{ pileCount }}</b> 张</span>
      <span class="stat" :class="{ hot: multiplier > 1 }"
        ><span class="icon" :style="iconStyle('/images/icons/bomb.svg')"></span>倍率
        <b>×{{ multiplier }}</b></span
      >
      <span class="stat">本场剩余 <b>{{ totalText }}</b></span>
      <button
        v-if="canExtend"
        class="extend"
        title="为本场追加时长"
        @click="emit('extend')"
      >
        <span class="icon" :style="iconStyle('/images/icons/clock.svg')"></span>加时
      </button>
      <span v-if="sessionExpired" class="stat expired">时间已到 · 等待本局结束</span>
      <span v-if="bombHistory.length" class="stat bombs">
        炸弹：
        <em v-for="(b, i) in bombHistory" :key="i">
          {{ playerName(b.seat) }}·{{ rankLabel(b.rank) }}×{{ b.n }}
        </em>
      </span>
    </div>

    <!-- 本场积分集中显示（固定高度：分数位数变化不撑动桌面） -->
    <div class="scores">
      <span
        v-for="p in scores"
        :key="p.seat"
        class="score-item"
        :class="p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'flat'"
      >
        {{ p.nickname }} <b>{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}</b>
      </span>
    </div>

    <div class="stage">
      <div v-if="lastPlay" :key="playSig" class="play">
        <span class="who">{{ lastPlayerName }}</span>
        <div class="cards">
          <CardView v-for="c in lastPlay.cards" :key="c.id" :card="c" />
        </div>
        <span class="decl">{{ declLabel(lastPlay.decl) }}</span>
      </div>
      <p v-else class="lead-hint">{{ playerName(trick.leaderSeat) }} 领出</p>
    </div>

    <div class="log">
      <p v-for="(e, i) in recentLog" :key="`${trick.log.length}-${i}`">{{ logText(e) }}</p>
    </div>
  </div>
</template>

<style scoped>
.trick {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 560px;
}
.topbar {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
  color: #c8e6c9;
  font-size: 13px;
  /* 固定两行高：炸弹列表/「时间已到」出现时不再撑高桌面 */
  min-height: 44px;
  align-content: center;
}
.stat b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.stat.hot b {
  color: #ffab40;
}
.stat.hot .icon {
  color: #ffab40;
}
.stat.expired {
  color: #ffe082;
  font-weight: 600;
}
.extend {
  padding: 2px 10px;
  border: 1px solid rgb(255 255 255 / 40%);
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
  color: #ffe082;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  touch-action: manipulation;
  flex-shrink: 0;
}
.extend:hover {
  background: rgb(255 255 255 / 22%);
}
.bombs em {
  font-style: normal;
  color: #ffcc80;
  margin-left: 6px;
}
.stage {
  background: rgb(0 0 0 / 25%);
  border-radius: 14px;
  /* 固定高度：出牌区（出牌/声明/领出提示）与领出提示等高，不随桌面内容跳变 */
  height: 190px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  /* 河牌基线 = small 尺寸 44×64；宽高都充裕的窗口升大一号（见文末媒体查询） */
  --card-w: 44px;
  --card-h: 64px;
}
.play {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  /* 新一手牌入场：整块下沉落定（仅 transform/opacity，不改布局尺寸） */
  animation: play-in 0.35s cubic-bezier(0.2, 0.8, 0.3, 1.15);
}
@keyframes play-in {
  from {
    opacity: 0;
    transform: translateY(-14px) scale(0.82);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.cards .card {
  /* 牌面逐张落下，比整块入场略慢收尾 */
  animation: card-drop 0.3s ease-out backwards;
}
.cards .card:nth-child(2) {
  animation-delay: 0.05s;
}
.cards .card:nth-child(3) {
  animation-delay: 0.1s;
}
.cards .card:nth-child(4) {
  animation-delay: 0.15s;
}
.cards .card:nth-child(n + 5) {
  animation-delay: 0.2s;
}
@keyframes card-drop {
  from {
    opacity: 0;
    transform: translateY(-10px) rotate(-4deg);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.who {
  color: #ffe082;
  font-size: 13px;
}
.cards {
  display: flex;
  gap: 6px;
}
.decl {
  background: rgb(255 255 255 / 15%);
  color: #fff;
  font-size: 13px;
  padding: 3px 12px;
  border-radius: 999px;
}
.lead-hint {
  color: #a5d6a7;
  margin: 0;
  font-size: 14px;
}
/* 本场积分集中条：固定高度（分数/昵称变化不撑动桌面）。
   统一单行横滚（safe center：适配时居中，超宽退到起点可滚动，绝不裁内容） */
.scores {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-start;
  justify-content: safe center;
  align-items: center;
  gap: 2px 14px;
  height: 36px;
  overflow-x: auto;
  overflow-y: hidden;
  color: #c8e6c9;
  font-size: 12px;
  line-height: 16px;
  scrollbar-width: none;
}
.scores .score-item {
  white-space: nowrap;
}
.scores .up {
  color: #a5d6a7;
}
.scores .down {
  color: #ef9a9a;
}
.scores .flat {
  color: #bbb;
}
.scores b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.log {
  color: #cfd8dc;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 固定 5 行（5×16 + 4×3 = 92）：日志累积/换轮不再撑高桌面；高度让位给积分条 */
  height: 94px;
  justify-content: flex-end;
  overflow: hidden;
}
.log p {
  margin: 0;
  opacity: 0.85;
}
.log p:first-child {
  opacity: 1;
  color: #fff;
  /* 最新一条日志淡入（键含 log.length，追加时整组重建、仅首行命中此规则） */
  animation: log-in 0.3s ease-out;
}
@keyframes log-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .play,
  .cards .card,
  .log p:first-child {
    animation: none;
  }
}

@media (max-width: 640px) {
  /* 手机竖屏：桌面区整体压扁，每个断点内尺寸仍恒定（零跳变） */
  .trick {
    gap: 8px;
  }
  .topbar {
    /* 固定两行高：炸弹/「时间已到」出现换行也不撑高桌面 */
    min-height: 40px;
    height: 40px;
    font-size: 12px;
    gap: 4px 8px;
    overflow: hidden;
  }
  .stage {
    height: 130px;
    padding: 10px;
    /* 手机河牌维持原 small 尺寸（40×58） */
    --card-w: 40px;
    --card-h: 58px;
  }
  .scores {
    /* 高度让位给积分条；机制同基线（单行横滚） */
    height: 26px;
    font-size: 11px;
    line-height: 26px;
    gap: 12px;
  }
  .log {
    /* 2 行：2×14 + 2 = 30；顶对齐让溢出裁掉的是旧日志（新日志恒可见） */
    height: 36px;
    font-size: 11px;
    line-height: 14px;
    gap: 2px;
    justify-content: flex-start;
  }
  .who,
  .decl {
    font-size: 12px;
  }
  .lead-hint {
    font-size: 13px;
  }
}

@media (max-height: 500px) {
  /* 矮屏（横屏）：再压一号 */
  .trick {
    gap: 6px;
  }
  .topbar {
    min-height: 32px;
    height: 32px;
    font-size: 10px;
    gap: 4px 6px;
    overflow: hidden;
  }
  .stage {
    height: 96px;
    padding: 8px;
  }
  .scores {
    /* 矮屏（横屏）空间极紧：隐藏积分条，其余断点不受影响 */
    display: none;
  }
  .log {
    height: 32px;
    font-size: 10px;
    line-height: 12px;
    gap: 2px;
    justify-content: flex-start;
  }
  .who,
  .decl {
    font-size: 11px;
  }
  .lead-hint {
    font-size: 12px;
  }
}

@media (min-width: 641px) and (min-height: 501px) {
  /* 宽且高：河牌升大一号 58×84（窄屏由 ≤640 收到 40×58，矮窗维持基线） */
  .stage {
    --card-w: 58px;
    --card-h: 84px;
  }
}
</style>
