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
// 王牌插画（rank 17=大王，16=小王）；加载失败时 onerror 隐藏 img，露出下方竖排文字兜底
const jokerSrc = computed(() =>
  (props.card?.rank ?? 0) >= 17 ? '/images/cards/joker-big.png' : '/images/cards/joker-small.png',
)
function hideBrokenImg(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
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
    <template v-if="isJoker">
      <span class="joker-label">{{ jokerText }}</span>
      <img
        class="joker-art"
        :src="jokerSrc"
        :alt="jokerText"
        @error="hideBrokenImg"
      />
    </template>
    <template v-else>
      <span class="corner">{{ rankLabel(card.rank) }}</span>
      <span class="pip">{{ ['♠', '♥', '♣', '♦'][card.suit] }}</span>
    </template>
  </div>
</template>

<style scoped>
.card {
  /* 尺寸可由容器（.hand）用 CSS 变量覆盖，桌面默认 64×92 */
  width: var(--card-w, 64px);
  height: var(--card-h, 92px);
  border-radius: 8px;
  position: relative;
  flex-shrink: 0;
  user-select: none;
  touch-action: manipulation;
}
.card.small {
  width: 44px;
  height: 64px;
  border-radius: 6px;
}
.face {
  background: #fff;
  /* 显式文字色：暗色模式/继承断链时也不出白底白字（红牌由 .face.red 覆盖） */
  color: #111;
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
/* 王牌插画铺满牌面；盖住下方竖排文字（图加载失败时文字兜底） */
.joker-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  pointer-events: none;
}
.back {
  /* 图片在上、原条纹渐变垫底：素材缺失时自动回退，零 JS */
  background:
    url('/images/cards/back.png') center / cover no-repeat,
    repeating-linear-gradient(45deg, #1e5aa8, #1e5aa8 6px, #2a6fc4 6px, #2a6fc4 12px);
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
}

@media (max-width: 640px) {
  /* 桌面出牌区/结算弹窗里的小牌在手机上再缩一号 */
  .card.small {
    width: 40px;
    height: 58px;
  }
  .small .corner {
    font-size: 11px;
    top: 3px;
    left: 4px;
  }
  .small .pip {
    font-size: 16px;
  }
  .small .joker-label {
    font-size: 11px;
  }
  /* 手机上选中上浮距离缩短，给手牌区省高度 */
  .face.selected {
    transform: translateY(-10px);
  }
}
</style>
