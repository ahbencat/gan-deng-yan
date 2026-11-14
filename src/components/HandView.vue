<script setup lang="ts">
import { computed } from 'vue'
import { sortHand } from '../game/cards.js'
import type { Card } from '../types.js'
import CardView from './Card.vue'

const props = defineProps<{
  hand: Card[]
  selectedIds: ReadonlySet<number>
  disabled?: boolean
}>()

const emit = defineEmits<{ toggle: [id: number] }>()

const sorted = computed(() => sortHand(props.hand))

/** 手牌多时扇形重叠，避免超出屏幕 */
const overlap = computed(() => {
  const n = sorted.value.length
  if (n <= 8) return 0
  return Math.min(42, (n - 8) * 5)
})
</script>

<template>
  <div class="hand">
    <div
      v-for="(c, i) in sorted"
      :key="c.id"
      class="slot"
      :style="i === 0 ? {} : { marginLeft: `-${overlap}px` }"
      @click="!disabled && emit('toggle', c.id)"
    >
      <CardView
        :card="c"
        :selected="selectedIds.has(c.id)"
        :class="{ dim: disabled }"
      />
    </div>
  </div>
</template>

<style scoped>
.hand {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  min-height: 106px;
  padding: 16px 8px 4px;
}
.slot {
  cursor: pointer;
  transition: transform 0.1s;
}
.slot :deep(.dim) {
  opacity: 0.75;
}
.slot:hover :deep(.card.face) {
  transform: translateY(-6px);
}
.slot:hover :deep(.card.face.selected) {
  transform: translateY(-14px);
}
</style>
