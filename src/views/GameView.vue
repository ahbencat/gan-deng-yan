<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { enumerateDeclarations } from '../game/combo.js'
import { canBeat } from '../game/rules.js'
import { useIsMobile, useIsShort } from '../media.js'
import { send, store } from '../store.js'
import { RANK_MIN, isWild, type Decl } from '../types.js'
import DeclDialog from '../components/DeclDialog.vue'
import ExtendDialog from '../components/ExtendDialog.vue'
import HandView from '../components/HandView.vue'
import PlayerSeat from '../components/PlayerSeat.vue'
import ResultDialog from '../components/ResultDialog.vue'
import ShuffleCountdown from '../components/ShuffleCountdown.vue'
import TrickArea from '../components/TrickArea.vue'

const showDeclDialog = ref(false)
const showExtendDialog = ref(false)
const selectedIds = ref<Set<number>>(new Set())

const game = computed(() => store.game)
const you = computed(() => game.value?.you)
const pub = computed(() => game.value?.public)

// ---- 环形围桌（桌面宽屏；窄屏/手机/矮屏自动回退顶部横排） ----
const isMobile = useIsMobile()
const isShort = useIsShort()

/** 环形小座位固定尺寸（与 PlayerSeat .seat.ring 对齐） */
const RING_W = 250
const RING_H = 40
/** 中央出牌面板近似半宽/半高（TrickArea：560 宽，topbar44+scores36+stage190+log94+3×gap10≈394 高） */
const TRICK_HALF_W = 280
const TRICK_HALF_H = 197

const gameEl = ref<HTMLElement | null>(null)
const bottomEl = ref<HTMLElement | null>(null)

/**
 * 环形可用区（.game 本地坐标，仅几何、与当前横排/环形模式无关，避免互锁振荡）：
 * 以「环形模式 .bottom 贴容器底、trick-wrap flex:1 吸收剩余空间」预测。
 */
const playSize = ref({ w: 0, h: 0, top: 0 })
/** 桌面中央洗牌的定位（跟随实际 TrickArea 中心，两种模式都准） */
const shufflePos = ref({ x: 0, y: 0 })
let ro: ResizeObserver | null = null

function remeasure(): void {
  const g = gameEl.value
  const b = bottomEl.value
  if (!g || !b) return
  const cs = getComputedStyle(g)
  const padT = parseFloat(cs.paddingTop) || 0
  const gap = parseFloat(cs.rowGap) || 0
  const w = g.clientWidth
  // 环形模式预测：bottomTop = 视口底 - padding - 座高；区域 = [padT, bottomTop - gap]
  // h = bottomTop - gap - padT = innerH - 2·padT - gap - bottomH
  const h = Math.max(0, window.innerHeight - padT * 2 - gap - b.offsetHeight)
  playSize.value = { w, h, top: padT }

  const trick = g.querySelector('.trick') as HTMLElement | null
  if (trick) {
    const gr = g.getBoundingClientRect()
    const tr = trick.getBoundingClientRect()
    shufflePos.value = {
      x: tr.left + tr.width / 2 - gr.left,
      y: tr.top + tr.height / 2 - gr.top,
    }
  }
}

/** 环形几何自检：1–7 个对手座位在预测区域内互不重叠、不压中央面板、不出边界 */
const ringFits = computed(() => {
  const p = pub.value
  const { w, h, top } = playSize.value
  if (!p || p.players.length < 2 || w < 700 || h < 446) return false
  const n = p.players.length
  const cx = w / 2
  const cy = top + h / 2
  const rx = w / 2 - RING_W / 2 - 4
  const ry = h / 2 - RING_H / 2 - 4
  if (rx <= 0 || ry <= 0) return false
  const trL = cx - TRICK_HALF_W - 4
  const trR = cx + TRICK_HALF_W + 4
  const trT = cy - TRICK_HALF_H - 4
  const trB = cy + TRICK_HALF_H + 4
  const rects: { l: number; r: number; t: number; b: number }[] = []
  for (let k = 0; k < n - 1; k++) {
    const a = Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n
    const x = cx + rx * Math.cos(a)
    const y = cy + ry * Math.sin(a)
    const r = {
      l: x - RING_W / 2,
      r: x + RING_W / 2,
      t: y - RING_H / 2,
      b: y + RING_H / 2,
    }
    if (r.l < 2 || r.r > w - 2 || r.t < top + 2 || r.b > top + h - 2) return false
    if (r.r > trL && r.l < trR && r.b > trT && r.t < trB) return false
    for (const o of rects) {
      if (r.r > o.l && r.l < o.r && r.b > o.t && r.t < o.b) return false
    }
    rects.push(r)
  }
  return true
})

