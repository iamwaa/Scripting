import { Widget } from "scripting"
import type { RepoListStatus } from "../../types/git"
import { measureOperation } from "../../utils/performance"
import { findRepo, writeSnapshot } from "../repoStore"
import { getMergeConflictState } from "./mergeConflictService"
import { getRepoListStatusInternal } from "./repoStatusService"
import {
  cacheRepoStatus,
  canPublishStatus,
  getCachedRepoStatus,
  runStatusRead,
  statusRevision,
  validatedChangesCount,
  type StatusReadOptions,
} from "./statusScanService"

async function persistRepoSnapshot(bookmarkName: string, status: RepoListStatus): Promise<void> {
  const repo = findRepo(bookmarkName)
  if (!repo || status.error || !status.workdirOk) return
  try {
    await writeSnapshot(bookmarkName, {
      name: repo.name,
      branch: status.branch,
      uncommitted: status.uncommitted,
      ahead: status.ahead,
      behind: status.behind,
      updatedAt: Date.now(),
    })
    Widget.reloadAll()
  } catch (error) {
    console.warn("⚠️ 仓库快照写入失败: " + error)
  }
}

export function getRepoListStatus(
  bookmarkName: string,
  knownUncommitted?: number,
  options: StatusReadOptions = {}
): Promise<RepoListStatus> {
  return runStatusRead(bookmarkName, async () => {
    // 只有列表自动刷新主动选择使用新鲜缓存，其他原有调用仍默认实时读取。
    if (options.force === false && knownUncommitted == null) {
      const cached = getCachedRepoStatus(bookmarkName, true)
      if (cached) return cached
    }
    const revision = statusRevision(bookmarkName)
    const repoName = findRepo(bookmarkName)?.name || bookmarkName
    const source = options.source || "状态查询"
    const status = await measureOperation(
      "读取仓库完整状态",
      () => getRepoListStatusInternal(
        bookmarkName, getMergeConflictState,
        validatedChangesCount(bookmarkName, knownUncommitted), source
      ),
      `${repoName} · ${source}`
    )
    if (canPublishStatus(bookmarkName, revision)) {
      cacheRepoStatus(bookmarkName, status, revision)
      await persistRepoSnapshot(bookmarkName, status)
    }
    return status
  })
}
