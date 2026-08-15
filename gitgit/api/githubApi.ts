/**
 * api/githubApi.ts - GitHub API 客户端
 *
 * 用于 GitHub REST 与 GraphQL 数据查询。
 * 认证：Bearer token（来自 authStore）。
 */

import { getToken } from "../services/authStore"
import { setLruEntry } from "../utils/lru"
import type { GitHubUser, GitHubRepo } from "../types/git"
import type {
  CreateGitHubIssueInput,
  GitHubComment,
  GitHubIssueFilter,
  GitHubIssueItem,
  GitHubIssuePage,
  GitHubCommitAvatarMap,
  ActionRun,
  ActionRunPage,
  ActionJob,
  ActionJobLog,
  ActionWorkflow,
  DispatchWorkflowInput,
  ActionArtifact,
  ActionAnnotation,
  AnnotationLevel,
} from "../types/github"

const API_BASE = "https://api.github.com"
const GRAPHQL_URL = "https://api.github.com/graphql"
const COMMIT_AVATAR_CACHE_LIMIT = 500
const commitAvatarCache = new Map<string, string>()

/** 创建仓库时的表单字段（对齐 GitHub 新建仓库页） */
export interface CreateRepoInput {
  name: string
  description?: string
  private?: boolean
  homepage?: string
}

function mapRepo(data: any): GitHubRepo {
  const parent = data.parent || data.source
  return {
    name: data.name,
    fullName: data.full_name,
    url: data.clone_url,
    private: data.private,
    description: data.description,
    defaultBranch: data.default_branch || "main",
    updatedAt: data.updated_at,
    stargazersCount: data.stargazers_count || 0,
    fork: !!data.fork,
    parent: parent
      ? {
          fullName: parent.full_name,
          url: parent.clone_url,
          defaultBranch: parent.default_branch || "main",
        }
      : undefined,
  }
}

function encodeRepo(fullName: string): string {
  const normalized = String(fullName || "").trim()
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    throw new Error("GitHub 仓库名称无效")
  }
  return normalized.split("/").map(encodeURIComponent).join("/")
}

function mapActor(data: any) {
  return {
    login: String(data?.login || "unknown"),
    avatarUrl: String(data?.avatar_url || ""),
  }
}

function mapIssue(data: any): GitHubIssueItem {
  return {
    number: Number(data.number),
    title: String(data.title || ""),
    body: String(data.body || ""),
    state: data.state === "closed" ? "closed" : "open",
    author: mapActor(data.user),
    labels: Array.isArray(data.labels)
      ? data.labels.map((label: any) => ({
          name: String(label?.name || ""),
          color: String(label?.color || ""),
        })).filter((label: { name: string }) => label.name)
      : [],
    comments: Number(data.comments || 0),
    createdAt: String(data.created_at || ""),
    updatedAt: String(data.updated_at || ""),
    closedAt: data.closed_at ? String(data.closed_at) : null,
    htmlUrl: String(data.html_url || ""),
    isPullRequest: !!data.pull_request || (!!data.head && !!data.base),
    draft: !!data.draft,
    merged: !!data.merged_at,
  }
}

function mapComment(data: any): GitHubComment {
  return {
    id: Number(data.id),
    body: String(data.body || ""),
    author: mapActor(data.user),
    createdAt: String(data.created_at || ""),
    updatedAt: String(data.updated_at || ""),
    htmlUrl: String(data.html_url || ""),
  }
}