const isRing = computed(() => !isMobile.value && !isShort.value && ringFits.value)

/** 座位 k（0 = 下家，已按顺时针排序）在椭圆上的位置；非环形返回 undefined */
function ringStyle(k: number): Record<string, string> | undefined {
  if (!isRing.value) return undefined
  const p = pub.value
  if (!p) return undefined
  const { w, h, top } = playSize.value
  const n = p.players.length
  const cx = w / 2
  const cy = top + h / 2
  const rx = Math.max(0, w / 2 - RING_W / 2 - 4)
  const ry = Math.max(0, h / 2 - RING_H / 2 - 4)
  // 屏幕 y 向下：90°=我在底部；+step 依次 左下→左→上→右→右下（视觉顺时针）
  const a = Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n
  const x = Math.min(
    w - RING_W / 2 - 2,
    Math.max(RING_W / 2 + 2, cx + rx * Math.cos(a)),
  )
  const y = Math.min(
    top + h - RING_H / 2 - 2,
    Math.max(top + RING_H / 2 + 2, cy + ry * Math.sin(a)),
  )
  return { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%, -50%)' }
}

const myTurn = computed(
  () =>
    pub.value?.phase === 'playing' &&
    pub.value.trick.turnSeat === you.value?.seat &&
    store.connection === 'online',
)
const isLeading = computed(() => pub.value?.trick.lastPlay === null)
const prevPlay = computed(() => pub.value?.trick.lastPlay ?? null)

const selectedCards = computed(
  () => you.value?.hand.filter((c) => selectedIds.value.has(c.id)) ?? [],
)

/** 逃生单出：领出、手中仅剩1张百搭、选中它 */
const isEscape = computed(() => {
  const hand = you.value?.hand
  if (!hand || hand.length !== 1 || !isWild(hand[0].rank)) return false
  if (!myTurn.value || !isLeading.value) return false
  return selectedCards.value.length === 1 && selectedCards.value[0].id === hand[0].id
})

const rawDecls = computed(() => enumerateDeclarations(selectedCards.value))

const legalDecls = computed<Decl[]>(() => {
  if (isEscape.value) return [{ type: 'single', rank: RANK_MIN }]
  const p = prevPlay.value
  return rawDecls.value.filter((d) => canBeat(p, { decl: d }))
})

const blockedReason = computed(() => {
  if (selectedCards.value.length === 0) return '点击手牌选择要出的牌'
  if (isEscape.value) return ''
  if (
    selectedCards.value.length === 1 &&
    isWild(selectedCards.value[0].rank)
  ) {
    return '百搭不能单出（领出且只剩1张时除外）'
  }
  if (rawDecls.value.length === 0) return '所选的牌无法组成牌型'
  if (legalDecls.value.length === 0) return '压不过上家的牌'
  return ''
})

const canPlay = computed(
  () => myTurn.value && !iAmDelegated.value && legalDecls.value.length > 0,
)
const canPass = computed(() => myTurn.value && !isLeading.value && !iAmDelegated.value)

/** 对手：按相对座位顺时针排序（我在最下） */
const opponents = computed(() => {
  const p = pub.value
  const me = you.value
  if (!p || !me || me.seat < 0) return []
  const n = p.players.length
  return [...p.players]
    .filter((x) => x.seat !== me.seat)
    .sort((a, b) => ((a.seat - me.seat + n) % n) - ((b.seat - me.seat + n) % n))
})

const me = computed(() => pub.value?.players.find((p) => p.seat === you.value?.seat) ?? null)
const iAmDelegated = computed(() => me.value?.delegated ?? false)
const myDeadline = computed(() =>
  myTurn.value ? pub.value?.trick.turnDeadline ?? null : null,
)

/** 加时：房主 + 本场进行中（sessionEndsAt 非 null） */
const canExtend = computed(
  () =>
    store.user?.id === store.room?.hostUserId &&
    store.room?.sessionEndsAt != null,
)

function doExtend(minutes: number): void {
  send('session.extend', { minutes })
  showExtendDialog.value = false
}

