<script setup lang="ts">
import { ref } from 'vue'
import { declLabel } from '../label.js'
import type { Decl } from '../types.js'

const props = defineProps<{
  decls: Decl[]
}>()

const emit = defineEmits<{ confirm: [decl: Decl]; cancel: [] }>()

const chosen = ref(0)
</script>

<template>
  <div class="modal" @click.self="emit('cancel')">
    <div class="dialog">
      <h3>选择要出的牌型</h3>
      <label v-for="(d, i) in props.decls" :key="i" class="option">
        <input v-model="chosen" type="radio" :value="i" />
        <span>{{ declLabel(d) }}</span>
      </label>
      <div class="btns">
        <button class="ghost" @click="emit('cancel')">取消</button>
        <button @click="emit('confirm', props.decls[chosen])">出牌</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.dialog {
  background: var(--panel, #fff);
  border-radius: 12px;
  padding: 22px;
  width: 320px;
}
h3 {
  margin: 0 0 14px;
  font-size: 16px;
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
}
.option:hover {
  background: #f0f6ff;
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
button {
  padding: 9px 20px;
  border: none;
  border-radius: 8px;
  background: #4a90d9;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
button.ghost {
  background: #f0f0f0;
  color: #555;
}
</style>
