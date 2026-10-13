/**
 * hooks/useRunArtifactCounts.ts - 工作流运行的工件数量
 *
 * 运行列表接口不返回工件信息（GraphQL 也没有工件字段），只能按运行逐个查
 * /repos/{owner}/{repo}/actions/runs/{id}/artifacts。因此这里：
 * ① 会话级缓存，翻页、返回列表页时复用，不重复请求；
 * ② 限制并发并逐行回填，行先显示、工件标识随后出现，不阻塞列表加载。
 */

import { useEffect, useState } from "scripting"
import type { ActionRun } from "../types/github"
import { countRunArtifacts } from "../api/githubApi"

/** 同时查询的工件数量上限，避免一次打出整页请求 */
const CONCURRENCY = 4

/** 运行 -> 工件数量；-1 表示查询失败，本次会话不再重试 */
const cache = new Map<string, number>()

function cacheKey(fullName: string, runId: number): string {
  return `${fullName.toLowerCase()}#${runId}`
}

/**
 * 查询列表内各运行的工件数量。
 * @returns runId -> 工件数量，只包含已确认有工件的运行（0 与未查询都不出现）
 */
export function useRunArtifactCounts(
  fullName: string,
  runs: ActionRun[]
): Record<number, number> {
  // 结果异步逐个回来，用版本号触发按缓存重算
  const [, setVersion] = useState(0)

  useEffect(() => {
    // 排队中的运行还没有 Job，不可能产出工件
    const targets = runs.filter(
      (run) => run.status !== "queued" && !cache.has(cacheKey(fullName, run.id))
    )
    if (targets.length === 0) return

    let stopped = false
    let cursor = 0

    async function worker() {
      while (!stopped) {
        const run = targets[cursor++]
        if (!run) return
        try {
          cache.set(cacheKey(fullName, run.id), await countRunArtifacts(fullName, run.id))
        } catch (_e) {
          // 无 Token、无权限、网络抖动都只影响这一行，其它行继续
          cache.set(cacheKey(fullName, run.id), -1)
        }
        setVersion((v) => v + 1)
      }
    }

    for (let i = 0; i < Math.min(CONCURRENCY, targets.length); i++) worker()
    // 列表变化或页面卸载后不再取新任务，已在途的请求结果仍然进缓存
    return () => {
      stopped = true
    }
  }, [fullName, runs])

  const counts: Record<number, number> = {}
  for (const run of runs) {
    const cached = cache.get(cacheKey(fullName, run.id))
    if (cached != null && cached > 0) counts[run.id] = cached
  }
  return counts
}
