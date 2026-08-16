/**
 * pages/RepoDetailPage.tsx - 仓库详情页
 *
 * 改动 / 历史 Tab；本地仓库可上传 GitHub；历史支持复制/撤销/回退/重编。
 */

import {
  List,
  Text,
  Button,
  HStack,
  Menu,
  useRef,
  useState,
} from "scripting"
import { BusyOverlay } from "../components/BusyOverlay"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import { RepoBranchSection } from "../components/RepoBranchSection"
import { RepoRemoteSections } from "../components/RepoRemoteSections"
import {
  MergeConflictSection,
  RepoDetailTabContent,
  type RepoDetailTab,
} from "../components/RepoDetailContent"
import { RepoDetailDestination } from "../components/RepoDetailDestination"
import { CommitMessageSheet } from "../components/CommitMessageSheet"
import type {
  FileChange,
  CommitEntry,
  BranchInfo,
  RepoMeta,
  StashEntry,
} from "../types/git"
import {
  isInitialized,
  initRepo,
  getChanges,
  getRepoListStatus,
  addFiles,
  stageAll,
  unstageAll,
  listStashes,
  createStash,
  applyStash,
  dropStash,
  commit,
  getLogPage,
  hasHeadCommit,
  getTrackedFiles,
  getManagedBranches,
  deleteBranch,
  deleteRemoteBranch,
  restoreFile,
  fetchRemote,
  pull,
  getMergeConflictState,
  listRemotes,
  getBranchUpstream,
  revertCommit,
  softResetHead,
  amendHeadCommit,
  resetToCommitAndForcePush,
  isRemoteOperationCancelled,
  RemoteCancelToken,
} from "../services/gitService"
import { useRepoBranchActions } from "../hooks/useRepoBranchActions"
import { useRepoSyncActions } from "../hooks/useRepoSyncActions"
import { yieldForUi } from "../utils/remoteProgress"
import {
  findRepo,
  getBranchLastPulledAt,
  updateBranchLastPulledAt,
} from "../services/repoStore"
import { notifySync } from "../services/notifyService"
import {
  shortOid,
  buildCommitMessage,
  relativeTime,
  commitTitle,
  commitBody,
  suggestCommitTitle,
} from "../utils/format"
import { getRepoPendingAlert, type RepoPendingAction } from "../utils/repoDetailAlerts"
import type { UpstreamConfig } from "../utils/remote"
import { DEFAULT_BRANCH } from "../constants/git"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"
import { githubRepoFromRemoteUrl } from "../utils/github"

const HISTORY_PAGE_SIZE = 50

type AlertState = {
  title: string
  message: string
} | null

type PendingAction = RepoPendingAction

