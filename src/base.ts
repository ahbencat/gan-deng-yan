// 部署基准路径：默认根路径；子路径部署时由构建参数 BASE_PATH 决定（见 vite.config.ts）。
// BASE 不带尾斜杠：根部署为 ''，/just_look/ 部署为 '/just_look'。
const rawBase = import.meta.env.BASE_URL
export const BASE = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase

/** 站内绝对路径补上部署前缀（BASE 为空时原样返回） */
export function asset(path: string): string {
  return `${BASE}${path}`
}

/** CSS mask 图标用的 style：--i 自定义属性，值必须是 url(...) 字符串 */
export function iconStyle(path: string): Record<string, string> {
  return { '--i': `url('${asset(path)}')` }
}