/** 带认证的 fetch 封装，自动注入 token 并处理错误 */
async function githubFetch(
  url: string,
  options?: { method?: string; body?: unknown }
): Promise<any> {
  const token = getToken()
  if (!token) {
    throw new Error("未配置 GitHub Token")
  }
  const method = options?.method || "GET"
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  let body: string | undefined
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(options.body)
  }
  const res = await fetch(url, {
    method,
    headers,
    body,
    timeout: 20,
    debugLabel: "gitgit GitHub API",
  })
  if (!res.ok) {
    // 解析 GitHub 返回的错误信息
    let msg = `HTTP ${res.status}`
    try {
      const err = await res.json()
      if (err.message) msg = err.message
      // 字段级错误更可读
      if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
        const details = err.errors
          .map((e: any) => e.message || `${e.resource}: ${e.code}`)
          .join("; ")
        if (details) msg = `${msg}（${details}）`
      }
    } catch (_e) {
      // 响应不是 JSON 时保留 HTTP 状态信息
    }
    throw new Error(`GitHub API 请求失败：${msg}`)
  }
  // 204 No Content
  if (res.status === 204) return null
  return await res.json()
}

async function ghFetch(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<any> {
  return await githubFetch(API_BASE + path, options)
}

function commitAvatarCacheKey(fullName: string, oid: string): string {
  return `${fullName.toLowerCase()}:${oid.toLowerCase()}`
}

/** 批量查询 GitHub 已关联账号的提交作者头像；未关联的提交不返回。 */
export async function getCommitAvatarUrls(
  fullName: string,
  oids: string[]
): Promise<GitHubCommitAvatarMap> {
  const encoded = encodeRepo(fullName)
  const [owner, name] = encoded.split("/").map(decodeURIComponent)
  const uniqueOids = Array.from(
    new Set(
      oids
        .map((oid) => oid.trim().toLowerCase())
        .filter((oid) => /^[0-9a-f]{40}$/.test(oid))
    )
  ).slice(0, 100)
  const result: GitHubCommitAvatarMap = {}
  const missing: string[] = []
  for (const oid of uniqueOids) {
    const cached = commitAvatarCache.get(commitAvatarCacheKey(fullName, oid))
    if (cached !== undefined) result[oid] = cached
    else missing.push(oid)
  }
  if (missing.length === 0) return result

  const fields = missing
    .map(
      (oid, index) =>
        `c${index}: object(expression: "${oid}") { ... on Commit { oid author { user { avatarUrl } } } }`
    )
    .join("\n")
  const query = `query CommitAvatars($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${fields}
    }
  }`
  const data = await githubFetch(GRAPHQL_URL, {
    method: "POST",
    body: { query, variables: { owner, name } },
  })
  const repository = data?.data?.repository
  if (!repository) {
    const message = Array.isArray(data?.errors)
      ? data.errors[0]?.message
      : "GraphQL 查询失败"
    throw new Error(`GitHub API 请求失败：${String(message || "仓库不可用")}`)
  }
  missing.forEach((oid, index) => {
    const avatarUrl = String(
      repository[`c${index}`]?.author?.user?.avatarUrl || ""
    )
    if (avatarUrl) {
      setLruEntry(
        commitAvatarCache,
        commitAvatarCacheKey(fullName, oid),
        avatarUrl,
        COMMIT_AVATAR_CACHE_LIMIT
      )
      result[oid] = avatarUrl
    }
  })
  return result
}

/** 获取当前认证用户信息 */
export async function getCurrentUser(): Promise<GitHubUser> {
  const data = await ghFetch("/user")
  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    publicRepos: data.public_repos,
    followers: data.followers,
  }
}

/** 获取当前用户的仓库列表（按更新时间倒序） */
export async function listMyRepos(
  perPage = 30,
  page = 1
): Promise<GitHubRepo[]> {
  const data = await ghFetch(
    `/user/repos?sort=updated&per_page=${perPage}&page=${page}`
  )
  return (data as any[]).map(mapRepo)
}

/** 获取仓库详情；fork 仓库包含 parent/source 信息 */
export async function getRepo(fullName: string): Promise<GitHubRepo> {
  return mapRepo(await ghFetch(`/repos/${encodeRepo(fullName)}`))
}

