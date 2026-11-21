<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { serverNow } from '../store.js'
import CardView from './Card.vue'

const props = defineProps<{
  /** 自动开局时刻（绝对 ms） */
  deadline: number
  /** 房间页小尺寸模式 */
  compact?: boolean
}>()

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

const remain = computed(() => Math.max(0, props.deadline - tick.value))
const secs = computed(() => Math.ceil(remain.value / 1000))
</script>

<template>
  <div class="shuffle" :class="{ compact }">
    <div class="stage" aria-hidden="true">
      <div class="wrap w1"><CardView face-down small /></div>
      <div class="wrap w2"><CardView face-down small /></div>
      <div class="wrap w3"><CardView face-down small /></div>
    </div>
    <div class="text">
      <p class="caption">正在洗牌</p>
      <p class="count">{{ secs }} 秒后自动开局</p>
    </div>
  </div>
</template>

<style scoped>
.shuffle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px 0;
}
.stage {
  position: relative;
  width: 96px;
  height: 70px;
  flex-shrink: 0;
}
.wrap {
  position: absolute;
  top: 3px;
  left: 50%;
  margin-left: -22px; /* 卡片宽 44 的一半 */
  transform-origin: 50% 90%;
  animation: riffle 1.2s ease-in-out infinite;
}
.wrap.w2 {
  animation-delay: -0.4s;
}
.wrap.w3 {
  animation-delay: -0.8s;
}
@keyframes riffle {
  0% {
    transform: translateX(-26px) rotate(-10deg);
  }
  50% {
    transform: translateX(26px) rotate(10deg);
  }
  100% {
    transform: translateX(-26px) rotate(-10deg);
  }
}
.text {
  text-align: center;
}
.caption {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #e65100;
  letter-spacing: 2px;
}
.count {
  margin: 4px 0 0;
  font-size: 13px;
  color: #888;
  font-variant-numeric: tabular-nums;
}
/* 房间页紧凑模式 */
.shuffle.compact {
  gap: 10px;
  padding: 6px 0;
}
.shuffle.compact .stage {
  width: 72px;
  height: 54px;
  transform: scale(0.78);
  transform-origin: left center;
  margin-right: -14px;
}
/* 减少动态偏好：静态牌堆 + 倒计时 */
@media (prefers-reduced-motion: reduce) {
  .wrap {
    animation: none;
  }
  .wrap.w1 {
    transform: translateX(-14px) rotate(-6deg);
  }
  .wrap.w3 {
    transform: translateX(14px) rotate(6deg);
  }
}
</style>
