// REST 封装：登录/登出/当前用户；401 统一返回 null
import type { UserPublic } from '../types.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new Error(body.error || `请求失败 (${res.status})`)
  }
  return body
}

export async function apiLogin(username: string, password: string): Promise<UserPublic> {
  const r = await request<{ user: UserPublic }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return r.user
}

export async function apiLogout(): Promise<void> {
  await request('/api/logout', { method: 'POST' })
}

export async function apiMe(): Promise<UserPublic | null> {
  const r = await request<{ user: UserPublic | null }>('/api/me')
  return r.user
}
