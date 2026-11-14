<script setup lang="ts">
import { computed } from 'vue'
import { dismissResult, store } from '../store.js'
import type { GameResult } from '../types.js'
import CardView from './Card.vue'

const props = defineProps<{
  result: GameResult
  hands: { seat: number; cards: { id: number; rank: number; suit: number }[] }[]
}>()

const players = computed(() => store.game?.public.players ?? [])

function name(seat: number): string {
  return players.value.find((p) => p.seat === seat)?.nickname ?? `P${seat + 1}`
}

const headline = computed(() => {
  if (props.result.reason === 'draw' || props.result.winnerSeat == null) {
    return '流局（剩牌并列最少）'
  }
  return `${name(props.result.winnerSeat)} 获胜！`
})
</script>

<template>
  <div class="modal">
    <div class="dialog">
      <h2>{{ headline }}</h2>
      <p class="multi">
        炸弹累计倍率 <b>×{{ result.multiplier }}</b>
        <em v-if="result.reason === 'timeout'">（总时长到期结算）</em>
      </p>

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
              <em v-if="p.seat === result.winnerSeat" class="win">胜</em>
              <em v-if="!p.everPlayed" class="gd" title="整局未出牌（关瞪瞪），得分翻倍">瞪</em>
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
        <button @click="dismissResult()">返回房间</button>
      </div>
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
.multi em {
  font-style: normal;
  color: #999;
  font-size: 12px;
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
.win {
  font-style: normal;
  background: #ff8f00;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
.gd {
  font-style: normal;
  background: #ef5350;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
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
</style>
