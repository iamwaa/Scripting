/**
 * services/storage.ts - 持久化键值存储封装
 *
 * 基于 Scripting 的 Storage API（轻量 KV 存储），
 * 集中管理 gitgit 的「设置 / 元数据 / 快照」类数据。
 *
 * 设计要点：
 *  - 使用 private 域（默认，无 shared 选项）。widget 与主脚本同属一个脚本，
 *    共享同一 private 域，因此 widget 也能读到主脚本写入的快照。
 *  - 统一键名前缀，避免与其他脚本冲突
 *  - 支持的值类型：string / number / boolean / JSON（自动序列化）
 *
 * 注意：真正的 Git 内部文件（.git 目录、工作区文件）仍走 FileManager（见 gitCore / gitService），
 *      这里只负责应用层的「设置数据」与「路径书签等元数据」。
 */

import type { RepoMeta, RepoSnapshot, GitIdentity } from "../types/git"

/** 统一键名前缀，避免污染 shared 域命名空间 */
const PREFIX = "gitgit."

/** 所有持久化键集中定义，杜绝散落的魔法字符串 */
export const STORAGE_KEYS = {
  /** 仓库列表 */
  repos: PREFIX + "repos",
  /** 全部仓库的同步快照（Widget / 通知读取） */
  snapshots: PREFIX + "snapshots",
  /** Git 提交身份（user.name / user.email） */
  identity: PREFIX + "identity",
  /** 操作完成本地通知开关（默认 true） */
  notifyEnabled: PREFIX + "notifyEnabled",
} as const

// private 域（widget 与主脚本同属一个脚本，共享同一 private 域）

// === 仓库列表 ===

/** 读取仓库列表（无数据返回空数组） */
export function readRepos(): RepoMeta[] {
  return Storage.get<RepoMeta[]>(STORAGE_KEYS.repos) ?? []
}

/** 写入整个仓库列表 */
export function writeRepos(repos: RepoMeta[]): void {
  if (!Storage.set(STORAGE_KEYS.repos, repos)) {
    throw new Error("仓库路径保存失败")
  }
}

// === 快照 ===

/** 读取全部仓库的同步快照 */
export function readSnapshots(): Record<string, RepoSnapshot> {
  return Storage.get<Record<string, RepoSnapshot>>(STORAGE_KEYS.snapshots) ?? {}
}

/** 写入全部快照 */
export function writeSnapshots(snaps: Record<string, RepoSnapshot>): void {
  if (!Storage.set(STORAGE_KEYS.snapshots, snaps)) {
    throw new Error("仓库快照保存失败")
  }
}

// === Git 身份 ===

/** 读取已保存的 Git 身份（未配置返回 null） */
export function readIdentity(): GitIdentity | null {
  return Storage.get<GitIdentity>(STORAGE_KEYS.identity)
}

/** 保存 Git 身份 */
export function writeIdentity(identity: GitIdentity): void {
  if (!Storage.set(STORAGE_KEYS.identity, identity)) {
    throw new Error("Git 身份保存失败")
  }
}

// === 通知偏好 ===

/** 是否发送操作完成通知；未配置时默认开启 */
export function readNotifyEnabled(): boolean {
  const v = Storage.get<boolean>(STORAGE_KEYS.notifyEnabled)
  return v !== false
}

/** 保存通知开关 */
export function writeNotifyEnabled(enabled: boolean): void {
  if (!Storage.set(STORAGE_KEYS.notifyEnabled, enabled)) {
    throw new Error("通知设置保存失败")
  }
}
