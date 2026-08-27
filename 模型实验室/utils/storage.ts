import { defaultConfig, thinkingLevels } from "../constants"
import { AppConfig } from "../types"

const configKey = "model-lab-config"

// 旧版本可能存了已移除的等级（minimal / low），统一回落到「中」
function normalizeThinkingLevel(config: AppConfig): AppConfig {
  const valid = thinkingLevels.some(item => item.tag === config.thinkingLevel)
  return valid ? config : { ...config, thinkingLevel: "medium" }
}

export function loadConfig(): AppConfig {
  const saved = Storage.get<Partial<AppConfig>>(configKey)
  return normalizeThinkingLevel({ ...defaultConfig, ...(saved ?? {}) })
}

export function saveConfig(config: AppConfig) {
  Storage.set(configKey, config)
}
