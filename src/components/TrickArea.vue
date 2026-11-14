<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { declLabel, rankLabel } from '../label.js'
import { serverNow } from '../store.js'
import type { PublicTrickState, TrickLogEntry } from '../types.js'
import CardView from './Card.vue'

const props = defineProps<{
  trick: PublicTrickState
  players: { seat: number; nickname: string }[]
  pileCount: number
  multiplier: number
  endsAt: number
  bombHistory: { seat: number; rank: number; n: number }[]
}>()

const lastPlay = computed(() => props.trick.lastPlay)
const lastPlayerName = computed(() =>
  lastPlay.value ? playerName(lastPlay.value.seat) : '',
)

function playerName(seat: number): string {
  return props.players.find((p) => p.seat === seat)?.nickname ?? `P${seat + 1}`
}

function logText(e: TrickLogEntry): string {
  const name = playerName(e.seat)
  if (e.kind === 'pass') return `${name}：过`
  if (e.kind === 'draw') return `${name}：补 ${e.count} 张`
  return `${name}：${declLabel(e.decl)}`
}

const recentLog = computed(() => props.trick.log.slice(-7).reverse())

// 总时长倒计时
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
</script>

<template>
  <div class="trick">
    <div class="topbar">
      <span class="stat">牌堆 <b>{{ pileCount }}</b> 张</span>
      <span class="stat" :class="{ hot: multiplier > 1 }">倍率 <b>×{{ multiplier }}</b></span>
      <span class="stat">总时长 <b>{{ totalText }}</b></span>
      <span v-if="bombHistory.length" class="stat bombs">
        炸弹：
        <em v-for="(b, i) in bombHistory" :key="i">
          {{ playerName(b.seat) }}·{{ rankLabel(b.rank) }}×{{ b.n }}
        </em>
      </span>
    </div>

    <div class="stage">
      <div v-if="lastPlay" class="play">
        <span class="who">{{ lastPlayerName }}</span>
        <div class="cards">
          <CardView v-for="c in lastPlay.cards" :key="c.id" :card="c" small />
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
}
.stat b {
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.stat.hot b {
  color: #ffab40;
}
.bombs em {
  font-style: normal;
  color: #ffcc80;
  margin-left: 6px;
}
.stage {
  background: rgb(0 0 0 / 25%);
  border-radius: 14px;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}
.play {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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
.log {
  color: #cfd8dc;
  font-size: 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 70px;
  justify-content: flex-end;
}
.log p {
  margin: 0;
  opacity: 0.85;
}
.log p:first-child {
  opacity: 1;
  color: #fff;
}
</style>
