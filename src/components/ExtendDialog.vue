<script setup lang="ts">
const emit = defineEmits<{ confirm: [minutes: number]; cancel: [] }>()

const options = [15, 30, 45, 60]
</script>

<template>
  <div class="modal" @click.self="emit('cancel')">
    <div class="dialog">
      <h3>本场加时</h3>
      <p class="sub">为当前本场追加时长（可多次叠加）</p>
      <div class="options">
        <button
          v-for="m in options"
          :key="m"
          class="opt"
          @click="emit('confirm', m)"
        >
          +{{ m }} 分钟
        </button>
      </div>
      <div class="btns">
        <button class="ghost" @click="emit('cancel')">取消</button>
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
  max-width: 94vw;
  max-height: 86vh;
  max-height: 86dvh;
  overflow: auto;
}
h3 {
  margin: 0 0 6px;
  font-size: 16px;
}
.sub {
  margin: 0 0 14px;
  color: #888;
  font-size: 13px;
}
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.opt {
  padding: 14px 0;
  border: 1px solid #d0e3f7;
  border-radius: 10px;
  background: #f0f6ff;
  color: #2a6fc4;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}
.opt:hover {
  background: #e0eefc;
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
button.ghost {
  padding: 9px 20px;
  border: none;
  border-radius: 8px;
  background: #f0f0f0;
  color: #555;
  font-size: 14px;
  cursor: pointer;
}
button.ghost:hover {
  background: #e4e4e4;
}

@media (max-width: 640px) {
  .dialog {
    padding: 16px;
  }
  .opt {
    padding: 16px 0;
  }
}
</style>
