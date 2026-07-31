/**
 * types/git.ts - 全局类型定义
 * 贯穿 services / pages / components 的数据契约
 */

/** Git 提交身份（user.name / user.email） */
export interface GitIdentity {
  name: string
  email: string
}

/** 仓库来源 */
export type RepoSource = "local" | "clone"

/** 仓库元数据（持久化于 repoStore） */
export interface RepoMeta {
  /** 用户给仓库起的别名 */
  name: string
  /** 仓库列表主键；新数据用短 repoId，旧数据可能是路径 */
  bookmarkName: string
  /** 稳定短 ID，用于 gitdir 目录名与访问书签名，避免路径混淆 */
  repoId?: string
  /** 用户选择的实际工作目录路径（展示/回退用） */
  workdir?: string
  /** 克隆仓库相对于访问书签目录的子路径 */
  workdirRelative?: string
  /** 安全范围书签名：解析真实路径必须优先走它 */
  accessBookmarkName?: string
  /** 远端地址（可选，clone/push/pull 使用） */
  remoteUrl?: string
  /** 默认分支（可选，仅做展示记忆） */
  defaultBranch?: string
  /** 上传已创建但尚未推送的远端地址，可用于失败后重试 */
  pendingRemoteUrl?: string
  pendingRemoteName?: string
  /** 仓库来源：本地添加 / 克隆 */
  source?: RepoSource
  /** 各本地分支最近一次拉取成功时间（ms 时间戳） */
  lastPulledAtByBranch?: Record<string, number>
  /** 创建时间（ms 时间戳） */
  createdAt: number
}

export type RepoSyncState = "upToDate" | "ahead" | "behind" | "diverged" | "unknown"

/** 仓库列表行状态（改动 / 待推送 / 合并冲突） */
export interface RepoListStatus {
  branch: string | null
  uncommitted: number
  ahead: number
  behind: number
  syncState: RepoSyncState
  hasRemote: boolean
  workdirOk: boolean
  /** 未解决冲突文件数（无进行中合并为 0） */
  conflictCount: number
  /** 是否存在 gitgit-merge-state（含冲突已清但待完成提交） */
  mergeInProgress: boolean
  error?: string
}

/** 文件改动状态（对齐 isomorphic-git statusMatrix 语义） */
export type FileChangeStatus =
  | "added" // 新增且已暂存
  | "*added" // 新增未暂存 / 暂存后又被改
  | "modified" // 已修改且已暂存
  | "*modified" // 已修改未暂存
  | "deleted" // 已删除且已暂存
  | "*deleted" // 已删除未暂存
  | "unmodified" // 无变化

/** 单个文件的改动信息 */
export interface FileChange {
  filepath: string
  status: FileChangeStatus
  /** 索引与 HEAD 不同，可被提交 */
  staged: boolean
  /** 工作区与索引不同，可继续暂存 */
  unstaged: boolean
}

/** Stash 列表项，index 对应 stash@{index} */
export interface StashEntry {
  index: number
  ref: string
  message: string
  /** stash commit oid，用于查看该次暂存的文件改动 */
  oid?: string
}

/** 冲突类型：双方改 / 我方删对方改 / 对方删我方改 */
export type ConflictKind = "bothModified" | "deleteByUs" | "deleteByTheirs"

/** 单个冲突文件 */
export interface ConflictFile {
  filepath: string
  kind: ConflictKind
}

/** 仓库进行中的合并状态（供 UI 展示） */
export interface MergeConflictState {
  oursOid: string
  theirsOid: string
  oursLabel: string
  theirsLabel: string
  message: string
  conflicts: ConflictFile[]
  startedAt: number
}

/** 提交在历史中的同步状态 */
export type CommitSyncStatus = "unpushed" | "remote" | "local"

/** commit 历史条目 */
export interface CommitEntry {
  oid: string
  message: string
  author: { name: string; email: string }
  date: string
  /**
   * unpushed=已提交未推送；remote=已在 origin 跟踪分支上；
   * local=无远端或无跟踪分支
   */
  syncStatus?: CommitSyncStatus
  /** 是否为当前 HEAD（用于未推送的撤销/重编） */
  isHead?: boolean
}

