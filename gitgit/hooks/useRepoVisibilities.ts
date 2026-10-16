/**
 * hooks/useRepoVisibilities.ts - 仓库列表行的公开/私有标识
 *
 * 公开/私有只能由 GitHub API 查询（/repos/{owner}/{repo} 的 private 字段），因此这里：
 * ① 会话级缓存已确认的结果，列表反复刷新不重复请求；
 * ② 限制并发逐行回填，列表先显示、标识随后出现，不阻塞状态扫描；
 * ③ 无 Token、非 GitHub 仓库与查询失败一律不显示标识（失败不写缓存，下次刷新可重试）。
 */

import { useEffect, useState } from "scripting"
import type { GitHubRepoVisibility } from "../types/github"
import { getRepoVisibility } from "../api/githubApi"
import { getToken } from "../services/authStore"

/** 同时查询的仓库数量上限，避免一次打出整页请求 */
const CONCURRENCY = 3

/** owner/repo（小写）-> 已确认的可见性 */
const cache = new Map<string, GitHubRepoVisibility>()

export interface RepoVisibilityTarget {
  /** 列表行主键（bookmarkName） */
  key: string
  /** 由远端地址解析出的 GitHub 仓库 owner/repo，非 GitHub 仓库为 null */
  fullName: string | null
}

/**
 * 查询列表内各仓库的可见性。
 * @returns bookmarkName -> 可见性，只包含已确认的 GitHub 仓库
 */
export function useRepoVisibilities(
  targets: RepoVisibilityTarget[]
): Record<string, GitHubRepoVisibility> {
  // 结果异步逐个回来，用版本号触发按缓存重算
  const [, setVersion] = useState(0)
  // 以签名而不是数组本身作为依赖，避免每次渲染都重新触发
  const signature = targets
    .map((target) => `${target.key}#${target.fullName ?? ""}`)
    .join("|")

  useEffect(() => {
    if (!getToken()) return
    const pending: { key: string; fullName: string }[] = []
    const seen = new Set<string>()
    for (const target of targets) {
      const fullName = target.fullName?.toLowerCase()
      if (!fullName || seen.has(fullName) || cache.has(fullName)) continue
      seen.add(fullName)
      pending.push({ key: target.key, fullName })
    }
    if (pending.length === 0) return

    let stopped = false
    let cursor = 0

    async function worker() {
      while (!stopped) {
        const target = pending[cursor++]
        if (!target) return
        try {
          cache.set(target.fullName, await getRepoVisibility(target.fullName))
        } catch (_e) {
          // 权限不足、仓库不存在或网络抖动都只影响这一行，其它行继续
        }
        setVersion((version) => version + 1)
      }
    }

    for (let i = 0; i < Math.min(CONCURRENCY, pending.length); i++) worker()
    // 列表变化或页面卸载后不再取新任务，已在途请求的结果仍然进缓存
    return () => {
      stopped = true
    }
  }, [signature])

  const visibilities: Record<string, GitHubRepoVisibility> = {}
  for (const target of targets) {
    const cached = target.fullName ? cache.get(target.fullName.toLowerCase()) : undefined
    if (cached) visibilities[target.key] = cached
  }
  return visibilities
}
