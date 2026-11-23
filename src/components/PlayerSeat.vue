<script setup lang="ts">
import { computed } from 'vue'
import { asset, iconStyle } from '../base.js'
import type { PublicPlayerState } from '../types.js'
import Countdown from './Countdown.vue'

const props = defineProps<{
  player: PublicPlayerState
  /** 当前回合的 deadline；非本人回合传 null */
  deadline?: number | null
  compact?: boolean
  /** 环形围桌小座位（桌面环形布局专用，固定 250×40） */
  ring?: boolean
}>()

const cards = computed(() => Array.from({ length: props.player.handCount }, (_, i) => i))

/** 头像图加载失败 → 隐藏 img，露出下方首字兜底 */
function hideBrokenImg(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div class="seat" :class="{ turn: deadline != null, compact, ring }">
    <div class="avatar">
      <span class="avatar-fallback">{{ player.nickname.slice(0, 1) }}</span>
      <img
        class="avatar-img"
        :src="asset(player.isBot ? '/images/avatars/bot.png' : '/images/avatars/default.png')"
        :alt="player.nickname"
        @error="hideBrokenImg"
      />
      <span v-if="player.isDealer" class="dealer" title="庄家">
        <span class="icon" :style="iconStyle('/images/icons/dealer.svg')"></span>
      </span>
    </div>
    <div class="meta">
      <div class="name">
        <span v-if="deadline != null" class="turn-tag">当前</span>
        {{ player.nickname }}
        <span v-if="player.isBot" class="bot-tag" title="电脑玩家"
          ><span class="icon" :style="iconStyle('/images/icons/bot.svg')"></span>电脑</span
        >
        <span v-if="player.delegated && !player.isBot" class="delegated-tag" title="托管中"
          ><span class="icon" :style="iconStyle('/images/icons/delegate.svg')"></span>托管</span
        >
        <span v-if="!player.online" class="offline">离线</span>
        <span v-if="!player.everPlayed && deadline != null" class="gd" title="本局尚未出过牌"
          ><span class="icon" :style="iconStyle('/images/icons/glare.svg')"></span>瞪</span
        >
      </div>
      <div class="backs">
        <span v-for="i in cards.slice(0, 8)" :key="i" class="back-mini"></span>
        <span class="count">{{ player.handCount }}张</span>
      </div>
    </div>
    <!-- 固定槽位：倒计时出现/消失不改变座位宽度；尺寸随断点在 CSS 里定 -->
    <div class="cd">
      <Countdown v-if="deadline != null" :deadline="deadline" />
    </div>
  </div>
</template>

<style scoped>
.seat {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgb(0 0 0 / 25%);
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 8px 14px;
  /* 固定宽高：手牌张数/徽标/倒计时变化不再挤动座位 */
  width: 330px;
  min-width: 330px;
  height: 60px;
  overflow: hidden;
}
.seat.turn {
  border-color: #ffd54f;
  background: rgb(0 0 0 / 45%);
  /* 内外双发光：环形桌/横排下当前回合一眼可辨 */
  box-shadow:
    0 0 0 2px rgb(255 213 79 / 55%),
    0 0 16px rgb(255 213 79 / 45%);
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #4a90d9;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  position: relative;
  flex-shrink: 0;
}
/* 头像图盖在首字兜底之上；图加载失败时隐藏 img 露出首字 */
.avatar-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-fallback {
  line-height: 1;
}
.dealer {
  position: absolute;
  top: -7px;
  right: -7px;
  background: #ff8f00;
  color: #fff;
  font-size: 10px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dealer .icon {
  width: 11px;
  height: 11px;
}
.meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.name {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  /* 昵称单行宁可裁徽标也不从名字中间换行截断 */
  white-space: nowrap;
}
.name > span {
  flex-shrink: 0;
  white-space: nowrap;
}
.offline {
  font-size: 11px;
  color: #ef9a9a;
  font-weight: 400;
}
.gd {
  font-size: 10px;
  background: #ef5350;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
}
.turn-tag {
  font-size: 10px;
  background: #ffd54f;
  color: #5d4037;
  padding: 0 5px;
  border-radius: 4px;
  font-weight: 700;
  flex-shrink: 0;
}
.bot-tag {
  font-size: 10px;
  background: #5c6bc0;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 400;
}
.delegated-tag {
  font-size: 10px;
  background: #ff9800;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 400;
}
.backs {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
}
.back-mini {
  width: 10px;
  height: 15px;
  border-radius: 2px;
  /* 牌背图垫在条纹渐变之上：素材缺失自动回退 */
  background:
    url('/images/cards/back.png') center / cover no-repeat,
    repeating-linear-gradient(45deg, #1e5aa8, #1e5aa8 3px, #2a6fc4 3px, #2a6fc4 6px);
  border: 1px solid #fff;
  flex-shrink: 0;
}
.count {
  color: #bbdefb;
  font-size: 12px;
  margin-left: 6px;
  flex-shrink: 0;
  white-space: nowrap;
}
.cd {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.compact .avatar {
  width: 30px;
  height: 30px;
  font-size: 13px;
}
.seat.compact .cd {
  width: 40px;
  height: 40px;
}

/* ---- 环形围桌小座位（桌面环形布局专用；固定尺寸，零跳变） ---- */
.seat.ring {
  width: 250px;
  min-width: 250px;
  height: 40px;
  padding: 4px 6px;
  gap: 6px;
  border-radius: 10px;
}
.seat.ring .avatar {
  width: 26px;
  height: 26px;
  font-size: 12px;
}
.seat.ring .dealer {
  width: 14px;
  height: 14px;
  font-size: 9px;
  top: -5px;
  right: -5px;
}
.seat.ring .cd {
  width: 32px;
  height: 32px;
}
.seat.ring .cd :deep(.countdown span) {
  font-size: 8px;
}
.seat.ring .cd :deep(.countdown::after) {
  inset: 3px;
}
.seat.ring .name {
  font-size: 12px;
  gap: 4px;
}
.seat.ring .turn-tag {
  font-size: 9px;
  padding: 0 4px;
}
.seat.ring .backs {
  margin-top: 2px;
}
.seat.ring .back-mini {
  display: none;
}
.seat.ring .count {
  font-size: 10px;
  margin-left: 0;
}
.seat.ring .bot-tag,
.seat.ring .delegated-tag,
.seat.ring .gd,
.seat.ring .offline {
  font-size: 9px;
  padding: 0 4px;
}

@media (max-width: 640px) {
  /* 对手座位 → 紧凑芯片 160×48（我的座位 .compact 保持桌面尺寸）：
     隐藏手牌缩略图只留张数，一行可放 2 个，7 个对手 4 行内全可见 */
  .seat.compact {
    /* 我的座位不随桌面加宽：320px 极小屏无横向溢出 */
    width: 280px;
    min-width: 280px;
  }
  .seat:not(.compact) {
    width: 160px;
    min-width: 160px;
    height: 48px;
    padding: 6px 8px;
    gap: 6px;
    border-radius: 10px;
  }
  .seat:not(.compact) .avatar {
    width: 26px;
    height: 26px;
    font-size: 13px;
  }
  .seat:not(.compact) .dealer {
    width: 14px;
    height: 14px;
    font-size: 9px;
    top: -5px;
    right: -5px;
  }
  .seat:not(.compact) .name {
    font-size: 12px;
    gap: 4px;
  }
  .seat:not(.compact) .offline {
    font-size: 10px;
  }
  .seat:not(.compact) .gd,
  .seat:not(.compact) .bot-tag,
  .seat:not(.compact) .delegated-tag {
    font-size: 9px;
    padding: 0 4px;
  }
  .seat:not(.compact) .back-mini {
    display: none;
  }
  .seat:not(.compact) .count {
    font-size: 11px;
    margin-left: 0;
  }
  .seat:not(.compact) .cd {
    width: 30px;
    height: 30px;
  }
  .seat:not(.compact) .cd :deep(.countdown span) {
    font-size: 9px;
  }
  .seat:not(.compact) .cd :deep(.countdown::after) {
    inset: 3px;
  }
}

@media (max-height: 500px) {
  /* 矮屏（横屏）：对手芯片再压一号，倒计时字号跟着缩 */
  .seat:not(.compact) {
    width: 140px;
    min-width: 140px;
    height: 40px;
    padding: 4px 8px;
    gap: 5px;
  }
  .seat:not(.compact) .avatar {
    width: 22px;
    height: 22px;
    font-size: 12px;
  }
  .seat:not(.compact) .name {
    font-size: 11px;
  }
  .seat:not(.compact) .back-mini {
    display: none;
  }
  .seat:not(.compact) .count {
    font-size: 10px;
    margin-left: 0;
  }
  .seat:not(.compact) .cd {
    width: 28px;
    height: 28px;
  }
  .seat:not(.compact) .cd :deep(.countdown span) {
    font-size: 8px;
  }
  .seat:not(.compact) .cd :deep(.countdown::after) {
    inset: 3px;
  }
}
</style>
