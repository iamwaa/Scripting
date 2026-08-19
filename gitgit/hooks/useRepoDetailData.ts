/**
 * hooks/useRepoDetailData.ts - 仓库详情页数据加载与状态
 *
 * 集中管理详情页的仓库状态（改动 / Stash / 历史 / 文件 / 分支 / 远端 / 合并态）与
 * 各自的加载函数。首屏只解析 HEAD，Stash、文件、历史首次切 Tab 才加载（P2.47）。
 */

import { useState } from "scripting"
import type {
  BranchInfo,
  CommitEntry,
  FileChange,
  RepoMeta,
  StashEntry,
} from "../types/git"
import {
  getBranchUpstream,
  getChanges,
  getLogPage,
  getManagedBranches,
  getMergeConflictState,
  getRepoListStatus,
  getTrackedFiles,
  hasHeadCommit,
  initRepo,
  isInitialized,
  listRemotes,
  listStashes,
} from "../services/gitService"
import { findRepo, getBranchLastPulledAt } from "../services/repoStore"
import { relativeTime } from "../utils/format"
import { githubRepoFromRemoteUrl } from "../utils/github"
import type { UpstreamConfig } from "../utils/remote"
import type { ToastType } from "./useToast"

const HISTORY_PAGE_SIZE = 50

/** 0 改动 / 1 Stash / 2 文件 / 3 历史 */
export type RepoDetailTabIndex = 0 | 1 | 2 | 3

type UseRepoDetailDataProps = {
  bookmarkName: string
  name: string
  showToast: (message: string, type?: ToastType, duration?: number) => void
}

