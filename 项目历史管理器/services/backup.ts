import { Path } from "scripting"
import { ProjectHistory, Snapshot } from "../types"
import { copyDirectory, isDirectory, pathExists } from "../utils/fs"
import { safeName, timestampForName } from "../utils/format"
import { isSelfProject, parseSnapshot } from "./history"

export function createProjectBackup(projectPath: string, backupRoot: string, description: string) {
  if (!pathExists(projectPath) || !isDirectory(projectPath)) {
    throw new Error(`项目目录不存在或不是文件夹：${projectPath}`)
  }

  if (!pathExists(backupRoot)) {
    FileManager.createDirectorySync(backupRoot, true)
  }

  const projectName = Path.basename(projectPath)
  const backupProjectPath = Path.join(backupRoot, projectName)
  const folderName = `${projectName}_${safeName(description || "主动备份")}_${timestampForName()}`
  const destination = Path.join(backupProjectPath, folderName)

  if (pathExists(destination)) {
    throw new Error(`备份目录已存在：${destination}`)
  }

  copyDirectory(projectPath, destination)
  return parseSnapshot(projectName, destination)
}

// 还原前先把当前项目状态存为一份带来源信息的备份
function createRestoreSafetyBackup(project: ProjectHistory, snapshot: Snapshot) {
  const folderName = `${Path.basename(project.path)}_还原到_${safeName(snapshot.description)}_前备份_${timestampForName()}`
  const destination = Path.join(project.path, folderName)
  copyDirectory(project.projectPath, destination)
  return destination
}

export async function restoreSnapshot(project: ProjectHistory, snapshot: Snapshot) {
  if (isSelfProject(project)) {
    throw new Error("不能在运行时还原历史管理器自身")
  }

  if (!pathExists(project.projectPath)) {
    throw new Error(`项目目录不存在：${project.projectPath}`)
  }

  if (!pathExists(snapshot.path)) {
    throw new Error(`快照目录不存在：${snapshot.path}`)
  }

  const actionIndex = await Dialog.actionSheet({
    title: "还原项目",
    message: `将 ${project.name} 还原到 ${snapshot.timestampLabel} 的快照「${snapshot.description}」。\n当前状态会先保存为“还原前”备份，文件夹名会包含被还原的快照信息。`,
    actions: [
      { label: "取消" },
      { label: "还原", destructive: true },
    ],
    cancelButton: false,
  })

  if (actionIndex !== 1) {
    return false
  }

  createRestoreSafetyBackup(project, snapshot)
  const stamp = timestampForName()
  const projectRoot = Path.dirname(project.projectPath)
  const restoreTemp = Path.join(projectRoot, `.${safeName(project.name)}.restore-${stamp}`)
  const oldTemp = Path.join(projectRoot, `.${safeName(project.name)}.before-restore-${stamp}`)

  if (pathExists(restoreTemp)) {
    FileManager.removeSync(restoreTemp)
  }
  if (pathExists(oldTemp)) {
    FileManager.removeSync(oldTemp)
  }

  try {
    copyDirectory(snapshot.path, restoreTemp)
    FileManager.renameSync(project.projectPath, oldTemp)
    FileManager.renameSync(restoreTemp, project.projectPath)
    FileManager.removeSync(oldTemp)
  } catch (error) {
    // 失败时回滚，尽量保证项目目录仍在原位
    if (!pathExists(project.projectPath) && pathExists(oldTemp)) {
      FileManager.renameSync(oldTemp, project.projectPath)
    }
    if (pathExists(restoreTemp)) {
      FileManager.removeSync(restoreTemp)
    }
    throw error
  }

  return true
}