function toggleCard(id: number): void {
  if (!myTurn.value || iAmDelegated.value) return
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleDelegate(): void {
  send('game.delegate', { delegated: !iAmDelegated.value })
}

function play(): void {
  if (!canPlay.value) return
  if (legalDecls.value.length === 1) {
    doPlay(legalDecls.value[0])
  } else {
    showDeclDialog.value = true
  }
}

function doPlay(decl: Decl): void {
  const cardIds = [...selectedIds.value]
  if (cardIds.length === 0) return
  send('game.play', { cardIds, decl })
  selectedIds.value = new Set()
  showDeclDialog.value = false
}

function pass(): void {
  if (!canPass.value) return
  send('game.pass', {})
  selectedIds.value = new Set()
}

function opponentDeadline(seat: number): number | null {
  if (pub.value?.trick.turnSeat !== seat) return null
  return pub.value.trick.turnDeadline
}

// ---- 局间：桌面中央洗牌 + 结算弹窗 ----
const intermission = computed(() => store.room?.nextGameAt != null)
const shuffleDeadline = computed(() => store.room?.nextGameAt ?? null)
const shuffleStyle = computed(() => ({
  left: `${shufflePos.value.x}px`,
  top: `${shufflePos.value.y}px`,
}))

/** 弹窗可见：盘结算 / 本场总排名任一在场即显示。盘结算不自动收起——
 *  对齐局间洗牌，由下一局 game.state 清除 result 关闭；局末切总排名的延迟在 ResultDialog 内部 */
const resultDialogVisible = computed(() => store.result != null || store.finalSummary != null)

// 快照缺座位时兜底拉一次全量
onMounted(() => {
  if (game.value && game.value.you.seat < 0) send('game.sync', {})
  ro = new ResizeObserver(() => remeasure())
})
// 模板 ref 绑定后（含 syncing → 有数据的延迟出现）再挂观察并首测
watch([gameEl, bottomEl], ([g, b], prev) => {
  if (!ro) return
  const [og, ob] = prev ?? []
  if (og) ro.unobserve(og)
  if (ob) ro.unobserve(ob)
  if (g) ro.observe(g)
  if (b) ro.observe(b)
  remeasure()
})
// 模式翻转/座位数变化不必然改尺寸 → 主动重测（ringFits 输入与模式无关，不会振荡）
watch(isRing, () => void nextTick(remeasure))
watch(
  () => pub.value?.players.length ?? 0,
  () => void nextTick(remeasure),
)
onUnmounted(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div class="game" v-if="game && pub && you" ref="gameEl" :class="{ ring: isRing }">
    <div class="opponents" :class="{ ring: isRing }">
      <PlayerSeat
        v-for="(p, k) in opponents"
        :key="p.seat"
        :player="p"
        :deadline="opponentDeadline(p.seat)"
        :ring="isRing"
        :style="ringStyle(k)"
      />
    </div>

    <div class="trick-wrap">
      <TrickArea
        :trick="pub.trick"
        :players="pub.players"
        :pile-count="pub.pileCount"
        :multiplier="pub.multiplier"
        :ends-at="pub.endsAt"
        :bomb-history="pub.bombHistory"
        :can-extend="canExtend"
        @extend="showExtendDialog = true"
      />
    </div>

    <!-- 局间洗牌：桌面中央（弹窗后方常驻渲染；房间界面只留文字倒计时） -->
    <div v-if="intermission && shuffleDeadline" class="center-shuffle" :style="shuffleStyle">
      <div class="shuffle-panel">
        <ShuffleCountdown :deadline="shuffleDeadline" />
      </div>
    </div>

    <div class="bottom" ref="bottomEl">
      <div class="me-bar">
        <PlayerSeat v-if="me" :player="me" :deadline="myDeadline" compact />
        <div class="actions">
          <button class="pass" :disabled="!canPass" @click="pass()">过牌</button>
          <button class="play" :disabled="!canPlay" @click="play()">出牌</button>
          <button class="delegate" @click="toggleDelegate()">
            {{ iAmDelegated ? '取消托管' : '托管' }}
          </button>
        </div>
      </div>
      <p class="hint" :class="{ warn: myTurn && !iAmDelegated }">
        {{
          iAmDelegated
            ? '托管中：电脑代打，点「取消托管」恢复'
            : myTurn
              ? blockedReason || (isLeading ? '轮到你领出' : '轮到你了：出牌或过牌')
              : '等待其他玩家…'
        }}
      </p>
      <HandView
        :hand="you.hand"
        :selected-ids="selectedIds"
        :disabled="!myTurn || iAmDelegated"
        @toggle="toggleCard"
      />
    </div>

    <DeclDialog
      v-if="showDeclDialog"
      :decls="legalDecls"
      @confirm="doPlay"
      @cancel="showDeclDialog = false"
    />
    <ExtendDialog
      v-if="showExtendDialog"
      @confirm="doExtend"
      @cancel="showExtendDialog = false"
    />
    <ResultDialog
      v-if="resultDialogVisible"
      :result="store.result"
      :hands="store.allHands ?? []"
      :summary="store.finalSummary"
    />
  </div>
  <div v-else class="syncing">同步对局中…</div>
</template>

<style scoped>
.game {
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
  display: flex;
  flex-direction: column;
  /* 绒布纹理平铺 + 半透明径向渐变压出中心亮边缘暗；
     素材缺失时渐变层照常绘制、background-color 兜底，仍是纯绿桌布 */
  background-color: #14472c;
  background-image:
    radial-gradient(ellipse at center, rgb(46 125 79 / 55%) 0%, rgb(27 94 58 / 65%) 70%, rgb(20 71 44 / 80%) 100%),
    url('/images/bg/felt.png');
  background-size: cover, 512px 512px;
  background-repeat: no-repeat, repeat;
  padding: 14px;
  gap: 12px;
}
.opponents {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.trick-wrap {
  /* 横排模式：不产生盒子，TrickArea 直接作为 .game 的 flex 子项（布局与旧版一致） */
  display: contents;
}
.game.ring .trick-wrap {
  /* 环形模式：吸收剩余空间并把出牌面板居中，四周留给环形座位 */
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
}
.opponents.ring {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
  z-index: 10;
}
.opponents.ring .seat {
  position: absolute;
  pointer-events: auto;
}
/* 局间洗牌面板：桌面中央（跟随实际出牌面板中心） */
.center-shuffle {
  position: absolute;
  z-index: 150;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.center-shuffle .shuffle-panel {
  background: rgb(0 0 0 / 55%);
  border-radius: 14px;
  padding: 10px 22px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
}
.bottom {
  background: rgb(0 0 0 / 30%);
  border-radius: 14px;
  padding: 8px 12px 4px;
}
.me-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.actions {
  display: flex;
  gap: 10px;
}
.actions button {
  padding: 11px 30px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.actions .play {
  background: #4a90d9;
  color: #fff;
}
.actions .play:not(:disabled):hover {
  background: #3a7bc0;
}
.actions .pass {
  background: #f5f5f5;
  color: #555;
}
.actions .pass:not(:disabled):hover {
  background: #e8e8e8;
}
.actions .delegate {
  background: #ff9800;
  color: #fff;
  /* 「托管」/「取消托管」等宽（4 字宽为准），切换文案不改变布局 */
  width: 124px;
  padding-left: 0;
  padding-right: 0;
  text-align: center;
}
.actions .delegate:hover {
  background: #ef6c00;
}
.actions button:disabled {
  opacity: 0.45;
  cursor: default;
}
.hint {
  color: #a5d6a7;
  font-size: 13px;
  margin: 6px 0 0;
  /* 固定两行高：提示文案变化/换行不改变界面高度 */
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.hint.warn {
  color: #ffe082;
}
.syncing {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  color: #888;
}

@media (max-width: 640px) {
  .game {
    padding: 8px;
    gap: 8px;
  }
  .opponents {
    gap: 6px;
  }
  .bottom {
    padding: 6px 8px calc(4px + env(safe-area-inset-bottom));
  }
  /* 我的座位一行 + 操作按钮整行三等分（触摸高度达标） */
  .me-bar {
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .actions {
    width: 100%;
  }
  .actions button {
    flex: 1;
    padding: 10px 0;
    font-size: 15px;
  }
  .actions .delegate {
    width: auto;
  }
  .hint {
    height: 30px;
    font-size: 12px;
    margin-top: 4px;
  }
}

@media (max-height: 500px) {
  /* 矮屏（横屏）：整体压高度，对手单行横滚 */
  .game {
    padding: 6px;
    gap: 6px;
  }
  .opponents {
    flex-wrap: nowrap;
    overflow-x: auto;
    justify-content: flex-start;
    padding-bottom: 2px;
  }
  .bottom {
    padding: 4px 8px calc(2px + env(safe-area-inset-bottom));
  }
  .hint {
    height: 22px;
    font-size: 11px;
    margin-top: 2px;
  }
}

@media (max-height: 500px) and (min-width: 641px) {
  /* 宽横屏：me-bar 回横排省高度（窄屏保持纵排，避免座位+按钮横溢出） */
  .me-bar {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
  }
  .actions button {
    flex: none;
    padding: 8px 16px;
    font-size: 14px;
  }
  .actions .delegate {
    width: 110px;
  }
}
</style>
