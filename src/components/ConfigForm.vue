<script setup lang="ts">
import { computed } from 'vue'
import type { RoomConfig } from '../types.js'

const config = defineModel<RoomConfig>({ required: true })

const wildOptions = computed(() => [
  { value: 2 as const, label: '2 张（1大1小）' },
  { value: 3 as const, label: '3 张（2大1小）' },
  { value: 4 as const, label: '4 张（2大2小）' },
])

const playerOptions = Array.from({ length: 7 }, (_, i) => i + 2) // 2..8

function clamp(): void {
  const c = config.value
  c.turnSeconds = Math.min(120, Math.max(5, Math.round(c.turnSeconds) || 30))
  c.gameMinutes = Math.min(60, Math.max(1, Math.round(c.gameMinutes) || 10))
  c.maxPlayers = Math.min(8, Math.max(2, Math.round(c.maxPlayers) || 8))
}
</script>

<template>
  <div class="form">
    <label>
      百搭牌个数
      <div class="radios">
        <label v-for="o in wildOptions" :key="o.value" class="radio">
          <input v-model="config.wildCount" type="radio" :value="o.value" />
          {{ o.label }}
        </label>
      </div>
    </label>

    <label>
      最多人数
      <select v-model.number="config.maxPlayers">
        <option v-for="n in playerOptions" :key="n" :value="n">{{ n }} 人</option>
      </select>
    </label>

    <div class="row">
      <label>
        回合思考时间（秒）
        <input
          v-model.number="config.turnSeconds"
          type="number"
          min="5"
          max="120"
          @blur="clamp()"
        />
      </label>
      <label>
        对局总时长（分钟）
        <input
          v-model.number="config.gameMinutes"
          type="number"
          min="1"
          max="60"
          @blur="clamp()"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form > label,
.row label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}
.radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.radio {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #333;
  cursor: pointer;
}
select,
input[type='number'] {
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 14px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>
