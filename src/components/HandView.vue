<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { sortHand } from '../game/cards.js'
import { useIsMobile, useIsShort } from '../media.js'
import type { Card } from '../types.js'
import CardView from './Card.vue'

const props = defineProps<{
  hand: Card[]
  selectedIds: ReadonlySet<number>
  disabled?: boolean
}>()

const emit = defineEmits<{ toggle: [id: number] }>()

const sorted = computed(() => sortHand(props.hand))

const isMobile = useIsMobile()
const isShort = useIsShort()
/** 手机/矮屏走按实测宽度的自适应重叠；桌面保持原公式（布局零跳变） */
const adaptive = computed(() => isMobile.value || isShort.value)

const handEl = ref<HTMLElement | null>(null)
/** 实测数据：手牌区可用宽度与单张牌宽（自适应重叠用） */
const box = ref({ avail: 0, cardW: 0 })

function measure(): void {
  const el = handEl.value
  if (!el) return
  const style = getComputedStyle(el)
  const avail =
    el.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0)
  const slot = el.querySelector('.slot') as HTMLElement | null
  box.value = { avail, cardW: slot ? slot.getBoundingClientRect().width : 0 }
}

/** 手牌多时扇形重叠，避免超出屏幕 */
const overlap = computed(() => {
  const n = sorted.value.length
  if (!adaptive.value) {
    if (n <= 8) return 0
    return Math.min(42, (n - 8) * 5)
  }
  // 自适应：让 n 张牌恰好铺满可用宽度，单张至少留 14px 可点
  const { avail, cardW } = box.value
  if (n <= 1 || cardW <= 0 || avail <= 0) return 0
  const need = (n * cardW - avail) / (n - 1)
  return Math.max(0, Math.min(cardW - 14, need))
})

let ro: ResizeObserver | null = null
onMounted(() => {
  measure() // 首帧同步测量，避免初始重叠错误
  ro = new ResizeObserver(() => measure())
  if (handEl.value) ro.observe(handEl.value)
})
onUnmounted(() => {
  ro?.disconnect()
})
// 张数/断点变化会改变牌宽与所需重叠，等重排后再量一次
watch([() => sorted.value.length, adaptive], () => nextTick(measure))
</script>

<template>
  <div ref="handEl" class="hand">
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
  /* 极端兜底：万一重叠算错也只在手牌区横向滚动，不撑破页面 */
  overflow-x: auto;
}
.slot {
  cursor: pointer;
  transition: transform 0.1s;
  touch-action: manipulation;
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

@media (max-width: 640px) {
  .hand {
    --card-w: 48px;
    --card-h: 68px;
    min-height: 84px;
    padding: 12px 4px 4px;
  }
  /* 触屏没有真正的 hover，避免抬起后粘住；选中上浮保持 -10px（不走桌面的 -14） */
  .slot:hover :deep(.card.face:not(.selected)) {
    transform: none;
  }
  .slot:hover :deep(.card.face.selected) {
    transform: translateY(-10px);
  }
}
@media (max-height: 500px) {
  .hand {
    --card-w: 40px;
    --card-h: 56px;
    min-height: 70px;
    padding: 10px 4px 2px;
  }
}
</style>
