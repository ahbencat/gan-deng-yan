<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { asset, iconStyle } from '../base.js'
import { declLabel, rankLabel } from '../label.js'
import { dismissResult, send, store } from '../store.js'
import { INTERMISSION_MS, type GameResult, type SessionSummary } from '../types.js'
import CardView from './Card.vue'
import ShuffleCountdown from './ShuffleCountdown.vue'

const props = defineProps<{
  /** 单局结果；summary 在场时为最终结算模式（局末见下方 defer） */
  result: GameResult | null
  hands: { seat: number; cards: { id: number; rank: number; suit: number }[] }[]
  summary: SessionSummary | null
}>()

/**
 * 展示模式：summary 在场即「本场总排名」，但局末 game.over 与 session.final 同时到达时，
 * 盘结算要先完整展示一个局间时长（与自动开局同源 INTERMISSION_MS）再切排名。
 * 房间页回看（result 为空）不延迟。计时器在场 == 总排名待显示。
 */
const deferTimer = ref<ReturnType<typeof setTimeout> | null>(null)
function clearDefer(): void {
  if (deferTimer.value) clearTimeout(deferTimer.value)
  deferTimer.value = null
}
watch(
  () => props.summary,
  (fs) => {
    clearDefer()
    if (fs && props.result) deferTimer.value = setTimeout(clearDefer, INTERMISSION_MS)
  },
  { immediate: true }, // 两条消息同批到达时，挂载即已有 summary，不能再等变化
)
onUnmounted(clearDefer)

const isFinal = computed(() => props.summary != null && deferTimer.value == null)

const players = computed(() => store.game?.public.players ?? [])

/** 本盘出现过的炸弹（结算框展示；final 模式无 game 快照则为空） */
const bombs = computed(() => store.game?.public.bombHistory ?? [])

/**
 * 赢家最后一手：终局快照 trick.log 尾部该座位的 play 条目
 * （log 只裁头部、尾部安全；game.over 不清 store.game，快照存活；流局/无记录隐藏）
 */
const winningPlay = computed(() => {
  const r = props.result
  if (isFinal.value || r?.winnerSeat == null) return null
  const log = store.game?.public.trick.log ?? []
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e.kind === 'play' && e.seat === r.winnerSeat) return e
  }
  return null
})

/** 结算时的房主决定（同 GameView canExtend 判定） */
const isHost = computed(() => store.user?.id === store.room?.hostUserId)
const busy = ref(false)

/** 再来一局：room.start 立即续局（startGame 内 clearNextGame 抢占 8s 自动连开） */
function playAgain(): void {
  if (busy.value) return
  busy.value = true
  send('room.start', {})
  setTimeout(() => {
    busy.value = false
  }, 1500)
}

/** 解散房间：全员回大厅（room.closed 广播会切走视图，无需本地 dismiss） */
function dissolve(): void {
  if (busy.value) return
  busy.value = true
  send('room.dissolve', {})
  setTimeout(() => {
    busy.value = false
  }, 1500)
}

function name(seat: number): string {
  return players.value.find((p) => p.seat === seat)?.nickname ?? `P${seat + 1}`
}

const headline = computed(() => {
  if (isFinal.value) return '本场结束 · 总排名'
  if (!props.result) return ''
  if (props.result.reason === 'draw' || props.result.winnerSeat == null) {
    return '流局（剩牌并列最少）'
  }
  return `${name(props.result.winnerSeat)} 获胜！`
})

const finalTotal = computed(() =>
  (props.summary?.rows ?? []).reduce((s, r) => s + r.totalDelta, 0),
)

// 局间洗牌倒计时（本场未耗尽 → 自动开下一局）
const nextGameAt = computed(() => store.room?.nextGameAt ?? null)

/** 总排名前 3 名奖牌（有色素材 → <img>，不用蒙版） */
function medalSrc(rank: number): string {
  if (rank === 1) return asset('/images/icons/trophy.svg')
  return asset(rank === 2 ? '/images/icons/medal-2.svg' : '/images/icons/medal-3.svg')
}

