import { ApiProfile, AppConfig } from "../types"

// 运行时没有 UUID 生成器，用时间戳 + 随机数拼接保证 id 唯一
export function createApiID() {
  return `api-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`
}

export function createApi(patch: Partial<ApiProfile> = {}): ApiProfile {
  return { id: createApiID(), name: "", baseURL: "", apiKey: "", ...patch }
}

// 取地址中的主机名，用于未命名接口的展示
function apiHost(baseURL: string) {
  const trimmed = baseURL.trim()
  const matched = trimmed.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/)
  return matched ? matched[1] : trimmed.split("/")[0]
}

export function apiDisplayName(api: ApiProfile) {
  return api.name.trim() || apiHost(api.baseURL) || "未命名接口"
}

export function apiSummary(api: ApiProfile) {
  return api.baseURL.trim() || "未填写地址"
}

// 密钥只展示首尾，避免整串明文出现在列表里
export function maskApiKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key) return "未填写密钥"
  return key.length <= 10 ? "••••" : `${key.slice(0, 5)}••••${key.slice(-4)}`
}

// 当前接口：id 失效时回落到第一条，列表为空时返回空接口，调用方无需判空
export function activeApi(config: AppConfig): ApiProfile {
  return config.apis.find(api => api.id === config.activeApiID) ?? config.apis[0] ?? createApi({ id: "" })
}

// 新增的接口在列表原本为空时自动成为当前接口
export function addApi(config: AppConfig, api: ApiProfile): AppConfig {
  return {
    ...config,
    apis: [...config.apis, api],
    activeApiID: config.apis.length === 0 ? api.id : config.activeApiID,
  }
}

export function updateApi(config: AppConfig, id: string, patch: Partial<ApiProfile>): AppConfig {
  return { ...config, apis: config.apis.map(api => (api.id === id ? { ...api, ...patch } : api)) }
}

// 删除后当前接口若被移除，自动切到剩余的第一条
export function removeApi(config: AppConfig, id: string): AppConfig {
  const apis = config.apis.filter(api => api.id !== id)
  const activeApiID = apis.some(api => api.id === config.activeApiID) ? config.activeApiID : apis[0]?.id ?? ""
  return { ...config, apis, activeApiID }
}
