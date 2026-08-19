import { Path } from "scripting"
import { AppConfig, ProjectCandidate, ProjectHistory, Snapshot } from "../types"
import { managerProjectPath } from "../constants"
import { isDirectory, isSamePath, listChildren, pathExists, statTime, summarizeDirectory } from "../utils/fs"
import { formatDate, parseTimestamp } from "../utils/format"

// 备份文件夹名可能把项目名里的空格写成下划线，这里还原真实项目名
export function displayProjectName(backupFolderName: string, projectRoot: string) {
  const directPath = Path.join(projectRoot, backupFolderName)
  if (pathExists(directPath)) {
    return backupFolderName
  }

  const spacedName = backupFolderName.replace(/_/g, " ")
  const spacedPath = Path.join(projectRoot, spacedName)
  if (pathExists(spacedPath)) {
    return spacedName
  }

  return backupFolderName
}

export function parseSnapshot(projectName: string, snapshotPath: string): Snapshot {
  const name = Path.basename(snapshotPath)
  const prefix = `${projectName}_`
  const body = name.startsWith(prefix) ? name.slice(prefix.length) : name
  const match = body.match(/^(.*?)(?:_)?(\d{8})_(\d{6})$/)
  const fallbackTime = statTime(snapshotPath)
  const timestamp = match ? parseTimestamp(match[2], match[3]) : fallbackTime
  const description = match?.[1] ? match[1].replace(/_/g, " ") : "无描述"
  const summary = summarizeDirectory(snapshotPath)

  return {
    id: snapshotPath,
    name,
    path: snapshotPath,
    projectName,
    description,
    timestamp,
    timestampLabel: formatDate(timestamp),
    fileCount: summary.fileCount,
    byteSize: summary.byteSize,
  }
}

export function scanSnapshots(backupProjectPath: string): Snapshot[] {
  const backupFolderName = Path.basename(backupProjectPath)
  return listChildren(backupProjectPath)
    .filter(isDirectory)
    .map((snapshotPath) => parseSnapshot(backupFolderName, snapshotPath))
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function buildProjectHistory(backupProjectPath: string, config: AppConfig): ProjectHistory {
  const backupFolderName = Path.basename(backupProjectPath)
  const projectName = displayProjectName(backupFolderName, config.projectRoot)
  const snapshots = scanSnapshots(backupProjectPath)

  return {
    id: backupProjectPath,
    name: projectName,
    path: backupProjectPath,
    projectPath: Path.join(config.projectRoot, projectName),
    snapshots,
    latest: snapshots[0],
    totalBytes: snapshots.reduce((total, item) => total + item.byteSize, 0),
  }
}

export function scanHistories(config: AppConfig): ProjectHistory[] {
  if (!pathExists(config.backupRoot)) {
    return []
  }

  return listChildren(config.backupRoot)
    .filter(isDirectory)
    .map((backupProjectPath) => buildProjectHistory(backupProjectPath, config))
    .filter((project) => project.snapshots.length > 0)
    .sort((a, b) => (b.latest?.timestamp || 0) - (a.latest?.timestamp || 0))
}

export function refreshProjectHistory(project: ProjectHistory): ProjectHistory {
  const snapshots = scanSnapshots(project.path)

  return {
    ...project,
    snapshots,
    latest: snapshots[0],
    totalBytes: snapshots.reduce((total, item) => total + item.byteSize, 0),
  }
}

export function scanProjectDirectories(projectRoot: string): ProjectCandidate[] {
  if (!pathExists(projectRoot)) {
    return []
  }

  return listChildren(projectRoot)
    .filter(isDirectory)
    .map((path) => ({
      id: path,
      name: Path.basename(path),
      path,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
}

export function filterProjects(projects: ProjectHistory[], query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return projects
  }

  return projects.filter((project) => project.name.toLowerCase().includes(keyword))
}

export function filterCandidates(candidates: ProjectCandidate[], query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    return candidates
  }

  return candidates.filter((item) => item.name.toLowerCase().includes(keyword))
}

// 判断是否为本管理器自身，运行时不允许还原自己
export function isSelfProject(project: ProjectHistory) {
  return isSamePath(project.projectPath, managerProjectPath)
}
