<script setup lang="ts">
import { ref } from 'vue'
import { asset } from '../base.js'
import { apiLogin } from '../net/api.js'
import { connect, store } from '../store.js'

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit(): Promise<void> {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await apiLogin(username.value.trim(), password.value)
    password.value = ''
    connect()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    loading.value = false
  }
}

/** Logo 加载失败 → 隐藏，只留 h1 标题 */
function hideBrokenImg(e: Event) {
  ;(e.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <div class="login">
    <div class="card">
      <img class="logo" :src="asset('/images/logo.png')" alt="干瞪眼" @error="hideBrokenImg" />
      <h1>干瞪眼</h1>
      <p class="sub">登录后继续你的对局</p>
      <form @submit.prevent="submit()">
        <label>
          用户名
          <input v-model="username" autocomplete="username" placeholder="用户名" />
        </label>
        <label>
          密码
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="密码"
          />
        </label>
        <p v-if="error || store.authMessage" class="error">
          {{ error || store.authMessage }}
        </p>
        <button type="submit" :disabled="loading">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
      </form>
      <p class="note">本游戏不开放注册，账号由管理员创建</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 16px;
}
.card {
  width: min(340px, 100%);
  padding: 32px 28px;
  background: var(--panel, #fff);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgb(0 0 0 / 10%);
}
.logo {
  width: 80px;
  height: 80px;
  display: block;
  margin: 0 auto 12px;
  border-radius: 18px;
}
h1 {
  margin: 0 0 4px;
  text-align: center;
  font-size: 28px;
}
.sub {
  text-align: center;
  color: #888;
  font-size: 13px;
  margin: 0 0 20px;
}
form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}
input {
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 15px;
}
input:focus {
  outline: none;
  border-color: #4a90d9;
}
button {
  padding: 11px;
  border: none;
  border-radius: 8px;
  background: #4a90d9;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
button:not(:disabled):hover {
  background: #3a7bc0;
}
.error {
  margin: 0;
  color: #d9534f;
  font-size: 13px;
}
.note {
  margin: 16px 0 0;
  text-align: center;
  color: #aaa;
  font-size: 12px;
}

@media (max-width: 640px) {
  .login {
    padding: 12px;
  }
  .card {
    padding: 24px 20px;
  }
}
</style>
