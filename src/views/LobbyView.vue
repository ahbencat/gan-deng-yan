<script setup lang="ts">
import { computed, ref } from 'vue'
import { configSummary } from '../label.js'
import { apiLogout } from '../net/api.js'
import { disconnect, send, store } from '../store.js'
import ConfigForm from '../components/ConfigForm.vue'
import type { RoomConfig } from '../types.js'
import { DEFAULT_ROOM_CONFIG } from '../types.js'

const showCreate = ref(false)
const createConfig = ref<RoomConfig>({ ...DEFAULT_ROOM_CONFIG })

const stats = computed(() => {
  const u = store.user
  if (!u) return ''
  return `积分 ${u.score} · ${u.gamesPlayed}局 · ${u.wins}胜`
})

function refresh(): void {
  send('lobby.list', {})
}

function createRoom(): void {
  send('room.create', { config: createConfig.value })
  showCreate.value = false
}

function joinRoom(roomId: number): void {
  send('room.join', { roomId })
}

async function logout(): Promise<void> {
  disconnect()
  try {
    await apiLogout()
  } finally {
    store.phase = 'login'
    store.user = null
    store.room = null
    store.lobbyRooms = []
  }
}
</script>

<template>
  <div class="lobby">
    <header>
      <div class="me">
        <strong>{{ store.user?.nickname }}</strong>
        <span class="stats">{{ stats }}</span>
      </div>
      <div class="actions">
        <button class="ghost" @click="refresh()">刷新</button>
        <button class="ghost" @click="logout()">退出登录</button>
        <button @click="showCreate = true">创建房间</button>
      </div>
    </header>

    <main>
      <h2>房间列表</h2>
      <p v-if="store.lobbyRooms.length === 0" class="empty">
        暂无房间，点击右上角「创建房间」开一桌
      </p>
      <ul class="rooms">
        <li v-for="r in store.lobbyRooms" :key="r.id">
          <div class="info">
            <span class="id">#{{ r.id }}</span>
            <span class="host">{{ r.hostName }} 的房间</span>
            <span class="count">{{ r.playerCount }}/{{ r.maxPlayers }}人</span>
            <span class="cfg">{{ configSummary(r.config) }}</span>
          </div>
          <div class="right">
            <span class="status" :class="r.status">
              {{ r.status === 'playing' ? '对局中' : '等待中' }}
            </span>
            <button
              v-if="r.status === 'waiting' && r.playerCount < r.maxPlayers"
              @click="joinRoom(r.id)"
            >
              加入
            </button>
            <span v-else class="na">—</span>
          </div>
        </li>
      </ul>
    </main>

    <div v-if="showCreate" class="modal" @click.self="showCreate = false">
      <div class="dialog">
        <h3>创建房间</h3>
        <ConfigForm v-model="createConfig" />
        <div class="btns">
          <button class="ghost" @click="showCreate = false">取消</button>
          <button @click="createRoom()">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.me {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats {
  font-size: 13px;
  color: #888;
}
.actions {
  display: flex;
  gap: 8px;
}
h2 {
  font-size: 18px;
  margin: 0 0 12px;
}
.empty {
  color: #999;
  font-size: 14px;
}
.rooms {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rooms li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--panel, #fff);
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 14px 16px;
}
.info {
  display: flex;
  gap: 14px;
  align-items: baseline;
  flex-wrap: wrap;
}
.id {
  font-weight: 700;
  color: #4a90d9;
}
.host {
  font-weight: 600;
}
.count {
  color: #666;
  font-size: 14px;
}
.cfg {
  color: #999;
  font-size: 13px;
}
.right {
  display: flex;
  gap: 10px;
  align-items: center;
}
.status {
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 999px;
}
.status.waiting {
  background: #e7f5e9;
  color: #2e7d32;
}
.status.playing {
  background: #fff3e0;
  color: #e65100;
}
.na {
  color: #ccc;
}
button {
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  background: #4a90d9;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
button:hover {
  background: #3a7bc0;
}
button.ghost {
  background: #f0f0f0;
  color: #555;
}
button.ghost:hover {
  background: #e4e4e4;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 40%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: var(--panel, #fff);
  border-radius: 12px;
  padding: 24px;
  width: 380px;
  max-height: 90vh;
  overflow: auto;
}
.dialog h3 {
  margin: 0 0 16px;
}
.btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
