import { fetch } from 'scripting'

export const API_BASE = 'https://api.fuckip.me/api/v1'
const TOKEN_KEY = 'narwhal.credential'

export function savedToken(): string {
  return Keychain.get(TOKEN_KEY) ?? ''
}

export function saveToken(token: string) {
  if (!Keychain.set(TOKEN_KEY, token)) throw new Error('凭据保存失败，请重试。')
}

export function removeToken() {
  if (!Keychain.remove(TOKEN_KEY)) throw new Error('凭据清除失败，请重试。')
}

export async function request<T>(path: string, token = '', method = 'GET', body?: unknown, timeout = 30): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout,
    // 防止凭据随跨站重定向泄露；API 不应要求重定向。
    handleRedirect: async () => null,
  })
  const text = await response.text()
  let result: { code?: number; msg?: string; data?: T }
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(`服务返回非 JSON 数据（HTTP ${response.status}）`)
  }
  if (!response.ok || result.code !== 0) {
    const hint = response.status === 401 ? '登录已失效，请退出并重新登录。' : `HTTP ${response.status}`
    throw new Error(result.msg || hint)
  }
  return result.data as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
