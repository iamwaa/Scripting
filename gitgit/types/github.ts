export type GitHubItemState = "open" | "closed"
export type GitHubIssueFilter = "open" | "closed" | "all"

export interface GitHubLabel {
  name: string
  color: string
}

export interface GitHubActor {
  login: string
  avatarUrl: string
}

export interface GitHubIssueItem {
  number: number
  title: string
  body: string
  state: GitHubItemState
  author: GitHubActor
  labels: GitHubLabel[]
  comments: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  htmlUrl: string
  isPullRequest: boolean
  draft: boolean
  merged: boolean
}

export interface GitHubComment {
  id: number
  body: string
  author: GitHubActor
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface GitHubIssuePage {
  items: GitHubIssueItem[]
  hasMore: boolean
}

export type GitHubCommitAvatarMap = Record<string, string>

export interface CreateGitHubIssueInput {
  title: string
  body?: string
}

// ===== GitHub Actions =====

/** 工作流运行状态（conclusion 仅在 completed 状态下有值） */
export type ActionRunStatus =
  | "queued"
  | "in_progress"
  | "completed"

/** 运行结论（completed 状态下的结果） */
export type ActionRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "neutral"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"
  | null

/** 工作流运行列表项 */
export interface ActionRun {
  id: number
  name: string
  /** 触发该运行的工作流文件名，如 ci.yml */
  workflowName: string
  /** 触发分支或标签名 */
  headBranch: string
  displayTitle: string
  status: ActionRunStatus
  conclusion: ActionRunConclusion
  /** 触发事件类型，如 push / pull_request / workflow_dispatch */
  event: string
  /** 触发者登录名 */
  actorLogin: string
  /** 触发者头像 */
  actorAvatarUrl: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
  /** 触发提交的短 SHA */
  headShaShort: string
  /** 是否可重新运行 */
  rerunnable: boolean
}

/** 工作流运行分页结果 */
export interface ActionRunPage {
  runs: ActionRun[]
  hasMore: boolean
}

/** Job 运行状态 */
export type ActionJobStatus = ActionRunStatus
export type ActionJobConclusion = ActionRunConclusion

/** 工作流运行中的单个 Job */
export interface ActionJob {
  id: number
  name: string
  status: ActionJobStatus
  conclusion: ActionJobConclusion
  startedAt: string
  completedAt: string
  /** Job 步骤列表 */
  steps: ActionStep[]
  /** 关联的 check-run ID（用于获取注解） */
  checkRunId?: number
}

/** Job 中的单个步骤 */
export interface ActionStep {
  name: string
  status: ActionJobStatus
  conclusion: ActionJobConclusion
  number: number
  /** 步骤开始时间（ISO 8601，可能为空） */
  startedAt?: string
  /** 步骤结束时间（ISO 8601，可能为空） */
  completedAt?: string
}

/** Job 日志（纯文本） */
export type ActionJobLog = string

/** 注解级别 */
export type AnnotationLevel = "notice" | "warning" | "failure"

/** 检查运行注解（类似 GitHub 网页 Annotations 区域） */
export interface ActionAnnotation {
  /** 注解级别 */
  level: AnnotationLevel
  /** 注解标题（可能为空） */
  title?: string
  /** 注解消息内容 */
  message: string
  /** 关联的文件路径（可能为空） */
  path?: string
  /** 起始行号 */
  startLine?: number
  /** 结束行号 */
  endLine?: number
  /** 原始详情（可能为空） */
  rawDetails?: string
}

/** 工作流定义（用于筛选与手动触发） */
export interface ActionWorkflow {
  /** GitHub 内部节点 ID（dispatch 端点需要） */
  id: number
  /** 工作流文件名，如 ci.yml */
  name: string
  /** 工作流显示名（name: 字段，可能等于文件名） */
  displayName: string
  /** 工作流文件路径，如 .github/workflows/ci.yml */
  path: string
  /** 工作流状态：active / disabled_manually / disabled_inactivity */
  state: string
}

/** 工作流手动触发输入 */
export interface DispatchWorkflowInput {
  /** 目标分支或标签名 */
  ref: string
  /** 可选的 dispatch 输入参数（键值对） */
  inputs?: Record<string, string>
}

/*
 * GitHub StatusState 的合并视图：
 * SUCCESS -> success；FAILURE / ERROR -> failure；PENDING -> pending；
 * EXPECTED -> queued；无 rollup -> 跳过缓存，岭致下次刷新重新查。
 */

/** 单个提交的检查状态，用于历史行徽标 */
export type CommitCheckState =
  | "success"
  | "failure"
  | "pending"
  | "queued"

/** 提交 oid（小写） -> 检查状态映射 */
export type CommitCheckStatusMap = Record<string, CommitCheckState>

/** 工件（构建产物） */
export interface ActionArtifact {
  id: number
  name: string
  /** 工件大小（字节） */
  sizeInBytes: number
  /** 下载 URL（需要授权） */
  archiveDownloadUrl: string
  /** 是否已过期 */
  expired: boolean
  /** 创建时间 */
  createdAt: string
  /** 过期时间 */
  expiresAt: string
}