export function RepoDetailPage({
  bookmarkName,
  name,
}: {
  bookmarkName: string
  name: string
}) {
  const [tab, setTab] = useState<RepoDetailTab>(0)
  const skipNextAppearLoadRef = useRef(false)
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
  // Stash、文件与历史 Tab 首次进入时再加载。
  const [stashesLoaded, setStashesLoaded] = useState(false)
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [stagingBusy, setStagingBusy] = useState(false)
  const [stashBusy, setStashBusy] = useState(false)
  const [hasRemote, setHasRemote] = useState(false)
  const [upstream, setUpstream] = useState<UpstreamConfig | null>(null)
  const [lastPulledAt, setLastPulledAt] = useState<number | null>(null)
  const [repoSource, setRepoSource] = useState<RepoMeta["source"]>("local")
  const [displayName, setDisplayName] = useState(name)
  const [showUpload, setShowUpload] = useState(false)
  const [showRemotes, setShowRemotes] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showRollback, setShowRollback] = useState(false)
  const [githubFullName, setGithubFullName] = useState<string | null>(null)
  const [showGitHubWork, setShowGitHubWork] = useState(false)
  const [githubWorkKind, setGithubWorkKind] = useState<number>(0)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>(null)
  const { toastState, showToast, dismissToast, handleToastChanged, toastPresented } = useToast()
  const [pending, setPending] = useState<PendingAction>(null)
  const [amendMessage, setAmendMessage] = useState("")
  // 普通提交与重编共用同一个半屏表单
  const [commitSheetMode, setCommitSheetMode] = useState<
    "commit" | "amend" | null
  >(null)
  // 打开重编表单时的初始草稿，由 sheet 内部 Observable 接管后续编辑
  const [amendDraft, setAmendDraft] = useState({ title: "", description: "" })
  // 仓库级操作忙态（中央全屏遮罩）：撤销/回退/重编/分支操作/合并/推送/拉取等
  // onCancel 存在时遮罩带取消按钮；cancelling 后副标题冻结为「取消中…」
  const [opBusy, setOpBusy] = useState<{
    title: string
    message?: string
    onCancel?: () => void
    cancelling?: boolean
  } | null>(null)

  function showAlert(title: string, message: string) {
    setAlertState({ title, message })
  }

  function refreshMeta(branch = branchInfo.current) {
    const meta = findRepo(bookmarkName)
    if (!meta) return
    setLastPulledAt(getBranchLastPulledAt(meta, branch))
    setRepoSource(meta.source || "local")
    setDisplayName(meta.name || name)
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
      // 首屏只解析 HEAD，不读取提交列表；Stash、文件、历史按 Tab 懒加载。
      const [currentChanges, headExists] = await Promise.all([
        loadChanges(),
        hasHeadCommit(bookmarkName),
        loadBranches(),
        loadRemote(),
        loadUpstream(),
        loadMergeState(),
      ])
      setHasCommits(headExists)
      // 若当前已在懒加载 Tab，补数据。
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

  async function loadTrackedFiles() {
    const files = await getTrackedFiles(bookmarkName)
    setTrackedFiles(files)
    setFilesLoaded(true)
  }

  async function handleTabChange(next: number) {
    const target = next as RepoDetailTab
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

  function openConflictsPage() {
    setSelectedCommitOid(null)
    setShowUpload(false)
    setShowRemotes(false)
    setShowGitHubWork(false)
    setShowConflicts(true)
  }

  function openGitHubWorkPage(kind: number = 0) {
    skipNextAppearLoadRef.current = true
    setSelectedCommitOid(null)
    setShowUpload(false)
    setShowRemotes(false)
    setShowConflicts(false)
    setShowCompare(false)
    setGithubWorkKind(kind)
    setShowGitHubWork(true)
  }



  // 请求删除分支：本地分支与仅远端分支分别确认
  function requestDeleteBranch(branch: string) {
    if (remoteOnlyBranches.includes(branch)) {
      setPending({ type: "deleteRemoteBranch", branch })
    } else {
      setPending({ type: "deleteLocalBranch", branch })
    }
  }


  async function handleStage(filepath: string) {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await addFiles(bookmarkName, filepath)
      await refreshChangesAndSnapshot()
    } catch (e: any) {
      showToast(`暂存失败：${String(e?.message || e)}`, "error")
    } finally {
      setStagingBusy(false)
    }
  }

  async function handleStageAll() {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await stageAll(bookmarkName)
      await refreshChangesAndSnapshot()
    } catch (e: any) {
      showToast(`全部暂存失败：${String(e?.message || e)}`, "error")
    } finally {
      setStagingBusy(false)
    }
  }

  async function handleUnstageAll() {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await unstageAll(bookmarkName)
      await refreshChangesAndSnapshot()
    } catch (e: any) {
      showToast(`全部取消暂存失败：${String(e?.message || e)}`, "error")
    } finally {
      setStagingBusy(false)
    }
  }

  async function handleCreateStash() {
    if (stashBusy || stagingBusy || changes.length === 0) return
    try {
      const message = await Dialog.prompt({
        title: "保存到 Stash",
        message: "可填写备注，留空将使用默认说明",
        defaultValue: "",
        cancelLabel: "取消",
        confirmLabel: "保存",
      })
      if (message == null) return
      setStashBusy(true)
      await createStash(bookmarkName, message)
      await Promise.all([loadChanges(), loadStashes()])
      showToast("已保存到 Stash：" + (message.trim() || "当前改动已保存"), "success")
    } catch (e: any) {
      showToast("保存 Stash 失败：" + String(e?.message || e), "error")
    } finally {
      setStashBusy(false)
    }
  }

  async function handleApplyStash(entry: StashEntry) {
    if (stashBusy || stagingBusy) return
    setStashBusy(true)
    try {
      await applyStash(bookmarkName, entry.index)
      await Promise.all([loadChanges(), loadStashes()])
      showToast("Stash 已应用：" + entry.message + "已恢复", "success")
    } catch (e: any) {
      try {
        await Promise.all([loadChanges(), loadStashes()])
      } catch (_refreshError) {
        /* 保留原错误提示 */
      }
      showToast("应用 Stash 失败：" + String(e?.message || e), "error")
    } finally {
      setStashBusy(false)
    }
  }

  function handleDropStash(entry: StashEntry) {
    if (stashBusy || stagingBusy) return
    setPending({ type: "dropStash", entry })
  }

  function handleRestore(filepath: string) {
    if (stagingBusy || stashBusy) return
    setPending({ type: "restore", filepath })
  }

  function handleOpenCommitForm() {
    setCommitSheetMode("commit")
  }

  async function handleCommit(titleText: string, descriptionText: string) {
    const title = titleText.trim()
    if (!title) {
      showToast("请填写提交信息（标题）", "warning")
      return
    }
    if (!changes.some((change) => change.staged)) {
      showToast("没有暂存内容，请先暂存要提交的文件", "warning")
      return
    }
    setCommitSheetMode(null)
    setCommitting(true)
    try {
      await beginOpBusy("正在提交")
      const msg = buildCommitMessage(title, descriptionText)
      const oid = await commit(bookmarkName, msg)
      // 先清空改动，避免 loadAll 完成前按钮仍显示「取消暂存」
      setChanges([])
      await loadAll()
      await notifySync("commit", displayName, shortOid(oid))
      showToast("提交成功：" + shortOid(oid), "success")
    } catch (e: any) {
      showToast("提交失败：" + String(e?.message || e), "error")
    } finally {
      setCommitting(false)
      setOpBusy(null)
    }
  }

  // === 历史操作 ===

  async function handleCopyCommit(entry: CommitEntry) {
    try {
      // 只复制完整 oid，不要其它信息
      await Pasteboard.setString(entry.oid)
      showToast("已复制：" + shortOid(entry.oid), "success")
    } catch (e: any) {
      showToast("复制失败：" + String(e?.message || e), "error")
    }
  }

  function handleRollbackSelect(entry: CommitEntry) {
    const branch = branchInfo.current
    if (!branch) {
      showToast("当前没有命名分支，无法回滚", "error")
      return
    }
    // 关闭选择页，再弹确认
    setShowRollback(false)
    setTimeout(() => setPending({ type: "rollback", entry, branch }), 350)
  }

  function handleRevertRequest(entry: CommitEntry) {
    setPending({ type: "revert", entry })
  }

  function handleSoftResetRequest(entry: CommitEntry) {
    setPending({ type: "softReset", entry })
  }

  function handleAmendRequest(entry: CommitEntry) {
    setAmendDraft({
      title: commitTitle(entry.message),
      description: commitBody(entry.message),
    })
    setCommitSheetMode("amend")
  }

  function handleAmendFormConfirm(titleText: string, descriptionText: string) {
    const title = titleText.trim()
    if (!title) {
      showToast("提交信息不能为空", "warning")
      return
    }
    setAmendMessage(buildCommitMessage(title, descriptionText))
    setCommitSheetMode(null)
    // 等 sheet 收起后再弹确认，避免模态叠加导致 alert 不显示
    setTimeout(() => setPending({ type: "amend" }), 350)
  }

  // 设置操作忙态遮罩，并让出一帧以便遮罩先渲染；传 onCancel 则遮罩带取消按钮
  async function beginOpBusy(
    title: string,
    message?: string,
    onCancel?: () => void
  ) {
    setOpBusy({ title, message, onCancel })
    await yieldForUi()
  }

  // 更新遮罩标题/副标题；保留取消按钮，已请求取消后冻结副标题为「取消中…」
  async function updateOpBusy(title: string, message?: string) {
    setOpBusy((cur) => ({
      title,
      message: cur?.cancelling ? cur.message : message,
      onCancel: cur?.onCancel,
      cancelling: cur?.cancelling,
    }))
    await yieldForUi()
  }

  // 推送/拉取的遮罩取消回调：请求协作式取消并冻结副标题
  function makeSyncCancel(token: RemoteCancelToken) {
    return () => {
      token.cancel()
      setOpBusy((cur) =>
        cur ? { ...cur, message: "取消中…", cancelling: true } : cur
      )
    }
  }

  async function submitAmend() {
    const msg = amendMessage.trim()
    if (!msg) {
      showToast("提交信息不能为空", "warning")
      return
    }
    try {
      await beginOpBusy("正在重编", "准备改写最近一次提交…")
      // 先 fetch 刷新远端跟踪引用，让 amend 内的「未推送」安全判定基于最新远端 tip
      if (hasRemote) {
        try {
          await updateOpBusy("正在重编", "刷新远端引用…")
          await fetchRemote(bookmarkName, "origin", branchInfo.current || undefined)
        } catch (_e) {
          /* fetch 失败则沿用旧引用，交由 amend 内 guard 判定 */
        }
      }
      await updateOpBusy("正在重编", "改写提交…")
      const oid = await amendHeadCommit(bookmarkName, msg)
      setAmendMessage("")
      await updateOpBusy("正在重编", "刷新仓库状态…")
      await loadAll()
      showToast("已重编：" + shortOid(oid), "success")
    } catch (e: any) {
      showToast("重编失败：" + String(e?.message || e), "error")
    } finally {
      setOpBusy(null)
    }
  }

  async function runPending() {
    const action = pending
    setPending(null)
    if (!action) return
    try {
      if (action.type === "restore") {
        await beginOpBusy("正在丢弃改动", action.filepath)
        await restoreFile(bookmarkName, action.filepath)
        await loadAll()
        return
      }
      if (action.type === "dropStash") {
        setStashBusy(true)
        try {
          await dropStash(bookmarkName, action.entry.index)
          await loadStashes()
          showToast("Stash 已删除：" + action.entry.message, "success")
        } finally {
          setStashBusy(false)
        }
        return
      }
      if (action.type === "deleteLocalBranch") {
        await beginOpBusy("正在删除分支", action.branch)
        await deleteBranch(bookmarkName, action.branch)
        await loadAll()
        showToast("已删除：本地分支 " + action.branch, "success")
        return
      }
      if (action.type === "deleteRemoteBranch") {
        await beginOpBusy("正在删除远端分支", `origin/${action.branch}`)
        await deleteRemoteBranch(bookmarkName, "origin", action.branch)
        await loadAll()
        showToast("已删除：远端分支 origin/" + action.branch, "success")
        return
      }
      if (action.type === "revert") {
        await beginOpBusy("正在撤销", "准备创建反向提交…")
        // 先拉最新，避免在落后 HEAD 上生成反向提交（pull 失败则中止）
        if (hasRemote) {
          await updateOpBusy("正在撤销", "先拉取最新…")
          await pull(bookmarkName, "origin", branchInfo.current || undefined)
        }
        await updateOpBusy("正在撤销", "生成反向提交…")
        const oid = await revertCommit(bookmarkName, action.entry.oid)
        await updateOpBusy("正在撤销", "刷新仓库状态…")
        await loadAll()
        showToast("已撤销：新建反向提交 " + shortOid(oid), "success")
        return
      }
      if (action.type === "softReset") {
        await beginOpBusy("正在回退", "准备 soft 回退 HEAD…")
        // 先 fetch 刷新远端跟踪引用，让 reset 内判定基于最新远端 tip
        if (hasRemote) {
          try {
            await updateOpBusy("正在回退", "刷新远端引用…")
            await fetchRemote(bookmarkName, "origin", branchInfo.current || undefined)
          } catch (_e) {
            /* fetch 失败则沿用旧引用，交由 reset 内 guard 判定 */
          }
        }
        await updateOpBusy("正在回退", "移动 HEAD…")
        await softResetHead(bookmarkName)
        await updateOpBusy("正在回退", "刷新仓库状态…")
        await loadAll()
        showToast("已回退：已 soft 回退 HEAD，改动保留在工作区", "success")
        return
      }
      if (action.type === "amend") {
        await submitAmend()
        return
      }
      if (action.type === "rollback") {
        const token = new RemoteCancelToken()
        await beginOpBusy(
          "正在回滚",
          "准备重置到目标提交…",
          makeSyncCancel(token)
        )
        const result = await resetToCommitAndForcePush(
          bookmarkName,
          action.entry.oid,
          {
            cancelToken: token,
            onProgress: async (info) => {
              await updateOpBusy("正在回滚", info.label)
            },
          }
        )
        await updateOpBusy("正在回滚", "刷新仓库状态…")
        await loadAll()
        showToast(
          "已回滚：" + result.branch + " 已重置到 " + shortOid(action.entry.oid) + " 并强制推送到 origin/" + result.branch,
          "success"
        )
        return
      }
    } catch (e: any) {
      if (action.type === "rollback" && isRemoteOperationCancelled(e)) {
        try {
          await loadAll()
        } catch (_refreshError) {
          /* 忽略刷新失败 */
        }
        // 本地已重置但强推被取消：必须明确告知远端仍是旧历史
        showAlert(
          "回滚未完成",
          "强制推送已取消。本地分支可能已重置到目标提交，远端仍是原历史，可重新执行回滚。"
        )
        return
      }
      const title =
        action.type === "restore"
          ? "撤销失败"
          : action.type === "dropStash"
            ? "删除 Stash 失败"
            : action.type === "revert"
              ? "撤销提交失败"
              : action.type === "amend"
                ? "重编失败"
                : action.type === "deleteLocalBranch"
                  ? "删除分支失败"
                  : action.type === "deleteRemoteBranch"
                    ? "删除远端分支失败"
                    : action.type === "rollback"
                      ? "回滚失败"
                      : "回退失败"
      // revert/reset 失败前可能已改工作区或 HEAD，刷新以避免页面状态与实际不一致
      try {
        if (
          action.type === "revert" ||
          action.type === "softReset" ||
          action.type === "amend" ||
          action.type === "rollback"
        ) {
          await updateOpBusy(
            action.type === "revert"
              ? "正在撤销"
              : action.type === "softReset"
                ? "正在回退"
                : action.type === "rollback"
                  ? "正在回滚"
                  : "正在重编",
            "刷新仓库状态…"
          )
        }
        await loadAll()
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      showToast(title + ": " + String(e?.message || e), "error")
    } finally {
      // 操作遮罩统一收尾；submitAmend 内也会清，重复赋值无害
      setOpBusy(null)
    }
  }

  const pulledLabel = lastPulledAt
    ? relativeTime(new Date(lastPulledAt).toISOString())
    : "尚未拉取"

  // 仓库级互斥：任一写操作进行中时禁用分支切换、暂存、提交、同步、合并、撤销等
  const mutating = committing || stagingBusy || stashBusy || opBusy != null

  // 可合并源：排除当前分支及其 origin/同名（自合并）
  const currentBranch = branchInfo.current || ""
  const {
    handleMergeIntoCurrent,
    handleSwitchBranch,
    handleRenameBranch,
    handleCreateBranch,
  } = useRepoBranchActions({
    bookmarkName,
    currentBranch: branchInfo.current,
    hasCommits,
    hasRemote,
    mutating,
    mergeInProgress,
    beginOpBusy,
    endOpBusy: () => setOpBusy(null),
    reloadRepo: loadAll,
    showAlert,
    showToast,
    openConflictsPage,
  })
  const { handlePush, handlePull } = useRepoSyncActions({
    bookmarkName,
    displayName,
    currentBranch: branchInfo.current,
    hasRemote,
    beginOpBusy,
    updateOpBusy,
    endOpBusy: () => setOpBusy(null),
    makeSyncCancel,
    setPulledAt: (branch, timestamp) => {
      updateBranchLastPulledAt(bookmarkName, branch, timestamp)
      setLastPulledAt(timestamp)
    },
    refreshSyncState: async () => {
      await Promise.all([
        refreshHistoryIfLoaded(),
        loadBranches(),
        loadRemote(),
        loadMergeState(),
      ])
    },
    reloadRepo: loadAll,
    showAlert,
    showToast,
    openConflictsPage,
  })
  const mergeSources = branchInfo.branches.filter(
    (b) => b !== currentBranch && b !== `origin/${currentBranch}`
  )
  // 可删除分支：所有非当前分支（当前分支不可删，需先切走）
  const deletableBranches = branchInfo.branches.filter(
    (b) => b !== currentBranch
  )

  async function handleRefresh() {
    // 操作进行中点刷新只重读当前 Tab 的核心数据，避免与 loadAll 竟态
    if (mutating) {
      if (tab === 0) await loadChanges()
      else if (tab === 1) await loadStashes()
      else if (tab === 2) await loadTrackedFiles()
      else await loadLog()
      return
    }
    await loadAll()
  }

  const confirmAlert = pending ? getRepoPendingAlert(pending) : null

  const activeAlert =
    confirmAlert != null
      ? {
          ...confirmAlert,
          isConfirm: true as const,
        }
      : alertState
        ? {
          title: alertState.title,
          message: alertState.message,
          isConfirm: false as const,
          confirmButton: "好",
        }
        : null

  const canUpload = !hasRemote && repoSource !== "clone"

  return (
    <List
      navigationTitle={displayName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      overlay={
        opBusy
          ? {
            alignment: "center",
            content: (
              <BusyOverlay
                title={opBusy.title}
                message={opBusy.message}
                onCancel={opBusy.onCancel}
                cancelling={opBusy.cancelling}
              />
            ),
          }
          : undefined
      }
      toast={
        toastState
          ? {
              isPresented: toastPresented,
              onChanged: handleToastChanged,
              content: toastContent(toastState.message, toastState.type),
              duration: toastState.duration,
              position: "top",
            }
          : undefined
      }
      onAppear={() => {
        if (skipNextAppearLoadRef.current) {
          skipNextAppearLoadRef.current = false
          return
        }
        loadAll()
      }}
      refreshable={handleRefresh}
      toolbar={{
        topBarTrailing: githubFullName ? (
          <Menu
            title="GitHub"
            systemImage="rectangle.stack"
          >
            <Button title="Issues" systemImage="smallcircle.filled.circle" action={() => openGitHubWorkPage(0)} />
            <Button title="Pull Requests" systemImage="arrow.triangle.merge" action={() => openGitHubWorkPage(1)} />
            <Button title="Actions" systemImage="hammer.fill" action={() => openGitHubWorkPage(2)} />
          </Menu>
        ) : undefined,
      }}
      navigationDestination={{
        isPresented:
          showUpload ||
          showRemotes ||
          showConflicts ||
          showCompare ||
          showRollback ||
          showGitHubWork ||
          selectedCommitOid != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setShowUpload(false)
            setShowRemotes(false)
            setShowConflicts(false)
            setShowCompare(false)
            setShowRollback(false)
            setShowGitHubWork(false)
            setSelectedCommitOid(null)
            // 从冲突页返回时刷新合并状态
            loadMergeState()
          }
        },
        content: (
          <RepoDetailDestination
            bookmarkName={bookmarkName}
            displayName={displayName}
            showUpload={showUpload}
            showRemotes={showRemotes}
            showConflicts={showConflicts}
            showCompare={showCompare}
            showRollback={showRollback}
            currentBranch={branchInfo.current}
            githubFullName={showGitHubWork ? githubFullName : null}
            githubWorkKind={githubWorkKind}
            commitGithubFullName={githubFullName}
            selectedCommitOid={selectedCommitOid}
            onRollbackSelect={handleRollbackSelect}
            onUploaded={(repo) => {
              setDisplayName(repo.name)
              setRepoSource(repo.source || "clone")
              setHasRemote(true)
              setShowUpload(false)
              loadAll().then(() => {
                showToast("上传成功：已上传到 " + repo.name, "success")
              })
            }}
            onRemotesChanged={() => {
              loadRemote()
              loadBranches()
              loadUpstream()
              refreshMeta()
            }}
            onConflictsChanged={(reason) => {
               if (reason === "completed") {
                 skipNextAppearLoadRef.current = true
                 loadChanges()
                 loadMergeState()
                 refreshHistoryIfLoaded()
                 return
               }
              loadMergeState()
              loadChanges()
              refreshHistoryIfLoaded()
            }}
          />
        ),
      }}
      sheet={{
        isPresented: commitSheetMode != null,
        onChanged: (presented: boolean) => {
          if (!presented) setCommitSheetMode(null)
        },
        content: commitSheetMode === "amend" ? (
          <CommitMessageSheet
            key={`amend-${amendDraft.title}`}
            navigationTitle="重编提交"
            confirmTitle="提交"
            footer="确认后将改写最近一次提交。只能用于尚未推送的 HEAD，已推送会被拒绝。"
            initialTitle={amendDraft.title}
            initialDescription={amendDraft.description}
            onCancel={() => setCommitSheetMode(null)}
            onConfirm={handleAmendFormConfirm}
          />
        ) : (
          <CommitMessageSheet
            navigationTitle="提交改动"
            confirmTitle="提交"
            initialTitle={suggestCommitTitle(changes)}
            initialDescription=""
            busy={committing}
            onCancel={() => setCommitSheetMode(null)}
            onConfirm={handleCommit}
          />
        ),
      }}
      alert={{
        title: activeAlert?.title ?? "",
        message: <Text>{activeAlert?.message ?? ""}</Text>,
        isPresented: activeAlert != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setPending(null)
            setAlertState(null)
          }
        },
        actions: activeAlert?.isConfirm ? (
          <>
            <Button
              title="取消"
              role="cancel"
              action={() => setPending(null)}
            />
            <Button
              title={activeAlert.confirmButton}
              role="destructive"
              action={runPending}
            />
          </>
        ) : (
          <Button title="好" role="cancel" action={() => setAlertState(null)} />
        ),
      }}
    >
      <RepoBranchSection
        branchInfo={branchInfo}
        remoteOnlyBranches={remoteOnlyBranches}
        remoteBranchNames={remoteBranchNames}
        mergeSources={mergeSources}
        deletableBranches={deletableBranches}
        hasCommits={hasCommits}
        hasRemote={hasRemote}
        mergeInProgress={mergeInProgress}
        mutating={mutating}
        onDelete={requestDeleteBranch}
        onMerge={handleMergeIntoCurrent}
        onRename={handleRenameBranch}
        onCreate={handleCreateBranch}
        onSwitch={handleSwitchBranch}
      />

      {mergeInProgress ? (
        <MergeConflictSection
          conflictCount={conflictCount}
          mutating={mutating}
          onOpen={openConflictsPage}
        />
      ) : null}

      <RepoRemoteSections
        branchInfo={branchInfo}
        upstream={upstream}
        pulledLabel={pulledLabel}
        hasRemote={hasRemote}
        canUpload={canUpload}
        mergeInProgress={mergeInProgress}
        mutating={mutating}
        hasCommits={hasCommits}
        onCompare={() => {
          skipNextAppearLoadRef.current = true
          setSelectedCommitOid(null)
          setShowUpload(false)
          setShowRemotes(false)
          setShowConflicts(false)
          setShowGitHubWork(false)
          setShowRollback(false)
          setShowCompare(true)
        }}
        onRollback={() => {
          setSelectedCommitOid(null)
          setShowUpload(false)
          setShowRemotes(false)
          setShowConflicts(false)
          setShowGitHubWork(false)
          setShowCompare(false)
          setShowRollback(true)
        }}
        onManageRemotes={() => {
          setSelectedCommitOid(null)
          setShowUpload(false)
          setShowConflicts(false)
          setShowGitHubWork(false)
          setShowRemotes(true)
        }}
        onUpload={() => {
          setSelectedCommitOid(null)
          setShowRemotes(false)
          setShowGitHubWork(false)
          setShowUpload(true)
        }}
        onPush={handlePush}
        onPull={handlePull}
      />

      <RepoDetailTabContent
        tab={tab}
        onTabChange={handleTabChange}
        bookmarkName={bookmarkName}
        changes={changes}
        stashes={stashes}
        log={log}
        trackedFiles={trackedFiles}
        loading={loading}
        onOpenCommitForm={handleOpenCommitForm}
        committing={committing}
        stagingBusy={stagingBusy}
        stashBusy={stashBusy}
        onStage={handleStage}
        onStageAll={handleStageAll}
        onUnstageAll={handleUnstageAll}
        onRestore={handleRestore}
        onCreateStash={handleCreateStash}
        onApplyStash={handleApplyStash}
        onDropStash={handleDropStash}
        onCopyCommit={handleCopyCommit}
        onSelectCommit={(entry) => {
          skipNextAppearLoadRef.current = true
          setShowUpload(false)
          setShowRemotes(false)
          setShowConflicts(false)
          setSelectedCommitOid(entry.oid)
        }}
        onRevert={handleRevertRequest}
        onSoftReset={handleSoftResetRequest}
        onAmend={handleAmendRequest}
        onSearch={handleHistorySearch}
        onLoadMore={handleHistoryLoadMore}
        historyHasMore={historyHasMore}
        historySearchBusy={historySearchBusy}
        historyTotalMatches={historyTotalMatches}
        historyLoading={historyLoading}
        historyLimited={historyLimited}
        githubFullName={githubFullName}
      />
    </List>
  )
}