/** 在 GitHub 上为当前用户创建仓库 */
export async function createRepo(input: CreateRepoInput): Promise<GitHubRepo> {
  const name = input.name.trim()
  if (!name) throw new Error("仓库名称不能为空")
  // 对齐 GitHub：仅允许字母数字 . _ -，不能以 . 开头
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) {
    throw new Error("仓库名称仅允许字母、数字、.、_、-，且不能以 . 开头")
  }
  const data = await ghFetch("/user/repos", {
    method: "POST",
    body: {
      name,
      description: (input.description || "").trim() || undefined,
      homepage: (input.homepage || "").trim() || undefined,
      private: !!input.private,
      auto_init: false,
    },
  })
  return mapRepo(data)
}

/** 验证 token 是否有效（返回当前用户，无效则抛错） */
export async function verifyToken(): Promise<GitHubUser> {
  return await getCurrentUser()
}

export async function listIssuesOrPulls(
  fullName: string,
  kind: "issue" | "pr",
  state: GitHubIssueFilter = "open",
  page = 1,
  perPage = 30
): Promise<GitHubIssuePage> {
  const safePage = Math.max(1, Math.floor(page))
  const safePerPage = Math.min(100, Math.max(1, Math.floor(perPage)))
  encodeRepo(fullName)
  const qualifiers = [`repo:${fullName.trim()}`, `is:${kind}`]
  if (state !== "all") qualifiers.push(`state:${state}`)
  const query = encodeURIComponent(qualifiers.join(" "))
  const data = await ghFetch(
    `/search/issues?q=${query}&sort=updated&order=desc&per_page=${safePerPage}&page=${safePage}`
  )
  const items = Array.isArray(data.items) ? data.items.map(mapIssue) : []
  const total = Number(data.total_count || 0)
  return { items, hasMore: safePage * safePerPage < total }
}

export async function getIssueOrPull(
  fullName: string,
  number: number
): Promise<GitHubIssueItem> {
  const issue = await ghFetch(
    `/repos/${encodeRepo(fullName)}/issues/${Math.floor(number)}`
  )
  if (!issue.pull_request) return mapIssue(issue)
  return mapIssue(
    await ghFetch(`/repos/${encodeRepo(fullName)}/pulls/${Math.floor(number)}`)
  )
}

export async function listIssueComments(
  fullName: string,
  number: number
): Promise<GitHubComment[]> {
  const comments: GitHubComment[] = []
  let page = 1
  while (true) {
    const data = await ghFetch(
      `/repos/${encodeRepo(fullName)}/issues/${Math.floor(number)}/comments?per_page=100&page=${page}`
    )
    const batch = (data as any[]).map(mapComment)
    comments.push(...batch)
    if (batch.length < 100) return comments
    page += 1
  }
}

export async function createIssue(
  fullName: string,
  input: CreateGitHubIssueInput
): Promise<GitHubIssueItem> {
  const title = input.title.trim()
  if (!title) throw new Error("Issue 标题不能为空")
  return mapIssue(
    await ghFetch(`/repos/${encodeRepo(fullName)}/issues`, {
      method: "POST",
      body: {
        title,
        body: (input.body || "").trim() || undefined,
      },
    })
  )
}

// ===== GitHub Actions API =====

/** 将状态字符串映射为联合类型 */
function mapRunStatus(value: unknown): ActionRun["status"] {
  return value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "queued"
}

/** 将结论字符串映射为联合类型或 null */
function mapRunConclusion(value: unknown): ActionRun["conclusion"] {
  if (!value) return null
  const v = String(value)
  const valid = ["success", "failure", "cancelled", "neutral", "skipped", "timed_out", "action_required", "stale"]
  return (valid.includes(v) ? v : null) as ActionRun["conclusion"]
}

