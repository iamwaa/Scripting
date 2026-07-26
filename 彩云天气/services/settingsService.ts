import { STORAGE_KEYS } from "../constants"

// 读取用户配置的 Token；未设置返回空字符串
export function loadApiToken(): string {
  const raw = Storage.get<string>(STORAGE_KEYS.apiToken)
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim()
  }
  return ""
}

export function hasApiToken(): boolean {
  return loadApiToken().length > 0
}

// 保存 Token；传空则清除
export function saveApiToken(token: string): void {
  const trimmed = token.trim()
  if (!trimmed) {
    Storage.remove(STORAGE_KEYS.apiToken)
    return
  }
  Storage.set(STORAGE_KEYS.apiToken, trimmed)
}

export function clearApiToken(): void {
  Storage.remove(STORAGE_KEYS.apiToken)
}