/** 提交相对第一父提交的文件状态 */
export type CommitFileStatus = "added" | "modified" | "deleted"

export interface CommitFileChange {
  filepath: string
  status: CommitFileStatus
}

/** 提交详情 */
export interface CommitDetail {
  oid: string
  message: string
  author: { name: string; email: string }
  committer: { name: string; email: string }
  date: string
  parentOid: string | null
  parentCount: number
  files: CommitFileChange[]
}

/**
 * origin 当前同名分支与远端管理中设置的目标分支的差异对比结果。
 * 文件差异为三点语义：merge-base → 各侧 tip；无共同祖先时相对空树。
 */
export interface RefCompareResult {
  /** 基准远端分支，如 origin/main */
  baseTrack: string
  /** 远端管理中为当前分支设置的目标远端分支 */
  targetTrack: string
  /** 兼容旧字段：本地分支名与目标标识 */
  localBranch: string
  track: string
  baseOid: string
  targetOid: string
  localOid: string
  remoteOid: string
  /** 共同祖先 oid；无共同祖先为 null */
  mergeBaseOid: string | null
  syncState: RepoSyncState
  /** 仅基准远端拥有的提交总数 */
  ahead: number
  /** 仅设置远端拥有的提交总数 */
  behind: number
  /** 仅基准远端拥有的提交列表（最新在前，超出上限时截断） */
  aheadCommits: CommitEntry[]
  /** 仅设置远端拥有的提交列表（最新在前，超出上限时截断） */
  behindCommits: CommitEntry[]
  /** merge-base → 基准远端 tip 的文件变化 */
  localFiles: CommitFileChange[]
  /** merge-base → 设置远端 tip 的文件变化 */
  remoteFiles: CommitFileChange[]
}

/** 分支列表结果 */
export interface BranchInfo {
  branches: string[]
  current: string | null
}

/** 分支管理页数据：区分本地分支与仅远端存在的分支 */
export interface ManagedBranches {
  current: string | null
  /** 本地分支短名（含 current） */
  locals: string[]
  /** 仅远端存在（本地无同名）的分支短名 */
  remotes: string[]
  /** 全部 origin 跟踪分支短名（去掉 origin/ 前缀、去掉 HEAD），用于「远端是否存在」标签 */
  remoteNames: string[]
  /** 是否存在 origin 远端 */
  hasRemote: boolean
}

/** 重命名分支结果：本地一定完成；若旧分支发布过则尝试远端同步（推新分支 + 删远端旧分支） */
export interface RenameBranchResult {
  from: string
  to: string
  /** 旧分支曾配置的远端名；null 表示纯本地分支，未触发远端同步 */
  oldRemote: string | null
  /** 是否已推送新分支到远端 */
  pushedNewBranch: boolean
  /** 是否已删除远端旧分支 */
  deletedOldRemoteBranch: boolean
  /** 远端同步失败信息（本地 rename 已成功，仅远端步骤失败） */
  remoteError: string | null
}

/** Git 操作结果（统一返回结构） */
export interface GitResult<T = unknown> {
  ok: boolean
  result?: T
  error?: string
}

/** 仓库同步状态快照（供 Widget / 通知使用） */
export interface RepoSnapshot {
  name: string
  branch: string | null
  uncommitted: number
  ahead: number
  behind: number
  updatedAt: number
}

// === GitHub REST API 类型 ===

/** GitHub 用户信息 */
export interface GitHubUser {
  login: string
  name: string | null
  avatarUrl: string
  bio: string | null
  publicRepos: number
  followers: number
}

/** GitHub fork 的直接上游仓库 */
export interface GitHubRepoParent {
  fullName: string
  url: string
  defaultBranch: string
}

/** GitHub 仓库（精简） */
export interface GitHubRepo {
  name: string
  fullName: string
  url: string // clone 地址
  private: boolean
  description: string | null
  defaultBranch: string
  updatedAt: string
  stargazersCount: number
  fork: boolean
  /** 仓库详情接口才返回；列表中的 fork 需按需补查 */
  parent?: GitHubRepoParent
}
