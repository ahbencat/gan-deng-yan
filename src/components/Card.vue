<script setup lang="ts">
import { computed } from 'vue'
import { rankLabel } from '../label.js'
import type { Card } from '../types.js'

const props = defineProps<{
  card?: Card
  faceDown?: boolean
  selected?: boolean
  small?: boolean
}>()

const isJoker = computed(() => (props.card?.rank ?? 0) >= 16)
// suit 顺序：0=♠ 1=♥ 2=♣ 3=♦
const isRed = computed(() => {
  if (!props.card || isJoker.value) return false
  return props.card.suit === 1 || props.card.suit === 3
})
const jokerText = computed(() => (props.card && isJoker.value ? rankLabel(props.card.rank) : ''))
</script>

<template>
  <div
    v-if="faceDown"
    class="card back"
    :class="{ small }"
    aria-hidden="true"
  ></div>
  <div
    v-else-if="card"
    class="card face"
    :class="{ selected, small, red: isRed, joker: isJoker }"
  >
    <span v-if="isJoker" class="joker-label">{{ jokerText }}</span>
    <template v-else>
      <span class="corner">{{ rankLabel(card.rank) }}</span>
      <span class="pip">{{ ['♠', '♥', '♣', '♦'][card.suit] }}</span>
    </template>
  </div>
</template>

<style scoped>
.card {
  width: 64px;
  height: 92px;
  border-radius: 8px;
  position: relative;
  flex-shrink: 0;
  user-select: none;
}
.card.small {
  width: 44px;
  height: 64px;
  border-radius: 6px;
}
.face {
  background: #fff;
  border: 1px solid #bbb;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.face.selected {
  transform: translateY(-14px);
  border-color: #4a90d9;
  box-shadow: 0 4px 10px rgb(74 144 217 / 45%);
}
.corner {
  position: absolute;
  top: 5px;
  left: 7px;
  font-weight: 700;
  font-size: 15px;
  line-height: 1;
}
.small .corner {
  font-size: 12px;
  top: 4px;
  left: 5px;
}
.pip {
  font-size: 26px;
  line-height: 1;
}
.small .pip {
  font-size: 18px;
}
.face.red {
  color: #d93025;
}
.face.joker {
  background: #fffef5;
}
.joker-label {
  font-weight: 700;
  font-size: 16px;
  color: #7b1fa2;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}
.small .joker-label {
  font-size: 12px;
}
.back {
  background:
    repeating-linear-gradient(45deg, #1e5aa8, #1e5aa8 6px, #2a6fc4 6px, #2a6fc4 12px);
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
}
</style>