export function useRepoDetailData({
  bookmarkName,
  name,
  showToast,
}: UseRepoDetailDataProps) {
  const [tab, setTab] = useState<RepoDetailTabIndex>(0)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [log, setLog] = useState<CommitEntry[]>([])
  const [hasCommits, setHasCommits] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyTotalMatches, setHistoryTotalMatches] = useState<number | null>(null)
  const [historySearchBusy, setHistorySearchBusy] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLimited, setHistoryLimited] = useState(false)
  const [trackedFiles, setTrackedFiles] = useState<string[]>([])
  const [branchInfo, setBranchInfo] = useState<BranchInfo>({
    branches: [],
    current: null,
  })
  // 仅远端存在（本地无同名）的分支短名，用于分支列表标签与删除路由
  const [remoteOnlyBranches, setRemoteOnlyBranches] = useState<string[]>([])
  // 全部 origin 分支名：Picker 标签按「远端是否存在」显示 本地/远端
  const [remoteBranchNames, setRemoteBranchNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Stash、文件与历史 Tab 首次进入时再加载
  const [stashesLoaded, setStashesLoaded] = useState(false)
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [hasRemote, setHasRemote] = useState(false)
  const [upstream, setUpstream] = useState<UpstreamConfig | null>(null)
  const [lastPulledAt, setLastPulledAt] = useState<number | null>(null)
  const [repoSource, setRepoSource] = useState<RepoMeta["source"]>("local")
  const [displayName, setDisplayName] = useState(name)
  const [githubFullName, setGithubFullName] = useState<string | null>(null)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)

  function refreshMeta(branch = branchInfo.current) {
    const meta = findRepo(bookmarkName)
    if (!meta) return
    setLastPulledAt(getBranchLastPulledAt(meta, branch))
    setRepoSource(meta.source || "local")
    setDisplayName(meta.name || name)
  }

  async function loadChanges(): Promise<FileChange[]> {
    const c = await getChanges(bookmarkName)
    setChanges(c)
    return c
  }

  async function refreshChangesAndSnapshot(): Promise<FileChange[]> {
    const currentChanges = await loadChanges()
    await getRepoListStatus(bookmarkName, currentChanges.length)
    return currentChanges
  }

  async function loadStashes() {
    const entries = await listStashes(bookmarkName)
    setStashes(entries)
    setStashesLoaded(true)
  }

  async function loadTrackedFiles() {
    const files = await getTrackedFiles(bookmarkName)
    setTrackedFiles(files)
    setFilesLoaded(true)
  }

  async function loadLog(reset = true, query = historyQuery) {
    const normalizedQuery = reset ? query : historyQuery
    const offset = reset ? 0 : log.length
    const page = await getLogPage(
      bookmarkName,
      offset,
      HISTORY_PAGE_SIZE,
      normalizedQuery
    )
    setLog((previous) => {
      if (reset) return page.entries
      const seen = new Set(previous.map((entry) => entry.oid))
      return previous.concat(page.entries.filter((entry) => !seen.has(entry.oid)))
    })
    setHistoryHasMore(page.hasMore)
    setHistoryTotalMatches(page.totalMatches)
    setHistoryLimited(!!page.limited)
    setHistoryLoaded(true)
    setHistoryQuery(normalizedQuery)
    if (reset && normalizedQuery.trim().length === 0) {
      setHasCommits(await hasHeadCommit(bookmarkName))
    }
  }

  async function refreshHistoryIfLoaded() {
    if (historyLoaded || tab === 3) await loadLog()
  }

  async function loadBranches() {
    const b = await getManagedBranches(bookmarkName)
    setBranchInfo({ branches: [...b.locals, ...b.remotes], current: b.current })
    setRemoteOnlyBranches(b.remotes)
    setRemoteBranchNames(b.remoteNames)
    refreshMeta(b.current)
  }

  async function loadRemote() {
    try {
      const remotes = await listRemotes(bookmarkName)
      setHasRemote(remotes.length > 0)
      const origin = remotes.find((remote) => remote.remote === "origin")
      setGithubFullName(githubRepoFromRemoteUrl(origin?.url))
    } catch (_e) {
      setHasRemote(false)
      setGithubFullName(null)
    }
  }

  async function loadUpstream() {
    try {
      setUpstream(await getBranchUpstream(bookmarkName))
    } catch (_e) {
      setUpstream(null)
    }
  }

  async function loadMergeState() {
    try {
      const merge = await getMergeConflictState(bookmarkName)
      if (merge) {
        setMergeInProgress(true)
        setConflictCount(merge.conflicts.length)
      } else {
        setMergeInProgress(false)
        setConflictCount(0)
      }
    } catch (_e) {
      setMergeInProgress(false)
      setConflictCount(0)
    }
  }

  async function loadAll() {
    refreshMeta()
    setLoading(true)
    // 全量刷新时重置懒加载标记
    setStashesLoaded(false)
    setFilesLoaded(false)
    setHistoryLoaded(false)
    setHistoryLimited(false)
    try {
      if (!(await isInitialized(bookmarkName))) {
        await initRepo(bookmarkName)
      }
      // 首屏只解析 HEAD，不读取提交列表；Stash、文件、历史按 Tab 懒加载
      const [currentChanges, headExists] = await Promise.all([
        loadChanges(),
        hasHeadCommit(bookmarkName),
        loadBranches(),
        loadRemote(),
        loadUpstream(),
        loadMergeState(),
      ])
      setHasCommits(headExists)
      // 若当前已在懒加载 Tab，补数据
      if (tab === 1) await loadStashes()
      if (tab === 2) await loadTrackedFiles()
      if (tab === 3) await loadLog()
      await getRepoListStatus(bookmarkName, currentChanges.length)
    } catch (e: any) {
      showToast("加载失败：" + String(e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  async function handleTabChange(next: number) {
    const target = next as RepoDetailTabIndex
    setTab(target)
    if (target === 1 && !stashesLoaded) {
      setLoading(true)
      try {
        await loadStashes()
      } catch (e: any) {
        showToast("加载失败：" + String(e?.message || e), "error")
      } finally {
        setLoading(false)
      }
      return
    }
    if (target === 2 && !filesLoaded) {
      setLoading(true)
      try {
        await loadTrackedFiles()
      } catch (e: any) {
        showToast("加载失败：" + String(e?.message || e), "error")
      } finally {
        setLoading(false)
      }
      return
    }
    if (target === 3 && !historyLoaded && !historyLoading) {
      setHistoryLoading(true)
      try {
        await loadLog()
      } catch (e: any) {
        showToast("加载历史失败：" + String(e?.message || e), "error")
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  async function handleHistorySearch(query: string) {
    setHistorySearchBusy(true)
    try {
      await loadLog(true, query)
    } catch (e: any) {
      showToast("搜索失败：" + String(e?.message || e), "error")
    } finally {
      setHistorySearchBusy(false)
    }
  }

  async function handleHistoryLoadMore() {
    if (!historyHasMore || historySearchBusy) return
    setHistorySearchBusy(true)
    try {
      await loadLog(false)
    } catch (e: any) {
      showToast("加载历史失败：" + String(e?.message || e), "error")
    } finally {
      setHistorySearchBusy(false)
    }
  }

  // 同步操作结束后的轻量刷新：不重扫工作区全树
  async function refreshSyncState() {
    await Promise.all([
      refreshHistoryIfLoaded(),
      loadBranches(),
      loadRemote(),
      loadMergeState(),
    ])
  }

  // 远端配置变更后刷新远端、分支与 upstream
  async function refreshRemoteConfig() {
    await Promise.all([loadRemote(), loadBranches(), loadUpstream()])
    refreshMeta()
  }

  const pulledLabel = lastPulledAt
    ? relativeTime(new Date(lastPulledAt).toISOString())
    : "尚未拉取"

  const currentBranch = branchInfo.current || ""
  // 可合并源：排除当前分支及其 origin/同名（自合并）
  const mergeSources = branchInfo.branches.filter(
    (b) => b !== currentBranch && b !== `origin/${currentBranch}`
  )
  // 可删除分支：所有非当前分支（当前分支不可删，需先切走）
  const deletableBranches = branchInfo.branches.filter((b) => b !== currentBranch)

  return {
    tab,
    changes,
    stashes,
    log,
    hasCommits,
    historyHasMore,
    historyTotalMatches,
    historySearchBusy,
    historyLoading,
    historyLimited,
    trackedFiles,
    branchInfo,
    remoteOnlyBranches,
    remoteBranchNames,
    mergeSources,
    deletableBranches,
    loading,
    hasRemote,
    upstream,
    pulledLabel,
    repoSource,
    displayName,
    githubFullName,
    mergeInProgress,
    conflictCount,
    setChanges,
    setDisplayName,
    setRepoSource,
    setHasRemote,
    setLastPulledAt,
    loadAll,
    loadChanges,
    refreshChangesAndSnapshot,
    loadStashes,
    loadTrackedFiles,
    loadLog,
    loadBranches,
    loadRemote,
    loadUpstream,
    loadMergeState,
    refreshHistoryIfLoaded,
    refreshSyncState,
    refreshRemoteConfig,
    handleTabChange,
    handleHistorySearch,
    handleHistoryLoadMore,
  }
}
