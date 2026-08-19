import { AppConfig } from "../types"
import { configStorageKey, defaultBackupRoot, defaultProjectRoot } from "../constants"
import { isDirectory, pathExists } from "../utils/fs"

// 补齐缺失字段，保证配置结构完整
export function normalizeConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
  return {
    backupRoot: config?.backupRoot || defaultBackupRoot,
    projectRoot: config?.projectRoot || defaultProjectRoot,
    backupBookmarkName: config?.backupBookmarkName || null,
    projectBookmarkName: config?.projectBookmarkName || null,
  }
}

export function resolveConfig(): AppConfig {
  return normalizeConfig(Storage.get<Partial<AppConfig>>(configStorageKey))
}

export function saveConfig(config: AppConfig) {
  const nextConfig = normalizeConfig(config)
  const saved = Storage.set(configStorageKey, nextConfig)
  if (!saved) {
    throw new Error("保存路径配置失败")
  }
}

export function validateDirectory(path: string, setStatus: (status: string) => void) {
  if (!path.trim()) {
    setStatus("路径不能为空")
    return false
  }

  if (!pathExists(path) || !isDirectory(path)) {
    setStatus("路径不存在或不是文件夹")
    return false
  }

  return true
}

export async function pickDirectory(initialDirectory: string) {
  return DocumentPicker.pickDirectory(
    pathExists(initialDirectory) ? initialDirectory : FileManager.iCloudDocumentsDirectory,
  )
}
