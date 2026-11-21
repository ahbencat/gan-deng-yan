<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { serverNow } from '../store.js'

const props = defineProps<{
  /** 绝对 deadline（服务端时间戳 ms） */
  deadline: number
}>()

const now = ref(serverNow())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = serverNow()
  }, 250)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const remaining = computed(() => Math.max(0, props.deadline - now.value))
const text = computed(() => {
  const s = Math.ceil(remaining.value / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
})
const urgent = computed(() => remaining.value < 5000)
/** 环形进度（0~1） */
const progress = computed(() => {
  // 以 30s 为满环基准（回合倒计时）；总时长等场景由外部传满环值更准，这里按剩余比例
  const total = 30_000
  return Math.min(1, remaining.value / total)
})
</script>

<template>
  <div class="countdown" :class="{ urgent }" :style="{ '--p': progress }">
    <span>{{ text }}</span>
  </div>
</template>

<style scoped>
.countdown {
  /* 尺寸由父级槽位（.cd）按断点决定 */
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(
    #4a90d9 calc(var(--p) * 360deg),
    #e0e0e0 0
  );
  position: relative;
}
.countdown::after {
  content: '';
  position: absolute;
  inset: 4px;
  background: var(--panel, #fff);
  border-radius: 50%;
}
.countdown span {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  color: #333;
  font-variant-numeric: tabular-nums;
}
.countdown.urgent {
  background: conic-gradient(#e53935 calc(var(--p) * 360deg), #e0e0e0 0);
}
.countdown.urgent span {
  color: #c62828;
}
</style>
