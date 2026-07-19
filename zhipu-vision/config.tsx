// 配置管理 — 持久化存储 API 配置，避免硬编码在代码中
// 配置文件存储在 App Group Documents 中，不会出现在用户文件 App 中

export interface ConfigData {
  apiKey: string
  apiBase: string
  model: string
}

const DEFAULT_CONFIG: ConfigData = {
  apiKey: "",
  apiBase: "https://open.bigmodel.cn/api/paas/v4/",
  model: "glm-4.6v",
}

function getConfigPath(): string {
  return FileManager.appGroupDocumentsDirectory + "/zhipu-vision-config.json"
}

export async function loadConfig(): Promise<ConfigData> {
  try {
    const path = getConfigPath()
    if (await FileManager.exists(path)) {
      const content = await FileManager.readAsString(path)
      if (content) {
        const parsed = JSON.parse(content) as ConfigData
        return {
          apiKey: parsed.apiKey || "",
          apiBase: parsed.apiBase || DEFAULT_CONFIG.apiBase,
          model: parsed.model || DEFAULT_CONFIG.model,
        }
      }
    }
  } catch (e) {
    console.warn("读取配置失败，使用默认值", e)
  }
  return { ...DEFAULT_CONFIG }
}

export async function saveConfig(config: ConfigData): Promise<void> {
  const path = getConfigPath()
  await FileManager.writeAsString(path, JSON.stringify(config, null, 2))
}
