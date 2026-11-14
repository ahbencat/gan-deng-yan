<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { enumerateDeclarations } from '../game/combo.js'
import { canBeat } from '../game/rules.js'
import { send, store } from '../store.js'
import { RANK_MIN, isWild, type Decl } from '../types.js'
import DeclDialog from '../components/DeclDialog.vue'
import HandView from '../components/HandView.vue'
import PlayerSeat from '../components/PlayerSeat.vue'
import ResultDialog from '../components/ResultDialog.vue'
import TrickArea from '../components/TrickArea.vue'

const showDeclDialog = ref(false)
const selectedIds = ref<Set<number>>(new Set())

const game = computed(() => store.game)
const you = computed(() => game.value?.you)
const pub = computed(() => game.value?.public)

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

const canPlay = computed(() => myTurn.value && legalDecls.value.length > 0)
const canPass = computed(() => myTurn.value && !isLeading.value)

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
const myDeadline = computed(() =>
  myTurn.value ? pub.value?.trick.turnDeadline ?? null : null,
)

function toggleCard(id: number): void {
  if (!myTurn.value) return
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
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

// 快照缺座位时兜底拉一次全量
onMounted(() => {
  if (game.value && game.value.you.seat < 0) send('game.sync', {})
})
</script>

<template>
  <div class="game" v-if="game && pub && you">
    <div class="opponents">
      <PlayerSeat
        v-for="p in opponents"
        :key="p.seat"
        :player="p"
        :deadline="opponentDeadline(p.seat)"
      />
    </div>

    <TrickArea
      :trick="pub.trick"
      :players="pub.players"
      :pile-count="pub.pileCount"
      :multiplier="pub.multiplier"
      :ends-at="pub.endsAt"
      :bomb-history="pub.bombHistory"
    />

    <div class="bottom">
      <div class="me-bar">
        <PlayerSeat v-if="me" :player="me" :deadline="myDeadline" compact />
        <div class="actions">
          <button class="pass" :disabled="!canPass" @click="pass()">过牌</button>
          <button class="play" :disabled="!canPlay" @click="play()">出牌</button>
        </div>
      </div>
      <p class="hint" :class="{ warn: myTurn }">
        {{
          myTurn
            ? blockedReason || (isLeading ? '轮到你领出' : '轮到你了：出牌或过牌')
            : '等待其他玩家…'
        }}
      </p>
      <HandView
        :hand="you.hand"
        :selected-ids="selectedIds"
        :disabled="!myTurn"
        @toggle="toggleCard"
      />
    </div>

    <DeclDialog
      v-if="showDeclDialog"
      :decls="legalDecls"
      @confirm="doPlay"
      @cancel="showDeclDialog = false"
    />
    <ResultDialog
      v-if="store.result"
      :result="store.result"
      :hands="store.allHands ?? []"
    />
  </div>
  <div v-else class="syncing">同步对局中…</div>
</template>

<style scoped>
.game {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse at center, #2e7d4f 0%, #1b5e3a 70%, #14472c 100%);
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
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
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
.actions button:disabled {
  opacity: 0.45;
  cursor: default;
}
.hint {
  text-align: center;
  color: #a5d6a7;
  font-size: 13px;
  margin: 6px 0 0;
  min-height: 18px;
}
.hint.warn {
  color: #ffe082;
}
.syncing {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #888;
}
</style>
