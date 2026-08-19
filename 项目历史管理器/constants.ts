import { Path } from "scripting"

// 配置存储键与默认路径
export const configStorageKey = "project-history-manager-config"
export const defaultBackupRoot = Path.join(FileManager.iCloudDocumentsDirectory, "backup")
export const defaultProjectRoot = FileManager.scriptsDirectory
export const managerProjectName = "项目历史管理器"
export const managerProjectPath = Path.join(defaultProjectRoot, managerProjectName)

// 错误提示配色
export const errorColor = "#FF3B30"
