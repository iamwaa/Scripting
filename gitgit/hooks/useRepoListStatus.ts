import { useEffect, useRef, useState } from "scripting"
import type { RepoListStatus, RepoMeta, RepoSnapshot } from "../types/git"
import { listRepos, readSnapshots } from "../services/repoStore"
import { getCachedRepoStatus, getRepoListStatus } from "../services/gitService"
import { sortReposForList } from "../utils/repoSort"

function cachedStatuses(repos: RepoMeta[]): Record<string, RepoListStatus> {
  const result: Record<string, RepoListStatus> = {}
  for (const repo of repos) {
    const cached = getCachedRepoStatus(repo.bookmarkName)
    if (cached) result[repo.bookmarkName] = cached
  }
  return result
}

export function useRepoListStatus(setRepos: (repos: RepoMeta[]) => void) {
  const [statusMap, setStatusMap] = useState<Record<string, RepoListStatus>>(
    cachedStatuses(listRepos())
  )
  const [snapshotMap, setSnapshotMap] = useState<Record<string, RepoSnapshot>>({})
  const state = useRef({
    active: false, epoch: 0, rerun: false, forceNext: false, forcing: false,
    pending: null as Promise<void> | null,
  })

  function stop() {
    state.current.active = false
    state.current.epoch++
    state.current.rerun = false
    // 离开时停止启动后续扫描，但保留未完成的下拉意图供返回后续跑。
    state.current.forceNext ||= state.current.forcing
  }

  useEffect(() => stop, [])

  async function refreshRound(force: boolean) {
    const epoch = state.current.epoch
    const current = () => state.current.active && state.current.epoch === epoch
    const latest = listRepos()
    setRepos(latest)
    // 从详情读到的新状态直接发布，不因 Widget 时间戳变化重扫其它仓库。
    const statuses = cachedStatuses(latest)
    setStatusMap(statuses)
    let snapshots: Record<string, RepoSnapshot> = {}
    try {
      snapshots = await readSnapshots()
      if (current()) setSnapshotMap(snapshots)
    } catch (_e) {
      // 快照仅用于无实时结果时的排序与占位，不参与新鲜期。
    }
    for (const repo of sortReposForList(latest, statuses, snapshots)) {
      if (!current()) break
      if (!listRepos().some((item) => item.bookmarkName === repo.bookmarkName)) continue
      const status = await getRepoListStatus(repo.bookmarkName, undefined, {
        source: force ? "列表下拉" : "列表出现", force,
      })
      if (!current()) break
      if (!listRepos().some((item) => item.bookmarkName === repo.bookmarkName)) continue
      setStatusMap((previous) => ({ ...previous, [repo.bookmarkName]: status }))
    }
  }

  function refreshAll(force = false): Promise<void> {
    if (!state.current.active) return Promise.resolve()
    if (state.current.pending) {
      if (force) {
        state.current.forceNext = true
        state.current.rerun = true
      }
      return state.current.pending
    }
    const pending = (async () => {
      try {
        let nextForce = force || state.current.forceNext
        do {
          state.current.rerun = false
          state.current.forceNext = false
          state.current.forcing = nextForce
          await refreshRound(nextForce)
          nextForce = state.current.forceNext
        } while (state.current.active && state.current.rerun)
      } finally {
        // 与循环退出同步释放，保留隐藏页面时暂存的强刷意图。
        state.current.forcing = false
        state.current.pending = null
      }
    })()
    state.current.pending = pending
    return pending
  }

  function appear() {
    const wasHidden = !state.current.active
    state.current.active = true
    if (wasHidden && state.current.pending) state.current.rerun = true
    refreshAll().catch((error) => console.warn("仓库列表刷新失败: " + error))
  }

  function refreshRepo(repo: RepoMeta) {
    // 新增只扫描新增项，不因仓库集合变化重扫其它仓库。
    getRepoListStatus(repo.bookmarkName, undefined, {
      source: "列表新增", force: true,
    }).then((status) => {
      if (state.current.active && listRepos().some((item) => item.bookmarkName === repo.bookmarkName)) {
        setStatusMap((previous) => ({ ...previous, [repo.bookmarkName]: status }))
      }
    }).catch((error) => console.warn("新增仓库状态刷新失败: " + error))
  }

  function forgetRepo(bookmarkName: string) {
    setStatusMap((previous) => {
      const next = { ...previous }
      delete next[bookmarkName]
      return next
    })
  }

  return { statusMap, snapshotMap, refreshAll, refreshRepo, forgetRepo, appear, disappear: stop }
}
