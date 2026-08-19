// 项目历史管理器的公共类型定义

export type Snapshot = {
  id: string
  name: string
  path: string
  projectName: string
  description: string
  timestamp: number
  timestampLabel: string
  fileCount: number
  byteSize: number
}

export type ProjectHistory = {
  id: string
  name: string
  path: string
  projectPath: string
  snapshots: Snapshot[]
  latest?: Snapshot
  totalBytes: number
}

export type AppConfig = {
  backupRoot: string
  projectRoot: string
  backupBookmarkName: string | null
  projectBookmarkName: string | null
}

export type ProjectCandidate = {
  id: string
  name: string
  path: string
}

export type DirectorySummary = {
  fileCount: number
  byteSize: number
}

export type PathSettingType = "backup" | "project"