function mapRun(data: any): ActionRun {
  const sha = String(data.head_sha || "")
  return {
    id: Number(data.id),
    name: String(data.name || ""),
    workflowName: String(data.workflow_name || data.display_title || ""),
    headBranch: String(data.head_branch || ""),
    displayTitle: String(data.display_title || data.name || ""),
    status: mapRunStatus(data.status),
    conclusion: mapRunConclusion(data.conclusion),
    event: String(data.event || ""),
    actorLogin: String(data.actor?.login || ""),
    actorAvatarUrl: String(data.actor?.avatar_url || ""),
    createdAt: String(data.created_at || ""),
    updatedAt: String(data.updated_at || ""),
    htmlUrl: String(data.html_url || ""),
    headShaShort: sha.slice(0, 7),
    rerunnable: data.run_number !== undefined && data.status !== "in_progress",
  }
}

function mapJob(data: any): ActionJob {
  const steps = Array.isArray(data.steps)
    ? data.steps.map((s: any) => ({
        name: String(s.name || ""),
        status: mapRunStatus(s.status),
        conclusion: mapRunConclusion(s.conclusion),
        number: Number(s.number || 0),
        startedAt: String(s.started_at || ""),
        completedAt: String(s.completed_at || ""),
      }))
    : []
  // 从 check_run_url 中提取 check-run ID（用于获取注解）
  let checkRunId: number | undefined
  const checkRunUrl = String(data.check_run_url || "")
  const match = checkRunUrl.match(/\/check-runs\/(\d+)/)
  if (match) checkRunId = Number(match[1])
  return {
    id: Number(data.id),
    name: String(data.name || ""),
    status: mapRunStatus(data.status),
    conclusion: mapRunConclusion(data.conclusion),
    startedAt: String(data.started_at || ""),
    completedAt: String(data.completed_at || ""),
    steps,
    checkRunId,
  }
}

/** 列出仓库的工作流运行列表
 *  可选按工作流 ID 筛选。
 */
export async function listWorkflowRuns(
  fullName: string,
  page = 1,
  perPage = 30,
  workflowId?: number
): Promise<ActionRunPage> {
  const safePage = Math.max(1, Math.floor(page))
  const safePerPage = Math.min(100, Math.max(1, Math.floor(perPage)))
  // 按工作流 ID 筛选使用 /actions/workflows/{id}/runs 端点
  const basePath = workflowId
    ? `/repos/${encodeRepo(fullName)}/actions/workflows/${Math.floor(workflowId)}/runs`
    : `/repos/${encodeRepo(fullName)}/actions/runs`
  const data = await ghFetch(
    `${basePath}?per_page=${safePerPage}&page=${safePage}`
  )
  const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs.map(mapRun) : []
  const total = Number(data.total_count || 0)
  return { runs, hasMore: safePage * safePerPage < total }
}

/** 获取单个工作流运行详情 */
export async function getWorkflowRun(
  fullName: string,
  runId: number
): Promise<ActionRun> {
  return mapRun(
    await ghFetch(`/repos/${encodeRepo(fullName)}/actions/runs/${Math.floor(runId)}`)
  )
}

/** 获取工作流运行下的 Jobs 列表 */
export async function listWorkflowJobs(
  fullName: string,
  runId: number
): Promise<ActionJob[]> {
  const data = await ghFetch(
    `/repos/${encodeRepo(fullName)}/actions/runs/${Math.floor(runId)}/jobs`
  )
  return Array.isArray(data.jobs) ? data.jobs.map(mapJob) : []
}

/** 获取 Job 日志（纯文本） */
export async function getJobLog(
  fullName: string,
  jobId: number
): Promise<ActionJobLog> {
  // 日志端点返回 text/plain 且可能 302 重定向到下载链接
  const token = getToken()
  if (!token) throw new Error("未配置 GitHub Token")
  const url = `${API_BASE}/repos/${encodeRepo(fullName)}/actions/jobs/${Math.floor(jobId)}/logs`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    timeout: 20,
    debugLabel: "gitgit GitHub Actions log",
  })
  if (!res.ok) {
  if (res.status === 410) throw new Error("日志已过期或已被删除")
    throw new Error(`获取日志失败：HTTP ${res.status}`)
  }
  return await res.text()
}

