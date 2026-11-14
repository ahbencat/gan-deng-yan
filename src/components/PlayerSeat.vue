<script setup lang="ts">
import { computed } from 'vue'
import type { PublicPlayerState } from '../types.js'
import Countdown from './Countdown.vue'

const props = defineProps<{
  player: PublicPlayerState
  /** 当前回合的 deadline；非本人回合传 null */
  deadline?: number | null
  compact?: boolean
}>()

const cards = computed(() => Array.from({ length: props.player.handCount }, (_, i) => i))
</script>

<template>
  <div class="seat" :class="{ turn: deadline != null, compact }">
    <div class="avatar">
      {{ player.nickname.slice(0, 1) }}
      <span v-if="player.isDealer" class="dealer" title="庄家">庄</span>
    </div>
    <div class="meta">
      <div class="name">
        {{ player.nickname }}
        <span v-if="!player.online" class="offline">离线</span>
        <span v-if="!player.everPlayed && deadline != null" class="gd" title="本局尚未出过牌">瞪</span>
      </div>
      <div class="backs">
        <span v-for="i in cards" :key="i" class="back-mini"></span>
        <span class="count">{{ player.handCount }}张</span>
      </div>
    </div>
    <Countdown
      v-if="deadline != null"
      :deadline="deadline"
      :size="compact ? 40 : 46"
    />
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
  min-width: 190px;
}
.seat.turn {
  border-color: #ffd54f;
  background: rgb(0 0 0 / 40%);
  box-shadow: 0 0 12px rgb(255 213 79 / 35%);
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
.meta {
  flex: 1;
  min-width: 0;
}
.name {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  gap: 6px;
  align-items: center;
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
.backs {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.back-mini {
  width: 10px;
  height: 15px;
  border-radius: 2px;
  background: repeating-linear-gradient(45deg, #1e5aa8, #1e5aa8 3px, #2a6fc4 3px, #2a6fc4 6px);
  border: 1px solid #fff;
}
.count {
  color: #bbdefb;
  font-size: 12px;
  margin-left: 6px;
}
.compact .avatar {
  width: 30px;
  height: 30px;
  font-size: 13px;
}
</style>
