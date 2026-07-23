/**
 * api/githubApi.ts - GitHub REST API 客户端
 *
 * 用于获取当前用户信息、仓库列表、创建远端仓库。
 * 认证：Bearer token（来自 authStore）。
 */

import { getToken } from "../services/authStore"
import type { GitHubUser, GitHubRepo } from "../types/git"

const API_BASE = "https://api.github.com"

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

/** 带认证的 fetch 封装，自动注入 token 并处理错误 */
async function ghFetch(
  path: string,
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
  const res = await fetch(API_BASE + path, {
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
  const normalized = String(fullName || "").trim()
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    throw new Error("GitHub 仓库名称无效")
  }
  return mapRepo(await ghFetch(`/repos/${normalized}`))
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

/** 验证 token 是否有效（返回用户名，无效则抛错） */
export async function verifyToken(): Promise<string> {
  const user = await getCurrentUser()
  return user.login
}
