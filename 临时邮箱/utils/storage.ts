const HISTORY_KEY = "tempMail.history.v1"
const TOKEN_KEY = "tempMail.tokens.v1"
const API_KEY_KEY = "tempMail.apiKey.v1"
const MAX_HISTORY = 20

export type HistoryItem = {
  email: string
  lastUsedAt: number
}

// 通用 Storage 读写
function storageGet(key: string): any {
  const g = globalThis as any
  if (g.Storage && typeof g.Storage.get === "function") {
    return g.Storage.get(key)
  }
  return undefined
}

function storageSet(key: string, value: any): void {
  const g = globalThis as any
  if (g.Storage && typeof g.Storage.set === "function") {
    g.Storage.set(key, value)
  }
}

function storageRemove(key: string): void {
  const g = globalThis as any
  if (g.Storage && typeof g.Storage.remove === "function") {
    g.Storage.remove(key)
  }
}

// 读取本地历史记录
export function loadHistory(): HistoryItem[] {
  const value = storageGet(HISTORY_KEY)
  if (Array.isArray(value)) {
    return value as HistoryItem[]
  }
  return []
}

// 保存历史记录
export function saveHistory(items: HistoryItem[]): void {
  storageSet(HISTORY_KEY, items)
}

// 将邮箱加入历史记录（移到最前并限制数量）
export function addToHistory(email: string): void {
  let history = loadHistory()
  history = history.filter((item) => item.email !== email)
  history.unshift({
    email,
    lastUsedAt: Date.now(),
  })
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY)
  }
  saveHistory(history)
}

// 读取邮箱 token 映射
function loadTokenMap(): Record<string, string> {
  const value = storageGet(TOKEN_KEY)
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, string>
  }
  return {}
}

// 保存邮箱 token 映射
function saveTokenMap(map: Record<string, string>): void {
  storageSet(TOKEN_KEY, map)
}

// 读取指定邮箱的 inbox token
export function getToken(email: string): string | null {
  const map = loadTokenMap()
  return map[email] || null
}

// 保存指定邮箱的 inbox token
export function saveToken(email: string, token: string): void {
  const map = loadTokenMap()
  map[email] = token
  saveTokenMap(map)
}

// 读取 API Key（可选，免费层可不填）
export function getApiKey(): string {
  const value = storageGet(API_KEY_KEY)
  return typeof value === "string" ? value : ""
}

// 保存 API Key
export function saveApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    storageRemove(API_KEY_KEY)
    return
  }
  storageSet(API_KEY_KEY, trimmed)
}

// 清空所有历史记录与 token 缓存
export function clearHistory(): void {
  storageRemove(HISTORY_KEY)
  storageRemove(TOKEN_KEY)
}

// 从邮箱地址提取前缀
export function getPrefixFromEmail(email: string): string {
  return email.split("@")[0] || ""
}

// 从邮箱地址提取域名
export function getDomainFromEmail(email: string): string {
  return email.split("@")[1] || ""
}
