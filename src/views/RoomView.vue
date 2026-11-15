<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { configSummary } from '../label.js'
import { send, serverNow, store } from '../store.js'
import ConfigForm from '../components/ConfigForm.vue'
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from '../types.js'

const editing = ref(false)
const editConfig = ref<RoomConfig>({ ...DEFAULT_ROOM_CONFIG })

const room = computed(() => store.room)
const isHost = computed(() => store.user?.id === room.value?.hostUserId)
const canStart = computed(() => (room.value?.players.length ?? 0) >= 2)

const lastResult = computed(() => room.value?.lastResult ?? null)
const winnerName = computed(() => {
  const lr = lastResult.value
  if (!lr || lr.winnerSeat == null) return null
  return room.value?.players.find((p) => p.seat === lr.winnerSeat)?.nickname ?? '—'
})

function playerName(userId: number): string {
  return room.value?.players.find((p) => p.userId === userId)?.nickname ?? String(userId)
}

function startEdit(): void {
  if (!room.value) return
  editConfig.value = { ...room.value.config }
  editing.value = true
}

function saveConfig(): void {
  send('room.config', { config: editConfig.value })
  editing.value = false
}

function startGame(): void {
  send('room.start', {})
}

function leave(): void {
  send('room.leave', {})
}

// 本场剩余 / 自动开局倒计时
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

const sessionRemain = computed(() => {
  const ends = room.value?.sessionEndsAt
  return ends != null ? Math.max(0, ends - tick.value) : null
})
const nextIn = computed(() => {
  const at = room.value?.nextGameAt
  return at != null ? Math.max(0, Math.ceil((at - tick.value) / 1000)) : null
})

function fmtMs(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>

<template>
  <div class="room" v-if="room">
    <header>
      <div>
        <h2>房间 #{{ room.id }}</h2>
        <p class="cfg">
          {{ configSummary(room.config) }}
          <template v-if="sessionRemain != null"> · 本场剩余 {{ fmtMs(sessionRemain) }}</template>
        </p>
        <p v-if="nextIn != null" class="auto-next">{{ nextIn }} 秒后自动开局下一场</p>
      </div>
      <div class="actions">
        <button v-if="isHost && !editing" class="ghost" @click="startEdit()">修改配置</button>
        <button class="ghost" @click="leave()">离开房间</button>
        <button v-if="isHost && canStart && !editing" @click="startGame()">开始游戏</button>
      </div>
    </header>

    <div v-if="editing" class="edit-box">
      <h3>房间配置</h3>
      <ConfigForm v-model="editConfig" />
      <div class="btns">
        <button class="ghost" @click="editing = false">取消</button>
        <button @click="saveConfig()">保存</button>
      </div>
    </div>

    <ul class="players">
      <li v-for="p in room.players" :key="p.userId">
        <span class="seat">{{ p.seat + 1 }}号位</span>
        <span class="name">
          {{ p.nickname }}
          <em v-if="p.userId === room.hostUserId" class="host-tag">房主</em>
        </span>
        <span class="dot" :class="{ on: p.online }"></span>
        <span class="score">{{ p.score }}分</span>
      </li>
    </ul>

    <p v-if="room.players.length < 2" class="hint">等待其他玩家加入…（至少 2 人才能开始）</p>
    <p v-else-if="isHost" class="hint">点击「开始游戏」开局</p>
    <p v-else class="hint">等待房主开始游戏…</p>

    <div v-if="lastResult" class="last">
      <h3>上局结果</h3>
      <p v-if="winnerName">
        赢家：{{ winnerName }} · 倍率 ×{{ lastResult.multiplier }}
      </p>
      <p v-else>流局（剩牌并列最少）· 倍率 ×{{ lastResult.multiplier }}</p>
      <ul>
        <li v-for="rp in lastResult.perPlayer" :key="rp.seat">
          {{ playerName(rp.userId) }} 剩 {{ rp.remaining }} 张
          <em :class="rp.delta >= 0 ? 'plus' : 'minus'">
            {{ rp.delta >= 0 ? '+' : '' }}{{ rp.delta }}
          </em>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.room {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  margin: 0;
  font-size: 22px;
}
.cfg {
  margin: 6px 0 0;
  color: #888;
  font-size: 13px;
}
.auto-next {
  margin: 6px 0 0;
  color: #e65100;
  font-size: 13px;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 8px;
}
.edit-box {
  background: var(--panel, #fff);
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 16px;
  margin-top: 16px;
}
.edit-box h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.players {
  list-style: none;
  margin: 20px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.players li {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--panel, #fff);
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 12px 16px;
}
.seat {
  color: #999;
  font-size: 13px;
  width: 48px;
}
.name {
  flex: 1;
  font-weight: 600;
}
.host-tag {
  font-style: normal;
  font-size: 11px;
  background: #ffe0b2;
  color: #e65100;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ccc;
}
.dot.on {
  background: #4caf50;
}
.score {
  color: #666;
  font-size: 14px;
}
.hint {
  color: #888;
  font-size: 14px;
  text-align: center;
  margin-top: 18px;
}
.last {
  margin-top: 24px;
  background: var(--panel, #fff);
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 14px 16px;
}
.last h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #666;
}
.last p {
  margin: 0 0 8px;
  font-size: 14px;
}
.last ul {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.plus {
  color: #2e7d32;
  font-style: normal;
}
.minus {
  color: #d9534f;
  font-style: normal;
}
button {
  padding: 9px 18px;
  border: none;
  border-radius: 8px;
  background: #4a90d9;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
button:hover {
  background: #3a7bc0;
}
button.ghost {
  background: #f0f0f0;
  color: #555;
}
button.ghost:hover {
  background: #e4e4e4;
}
</style>