/** 插画/奖牌加载失败 → 隐藏，不影响布局 */
function hideBrokenImg(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div class="modal">
    <div class="dialog">
      <!-- 最终结算：本场累计总分排名（局末 defer 期间 isFinal 为 false → 先走盘结算） -->
      <template v-if="isFinal && summary">
        <h2>{{ headline }}</h2>
        <p class="multi">共 {{ summary.gameCount }} 局 · 本场累计得分</p>

        <p v-if="summary.rows.length === 0" class="no-games">本场无有效对局</p>
        <table v-else>
          <thead>
            <tr>
              <th>名次</th>
              <th>玩家</th>
              <th>本场总得分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in summary.rows" :key="r.userId" :class="{ top: r.rank === 1 }">
              <td class="rank">
                <img
                  v-if="r.rank <= 3"
                  class="medal"
                  :src="medalSrc(r.rank)"
                  alt=""
                  @error="hideBrokenImg"
                />{{ r.rank }}
              </td>
              <td>{{ r.nickname }}</td>
              <td :class="r.totalDelta >= 0 ? 'plus' : 'minus'">
                {{ r.totalDelta >= 0 ? '+' : '' }}{{ r.totalDelta }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="summary.rows.length" class="zero">合计 {{ finalTotal >= 0 ? '+' : '' }}{{ finalTotal }}（零和）</p>

        <div class="btns">
          <button @click="dismissResult()">返回房间</button>
          <button v-if="isHost" class="danger" :disabled="busy" @click="dissolve()">
            解散房间
          </button>
        </div>
      </template>

      <!-- 单局结果 -->
      <template v-else-if="result">
        <img
          v-if="result.winnerSeat != null"
          class="victory-art"
          :src="asset('/images/art/victory.png')"
          alt=""
          @error="hideBrokenImg"
        />
        <h2>{{ headline }}</h2>
        <p class="multi">炸弹累计倍率 <b>×{{ result.multiplier }}</b></p>

        <!-- 赢家最后一手（无出牌记录则整行隐藏）：与炸弹行同版式，pill 用蓝色标示牌型 -->
        <div v-if="winningPlay" class="last-play">
          <span class="last-play-label">最后一手 · {{ name(winningPlay.seat) }}</span>
          <span class="decl-chip">{{ declLabel(winningPlay.decl) }}</span>
          <div class="cards">
            <CardView v-for="c in winningPlay.cards" :key="c.id" :card="c" small />
          </div>
        </div>

        <!-- 本盘所有炸弹（无炸弹时整行隐藏） -->
        <div v-if="bombs.length" class="bombs">
          <span class="bombs-label">本盘炸弹</span>
          <span v-for="(b, i) in [...bombs].reverse()" :key="i" class="bomb-chip">
            {{ name(b.seat) }}·{{ rankLabel(b.rank) }}×{{ b.n }}
          </span>
        </div>

        <ShuffleCountdown v-if="nextGameAt != null" :deadline="nextGameAt" />

        <table>
          <thead>
            <tr>
              <th>玩家</th>
              <th>剩牌</th>
              <th>得分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in result.perPlayer" :key="p.seat">
              <td>
                {{ name(p.seat) }}
                <em
                  v-if="p.seat === result.winnerSeat"
                  class="win"
                  title="获胜"
                >
                  <span class="icon" :style="iconStyle('/images/icons/win.svg')"></span>
                </em>
                <em
                  v-if="!p.everPlayed"
                  class="gd"
                  title="整局未出牌（关瞪瞪），得分翻倍"
                >
                  <span class="icon" :style="iconStyle('/images/icons/glare.svg')"></span>
                </em>
              </td>
              <td>{{ p.remaining }} 张</td>
              <td :class="p.delta >= 0 ? 'plus' : 'minus'">
                {{ p.delta >= 0 ? '+' : '' }}{{ p.delta }}
              </td>
            </tr>
          </tbody>
        </table>

        <div class="hands">
          <div v-for="h in [...hands].sort((a, b) => a.seat - b.seat)" :key="h.seat" class="row">
            <span class="who">{{ name(h.seat) }}</span>
            <div class="cards">
              <CardView v-for="c in h.cards" :key="c.id" :card="c" small />
              <span v-if="h.cards.length === 0" class="empty">已出完</span>
            </div>
          </div>
        </div>

        <div class="btns">
          <template v-if="isHost">
            <button :disabled="busy" @click="playAgain()">再来一局</button>
            <button @click="dismissResult()">返回房间</button>
            <button class="danger" :disabled="busy" @click="dissolve()">解散房间</button>
          </template>
          <template v-else>
            <button @click="dismissResult()">返回房间</button>
          </template>
        </div>
        <p v-if="!isHost" class="host-hint">是否再来一局或解散房间，由房主决定</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.dialog {
  background: var(--panel, #fff);
  border-radius: 14px;
  padding: 26px;
  width: 440px;
  max-width: 94vw;
  max-height: 90vh;
  max-height: 90dvh;
  overflow: auto;
}
h2 {
  margin: 0 0 6px;
  text-align: center;
  font-size: 22px;
}
.multi {
  text-align: center;
  color: #666;
  font-size: 14px;
  margin: 0 0 16px;
}
.multi b {
  color: #e65100;
}
/* 结算框的居中信息行（本盘炸弹 / 赢家最后一手）：共用版式，pill 配色区分牌型与炸弹
   （弹窗自身可滚动，不受桌面无跳变约束） */
.bombs,
.last-play {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: -8px 0 16px;
}
.bombs-label,
.last-play-label {
  color: #888;
  font-size: 13px;
}
.bomb-chip,
.decl-chip {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.bomb-chip {
  background: #fff3e0;
  color: #e65100;
}
.decl-chip {
  background: #e3f2fd;
  color: #1565c0;
}
.no-games {
  text-align: center;
  color: #888;
  font-size: 14px;
  margin: 20px 0;
}
.zero {
  text-align: center;
  color: #888;
  font-size: 12px;
  margin: -6px 0 14px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  margin-bottom: 14px;
}
th,
td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #eee;
}
th {
  color: #888;
  font-weight: 500;
  font-size: 13px;
}
tr.top td {
  background: #fff8e1;
}
.rank {
  font-weight: 700;
  color: #e65100;
  width: 48px;
}
.medal {
  width: 16px;
  height: 16px;
  vertical-align: -3px;
  margin-right: 4px;
}
.victory-art {
  display: block;
  width: 100%;
  max-width: 360px;
  height: auto;
  margin: 0 auto 6px;
}
.win {
  font-style: normal;
  background: #ff8f00;
  color: #fff;
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 4px;
  margin-left: 6px;
  display: inline-flex;
  align-items: center;
}
.gd {
  font-style: normal;
  background: #ef5350;
  color: #fff;
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 4px;
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
}
.win .icon,
.gd .icon {
  width: 12px;
  height: 12px;
  margin-right: 0;
}
.plus {
  color: #2e7d32;
  font-weight: 700;
}
.minus {
  color: #d9534f;
  font-weight: 700;
}
.hands {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.who {
  width: 64px;
  font-size: 13px;
  color: #555;
  flex-shrink: 0;
}
.cards {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.empty {
  color: #2e7d32;
  font-size: 13px;
}
.btns {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
button {
  padding: 11px 34px;
  border: none;
  border-radius: 8px;
  background: #4a90d9;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
button:hover {
  background: #3a7bc0;
}
button.danger {
  background: #d9534f;
}
button.danger:hover {
  background: #c9302c;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.host-hint {
  text-align: center;
  color: #888;
  font-size: 12px;
  margin: 8px 0 0;
}

@media (max-width: 640px) {
  .dialog {
    padding: 18px;
  }
  h2 {
    font-size: 18px;
  }
  table {
    font-size: 13px;
  }
  th,
  td {
    padding: 6px 8px;
  }
  .who {
    width: 52px;
  }
  button {
    padding: 10px 28px;
  }
}
</style>
