import { defaultConfig, thinkingLevels } from "../constants"
import { ApiProfile, AppConfig } from "../types"
import { createApiID } from "./apiProfiles"

const configKey = "model-lab-config"

// 1.0 版本只存单个 baseURL/apiKey，读取时要迁移成接口列表
type StoredConfig = Partial<AppConfig> & { baseURL?: string; apiKey?: string }

// 旧版本可能存了已移除的等级（minimal / low），统一回落到「中」
function normalizeThinkingLevel(config: AppConfig): AppConfig {
  const valid = thinkingLevels.some(item => item.tag === config.thinkingLevel)
  return valid ? config : { ...config, thinkingLevel: "medium" }
}

// 存储里的接口可能缺字段或缺 id，逐项补齐后再交给界面
function normalizeApi(raw: Partial<ApiProfile>): ApiProfile {
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createApiID(),
    name: typeof raw.name === "string" ? raw.name : "",
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
  }
}

function resolveApis(saved: StoredConfig): Pick<AppConfig, "apis" | "activeApiID"> {
  // 已是多接口结构：空数组也如实保留，避免用户删完后又被塞回默认接口
  if (Array.isArray(saved.apis)) {
    const apis = saved.apis.filter(item => item != null && typeof item === "object").map(normalizeApi)
    const activeApiID = apis.some(api => api.id === saved.activeApiID) ? saved.activeApiID! : apis[0]?.id ?? ""
    return { apis, activeApiID }
  }
  // 旧版单接口配置：原样迁移成第一条接口，名称留空由地址主机名代替
  if (typeof saved.baseURL === "string" || typeof saved.apiKey === "string") {
    const migrated = normalizeApi({ baseURL: saved.baseURL, apiKey: saved.apiKey })
    return { apis: [migrated], activeApiID: migrated.id }
  }
  return { apis: defaultConfig.apis.map(api => ({ ...api })), activeApiID: defaultConfig.activeApiID }
}

// 迁移后的配置不再保留旧字段，避免下次读取时又走迁移分支
function withoutLegacyFields(saved: StoredConfig): Partial<AppConfig> {
  const next: StoredConfig = { ...saved }
  delete next.baseURL
  delete next.apiKey
  return next
}

export function loadConfig(): AppConfig {
  const saved = Storage.get<StoredConfig>(configKey) ?? {}
  return normalizeThinkingLevel({ ...defaultConfig, ...withoutLegacyFields(saved), ...resolveApis(saved) })
}

export function saveConfig(config: AppConfig) {
  Storage.set(configKey, config)
}
