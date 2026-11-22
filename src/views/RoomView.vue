<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { botLevelLabel, configSummary } from '../label.js'
import { openFinalSummary, send, serverNow, store } from '../store.js'
import ConfigForm from '../components/ConfigForm.vue'
import ExtendDialog from '../components/ExtendDialog.vue'
import ResultDialog from '../components/ResultDialog.vue'
import { DEFAULT_ROOM_CONFIG, type BotLevel, type RoomConfig } from '../types.js'

const editing = ref(false)
const editConfig = ref<RoomConfig>({ ...DEFAULT_ROOM_CONFIG })
const showExtendDialog = ref(false)

const room = computed(() => store.room)
const isHost = computed(() => store.user?.id === room.value?.hostUserId)
const canStart = computed(() => (room.value?.players.length ?? 0) >= 2)
const iAmDelegated = computed(
  () => room.value?.players.find((p) => p.userId === store.user?.id)?.delegated ?? false,
)

const lastResult = computed(() => room.value?.lastResult ?? null)
const winnerName = computed(() => {
  const lr = lastResult.value
  if (!lr || lr.winnerSeat == null) return null
  return room.value?.players.find((p) => p.seat === lr.winnerSeat)?.nickname ?? '—'
})

function playerName(userId: number): string {
  return room.value?.players.find((p) => p.userId === userId)?.nickname ?? String(userId)
}

/** 头像加载失败 → 隐藏，名字照常显示 */
function hideBrokenImg(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
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

/** 添加电脑的难度选择（1新手/2普通/3高手；缺省 1 = 行为保持） */
const botLevel = ref<BotLevel>(1)

function addBot(): void {
  send('room.addBot', { level: botLevel.value })
}

function removeBot(userId: number): void {
  send('room.removeBot', { userId })
}

function cancelDelegate(): void {
  send('game.delegate', { delegated: false })
}

function doExtend(minutes: number): void {
  send('session.extend', { minutes })
  showExtendDialog.value = false
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
const nextGameAt = computed(() => room.value?.nextGameAt ?? null)
/** 局间纯文字倒计时（洗牌动画只在打牌界面，房间不放动画） */
const nextGameSecs = computed(() =>
  nextGameAt.value != null
    ? Math.ceil(Math.max(0, nextGameAt.value - tick.value) / 1000)
    : null,
)
const sessionExpiredWaiting = computed(
  () => room.value?.sessionEndsAt != null && sessionRemain.value === 0,
)

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
          <template v-if="sessionRemain != null && !sessionExpiredWaiting">
            · 本场剩余 {{ fmtMs(sessionRemain) }}
          </template>
          <template v-else-if="sessionExpiredWaiting"> · 本场时间已到</template>
        </p>
        <p v-if="nextGameSecs != null" class="next-hint">
          {{ nextGameSecs }} 秒后自动开局
        </p>
      </div>
    </header>
    <!-- 按钮行固定在标题下方：增减按钮不再挤动标题区 -->
    <div class="actions">
      <button v-if="isHost && !editing" class="ghost" @click="startEdit()">修改配置</button>
      <select
        v-if="isHost && !editing && room.players.length < room.config.maxPlayers"
        v-model="botLevel"
        class="level-select"
        aria-label="电脑难度"
      >
        <option :value="1">{{ botLevelLabel(1) }}</option>
        <option :value="2">{{ botLevelLabel(2) }}</option>
        <option :value="3">{{ botLevelLabel(3) }}</option>
      </select>
      <button
        v-if="isHost && !editing && room.players.length < room.config.maxPlayers"
        class="ghost"
        @click="addBot()"
      >
        添加电脑
      </button>
      <button
        v-if="room.sessionSummary"
        class="ghost"
        @click="openFinalSummary(room.sessionSummary)"
      >
        查看本场结算
      </button>
      <button v-if="iAmDelegated" class="ghost" @click="cancelDelegate()">取消托管</button>
      <button
        v-if="isHost && room.sessionEndsAt != null"
        class="ghost"
        @click="showExtendDialog = true"
      >
        加时
      </button>
      <button class="ghost" @click="leave()">离开房间</button>
      <button v-if="isHost && canStart && !editing" @click="startGame()">开始游戏</button>
    </div>

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
        <img
          class="avatar-sm"
          :src="p.isBot ? '/images/avatars/bot.png' : '/images/avatars/default.png'"
          :alt="p.nickname"
          @error="hideBrokenImg"
        />
        <span class="name">
          {{ p.nickname }}
          <em v-if="p.userId === room.hostUserId" class="host-tag"
            ><span class="icon" style="--i: url('/images/icons/host.svg')"></span>房主</em
          >
          <em v-if="p.isBot" class="bot-tag"
            ><span class="icon" style="--i: url('/images/icons/bot.svg')"></span
            >电脑·{{ botLevelLabel(p.botLevel) }}</em
          >
          <em v-if="p.delegated && !p.isBot" class="delegated-tag"
            ><span class="icon" style="--i: url('/images/icons/delegate.svg')"></span>托管</em
          >
        </span>
        <span class="dot" :class="{ on: p.online }"></span>
        <span class="score">{{ p.score }}分</span>
        <button
          v-if="isHost && p.isBot && !editing"
          class="ghost small"
          @click="removeBot(p.userId)"
        >
          移除
        </button>
      </li>
    </ul>

    <p v-if="room.players.length < 2" class="hint">等待其他玩家加入…（至少 2 人才能开始）</p>
    <p v-else-if="isHost" class="hint">点击「开始游戏」开局</p>
    <p v-else class="hint">等待房主开始游戏…</p>

    <ResultDialog
      v-if="store.finalSummary"
      :result="null"
      :hands="[]"
      :summary="store.finalSummary"
    />

    <ExtendDialog
      v-if="showExtendDialog"
      @confirm="doExtend"
      @cancel="showExtendDialog = false"
    />

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
/* 局间自动开局提示：纯文字（洗牌动画只在打牌界面） */
.next-hint {
  margin: 6px 0 0;
  color: #4a90d9;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
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
  gap: 10px;
  background: var(--panel, #fff);
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 10px 12px;
}
.seat {
  color: #999;
  font-size: 13px;
  width: 48px;
  flex-shrink: 0;
}
.avatar-sm {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
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
.bot-tag {
  font-style: normal;
  font-size: 11px;
  background: #c5cae9;
  color: #283593;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
.delegated-tag {
  font-style: normal;
  font-size: 11px;
  background: #ffe0b2;
  color: #e65100;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
button.small {
  padding: 5px 12px;
  font-size: 13px;
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
  flex-shrink: 0;
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
/* 电脑难度下拉：与 ghost 按钮同高同底，行内不撑动布局 */
.level-select {
  padding: 9px 8px;
  border: none;
  border-radius: 8px;
  background: #f0f0f0;
  color: #555;
  font-size: 14px;
  cursor: pointer;
}
.level-select:hover {
  background: #e4e4e4;
}

@media (max-width: 640px) {
  .room {
    padding: 16px 12px;
  }
  .players li {
    gap: 8px;
    padding: 10px;
  }
}
</style>