/** 获取 Job 的注解列表（类似 GitHub 网页 Annotations 区域）
 *  需要传入 Job 的 checkRunId（从 mapJob 解析）。
 *  端点：GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations
 */
export async function getJobAnnotations(
  fullName: string,
  checkRunId: number
): Promise<ActionAnnotation[]> {
  const data = await ghFetch(
    `/repos/${encodeRepo(fullName)}/check-runs/${Math.floor(checkRunId)}/annotations`
  )
  if (!Array.isArray(data)) return []
  return data.map(mapAnnotation)
}

function mapAnnotation(data: any): ActionAnnotation {
  const level = String(data.annotation_level || "notice") as AnnotationLevel
  return {
    level: (level === "warning" || level === "failure") ? level : "notice",
    title: data.title ? String(data.title) : undefined,
    message: String(data.message || ""),
    path: data.path ? String(data.path) : undefined,
    startLine: data.start_line != null ? Number(data.start_line) : undefined,
    endLine: data.end_line != null ? Number(data.end_line) : undefined,
    rawDetails: data.raw_details ? String(data.raw_details) : undefined,
  }
}

function mapWorkflow(data: any): ActionWorkflow {
  return {
    id: Number(data.id),
    name: String(data.name || ""),
    displayName: String(data.display_name || data.name || ""),
    path: String(data.path || ""),
    state: String(data.state || "active"),
  }
}

/** 列出仓库的工作流定义（用于筛选与手动触发） */
export async function listWorkflows(
  fullName: string
): Promise<ActionWorkflow[]> {
  const data = await ghFetch(`/repos/${encodeRepo(fullName)}/actions/workflows?per_page=100`)
  return Array.isArray(data.workflows) ? data.workflows.map(mapWorkflow) : []
}

/** 手动触发工作流（workflow_dispatch）
 *  GitHub dispatch 端点使用工作流 ID（数字）。
 *  返回 true 表示触发成功（HTTP 204）。
 */
export async function dispatchWorkflow(
  fullName: string,
  workflowId: number,
  input: DispatchWorkflowInput
): Promise<boolean> {
  if (!input.ref.trim()) throw new Error("必须指定目标分支或标签")
  await ghFetch(
    `/repos/${encodeRepo(fullName)}/actions/workflows/${Math.floor(workflowId)}/dispatches`,
    {
      method: "POST",
      body: {
        ref: input.ref.trim(),
        inputs: input.inputs || undefined,
      },
    }
  )
  return true
}

function mapArtifact(data: any): ActionArtifact {
  return {
    id: Number(data.id),
    name: String(data.name || ""),
    sizeInBytes: Number(data.size_in_bytes || 0),
    archiveDownloadUrl: String(data.archive_download_url || ""),
    expired: !!data.expired,
    createdAt: String(data.created_at || ""),
    expiresAt: String(data.expires_at || ""),
  }
}

/** 列出工作流运行的工件 */
export async function listArtifacts(
  fullName: string,
  runId: number
): Promise<ActionArtifact[]> {
  const data = await ghFetch(
    `/repos/${encodeRepo(fullName)}/actions/runs/${Math.floor(runId)}/artifacts`
  )
  return Array.isArray(data.artifacts) ? data.artifacts.map(mapArtifact) : []
}

/** 获取工件下载 URL 和请求头（用于 BackgroundURLSession 下载） */
export function getArtifactDownloadInfo(
  fullName: string,
  artifactId: number
): { url: string; headers: Record<string, string> } {
  const token = getToken()
  if (!token) throw new Error("未配置 GitHub Token")
  return {
    url: `${API_BASE}/repos/${encodeRepo(fullName)}/actions/artifacts/${Math.floor(artifactId)}/zip`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }
}

/** 删除工作流运行 */
export async function deleteWorkflowRun(
  fullName: string,
  runId: number
): Promise<boolean> {
  await ghFetch(
    `/repos/${encodeRepo(fullName)}/actions/runs/${Math.floor(runId)}`,
    { method: "DELETE" }
  )
  return true
}
