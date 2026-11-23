<script setup lang="ts">
import { onMounted } from 'vue'
import { iconStyle } from './base.js'
import { boot, clearError, store } from './store.js'
import LoginView from './views/LoginView.vue'
import LobbyView from './views/LobbyView.vue'
import RoomView from './views/RoomView.vue'
import GameView from './views/GameView.vue'

onMounted(() => {
  void boot()
})
</script>

<template>
  <div class="app">
    <LoginView v-if="store.phase === 'login'" />
    <div v-else-if="store.phase === 'boot'" class="boot">连接中…</div>
    <LobbyView v-else-if="store.phase === 'lobby'" />
    <RoomView v-else-if="store.phase === 'room'" />
    <GameView v-else />

    <div v-if="store.connection === 'reconnecting'" class="banner warn">
      <span class="icon" :style="iconStyle('/images/icons/warn.svg')"></span>重连中…
    </div>
    <div v-if="store.lastError" class="banner error" @click="clearError()">
      <span class="icon" :style="iconStyle('/images/icons/error.svg')"></span>
      {{ store.lastError }}
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
}
.boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  color: #888;
}
.banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 14px;
  /* 长错误文案不许把页面撑出横向滚动 */
  max-width: calc(100vw - 24px);
  text-align: center;
  z-index: 1000;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
}
.banner.warn {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeeba;
}
.banner.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
</style>
