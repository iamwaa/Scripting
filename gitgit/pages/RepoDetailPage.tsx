/**
 * pages/RepoDetailPage.tsx - 仓库详情页
 *
 * 改动 / 历史 Tab；本地仓库可上传 GitHub；历史支持复制/撤销/回退/重编。
 */

import {
  List,
  Section,
  Text,
  Button,
  Menu,
  Picker,
  HStack,
  Spacer,
  Image,
  useState,
} from "scripting"
import { BusyOverlay } from "../components/BusyOverlay"
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
  addFiles,
  stageAll,
  unstageAll,
  listStashes,
  createStash,
  applyStash,
  dropStash,
  commit,
  getLogPage,
  getTrackedFiles,
  getBranches,
  createBranch,
  checkoutBranch,
  restoreFile,
  push,
  pull,
  mergeBranchIntoCurrent,
  hasRemoteBranch,
  listRemotes,
  getBranchUpstream,
  revertCommit,
  softResetHead,
  amendHeadCommit,
  fetchRemote,
  getMergeConflictState,
  isRemoteOperationCancelled,
  RemoteCancelToken,
} from "../services/gitService"
import {
  formatBusyActionLabel,
  yieldForUi,
  type RemoteProgressInfo,
} from "../utils/remoteProgress"
import {
  findRepo,
  getBranchLastPulledAt,
  updateBranchLastPulledAt,
} from "../services/repoStore"
import { notifySync } from "../services/notifyService"
import { ChangesTab } from "./ChangesTab"
import { HistoryTab } from "./HistoryTab"
import { FilesTab } from "./FilesTab"
import { StashTab } from "./StashTab"
import { UploadGitHubPage } from "./UploadGitHubPage"
import { CommitDetailPage } from "./CommitDetailPage"
import { RemotesPage } from "./RemotesPage"
import { ConflictsPage } from "./ConflictsPage"
import {
  shortOid,
  buildCommitMessage,
  relativeTime,
  commitTitle,
} from "../utils/format"
import {
  formatMergeSuccessAlert,
  formatPullSuccessAlert,
  pullActionFooterHint,
} from "../utils/branchMerge"
import type { UpstreamConfig } from "../utils/remote"
import { DEFAULT_BRANCH } from "../constants/git"
import { COLOR_ACCENT, COLOR_SECONDARY_LABEL } from "../constants/colors"

/** 分段 Tab 索引：0=改动，1=Stash，2=文件，3=历史 */
type Tab = 0 | 1 | 2 | 3

const HISTORY_PAGE_SIZE = 50

type AlertState = {
  title: string
  message: string
} | null

type PendingAction =
  | { type: "restore"; filepath: string }
  | { type: "revert"; entry: CommitEntry }
  | { type: "softReset"; entry: CommitEntry }
  | { type: "amend" }
  | { type: "dropStash"; entry: StashEntry }
  | null

export function RepoDetailPage({
  bookmarkName,
  name,
}: {
  bookmarkName: string
  name: string
}) {
  const [tab, setTab] = useState<Tab>(0)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [log, setLog] = useState<CommitEntry[]>([])
  const [hasCommits, setHasCommits] = useState(false)
  const [historyQuery, setHistoryQuery] = useState("")
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyTotalMatches, setHistoryTotalMatches] = useState<number | null>(null)
  const [historySearchBusy, setHistorySearchBusy] = useState(false)
  const [trackedFiles, setTrackedFiles] = useState<string[]>([])
  const [branchInfo, setBranchInfo] = useState<BranchInfo>({
    branches: [],
    current: null,
  })
  const [commitTitleText, setCommitTitleText] = useState("")
  const [commitDescription, setCommitDescription] = useState("")
  const [loading, setLoading] = useState(true)
  // Stash / 文件 Tab 懒加载；历史仍首屏加载（空仓提示与合并按钮依赖 log）
  const [stashesLoaded, setStashesLoaded] = useState(false)
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [stagingBusy, setStagingBusy] = useState(false)
  const [stashBusy, setStashBusy] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  // 同步区按钮文案（百分比/阶段，无独立进度条）
  const [syncBusyLabel, setSyncBusyLabel] = useState<string | null>(null)
  const [syncCancelling, setSyncCancelling] = useState(false)
  const [syncCancelToken, setSyncCancelToken] =
    useState<RemoteCancelToken | null>(null)
  const [merging, setMerging] = useState(false)
  const [hasRemote, setHasRemote] = useState(false)
  const [upstream, setUpstream] = useState<UpstreamConfig | null>(null)
  const [lastPulledAt, setLastPulledAt] = useState<number | null>(null)
  const [repoSource, setRepoSource] = useState<RepoMeta["source"]>("local")
  const [displayName, setDisplayName] = useState(name)
  const [showUpload, setShowUpload] = useState(false)
  const [showRemotes, setShowRemotes] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertState>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [amendMessage, setAmendMessage] = useState("")
  // 撤销 / 回退 / 重编 忙态（同款中央遮罩）
  const [historyBusy, setHistoryBusy] = useState<{
    title: string
    message?: string
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
    try {
      if (!(await isInitialized(bookmarkName))) {
        await initRepo(bookmarkName)
      }
      // 首屏：改动 + 历史 + 分支/远端/合并；Stash/文件按 Tab 懒加载
      await Promise.all([
        loadChanges(),
        loadLog(),
        loadBranches(),
        loadRemote(),
        loadUpstream(),
        loadMergeState(),
      ])
      // 若当前已在懒加载 Tab，补数据
      if (tab === 1) await loadStashes()
      if (tab === 2) await loadTrackedFiles()
    } catch (e: any) {
      showAlert("加载失败", String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function loadChanges() {
    const c = await getChanges(bookmarkName)
    setChanges(c)
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
    setHistoryQuery(normalizedQuery)
    if (reset && normalizedQuery.trim().length === 0) {
      setHasCommits(page.entries.length > 0)
    }
  }

  async function handleHistorySearch(query: string) {
    setHistorySearchBusy(true)
    try {
      await loadLog(true, query)
    } catch (e: any) {
      showAlert("搜索失败", String(e?.message || e))
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
      showAlert("加载历史失败", String(e?.message || e))
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
    const target = next as Tab
    setTab(target)
    if (target === 1 && !stashesLoaded) {
      setLoading(true)
      try {
        await loadStashes()
      } catch (e: any) {
        showAlert("加载失败", String(e?.message || e))
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
        showAlert("加载失败", String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }
  }

  async function loadBranches() {
    const b = await getBranches(bookmarkName)
    setBranchInfo(b)
    refreshMeta(b.current)
  }

  async function loadRemote() {
    try {
      const remotes = await listRemotes(bookmarkName)
      setHasRemote(remotes.length > 0)
    } catch (_e) {
      setHasRemote(false)
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
    setShowConflicts(true)
  }

  async function handlePush() {
    const token = new RemoteCancelToken()
    setSyncCancelToken(token)
    setSyncCancelling(false)
    setSyncBusyLabel(formatBusyActionLabel("推送中"))
    setPushing(true)
    // 推送前若先 pull，进度文案基词切换
    let busyBase = "推送中"
    const remoteOpts = {
      cancelToken: token,
      onProgress: async (info: RemoteProgressInfo) => {
        setSyncBusyLabel(formatBusyActionLabel(busyBase, info))
        await yieldForUi()
      },
    }
    try {
      const branch = branchInfo.current
      if (!branch) throw new Error("当前没有可推送的分支")

      // 已发布分支先拉最新；新分支远端尚不存在，必须直接 push 创建
      if (hasRemote && (await hasRemoteBranch(bookmarkName, branch, "origin"))) {
        try {
          busyBase = "推送中"
          setSyncBusyLabel(formatBusyActionLabel("推送中", { phase: "先拉取最新" }))
          await pull(bookmarkName, "origin", branch, undefined, remoteOpts)
          const now = Date.now()
          updateBranchLastPulledAt(bookmarkName, branch, now)
          setLastPulledAt(now)
        } catch (e: any) {
          if (isRemoteOperationCancelled(e)) throw e
          // pull 失败（冲突/网络）则不继续推送，避免盲目覆盖远端
          const code = String((e as any)?.code || "")
          const msg = String(e?.message || e)
          if (code === "MergeConflictError" || msg.includes("合并冲突")) {
            const conflictErr = new Error("先拉取最新出现合并冲突：" + msg)
              ; (conflictErr as any).code = "MergeConflictError"
            throw conflictErr
          }
          throw new Error("先拉取最新失败：" + msg)
        }
      }
      busyBase = "推送中"
      setSyncBusyLabel(formatBusyActionLabel("推送中"))
      await push(bookmarkName, "origin", branch, false, remoteOpts)
      await notifySync("push", displayName, branch)
      showAlert("推送成功", `已发布到 GitHub：origin/${branch}`)
    } catch (e: any) {
      if (isRemoteOperationCancelled(e)) {
        showAlert("已取消", "推送已取消")
      } else {
        const code = String((e as any)?.code || "")
        const msg = String(e?.message || e)
        if (code === "MergeConflictError" || msg.includes("合并冲突")) {
          openConflictsPage()
          showAlert("合并冲突", msg)
        } else {
          showAlert("推送失败", msg)
        }
      }
    } finally {
      // push 成功或失败都可能已更新 remote-tracking ref，刷新日志、分支与远端
      try {
        await Promise.all([
          loadLog(),
          loadBranches(),
          loadRemote(),
          loadMergeState(),
        ])
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      setPushing(false)
      setSyncBusyLabel(null)
      setSyncCancelling(false)
      setSyncCancelToken(null)
    }
  }

  async function handlePull() {
    const token = new RemoteCancelToken()
    setSyncCancelToken(token)
    setSyncCancelling(false)
    setSyncBusyLabel(formatBusyActionLabel("拉取中"))
    setPulling(true)
    try {
      // pull 内会 resolveAuthor；不传 ref 时 fetch 全部分支列表，合并仅当前 ← origin/同名
      const result = await pull(bookmarkName, "origin", undefined, undefined, {
        cancelToken: token,
        onProgress: async (info: RemoteProgressInfo) => {
          setSyncBusyLabel(formatBusyActionLabel("拉取中", info))
          await yieldForUi()
        },
      })
      const now = Date.now()
      updateBranchLastPulledAt(bookmarkName, result.branch, now)
      setLastPulledAt(now)
      await notifySync("pull", displayName, result.branch || branchInfo.current || "")
      const alert = formatPullSuccessAlert(result)
      showAlert(alert.title, alert.message)
    } catch (e: any) {
      if (isRemoteOperationCancelled(e)) {
        showAlert("已取消", "拉取已取消")
        return
      }
      const code = String((e as any)?.code || "")
      const msg = String(e?.message || e)
      // 合并冲突：刷新后进入冲突页
      if (code === "MergeConflictError" || msg.includes("合并冲突")) {
        try {
          await loadAll()
        } catch (_e) {
          /* 忽略 */
        }
        openConflictsPage()
        showAlert("合并冲突", msg)
      } else {
        showAlert("拉取失败", msg)
      }
    } finally {
      // pull 失败前可能已更新 remote-tracking ref，无论如何都重读状态
      try {
        await loadAll()
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      setPulling(false)
      setSyncBusyLabel(null)
      setSyncCancelling(false)
      setSyncCancelToken(null)
    }
  }

  function handleCancelSync() {
    syncCancelToken?.cancel()
    setSyncCancelling(true)
    setSyncBusyLabel("取消中…")
  }

  /** 将指定分支合并进当前分支；冲突复用 ConflictsPage */
  async function handleMergeIntoCurrent(source: string) {
    if (
      merging ||
      mergeInProgress ||
      committing ||
      stagingBusy ||
      stashBusy ||
      pushing ||
      pulling ||
      historyBusy
    ) {
      return
    }
    setMerging(true)
    try {
      const result = await mergeBranchIntoCurrent(bookmarkName, source)
      const alert = formatMergeSuccessAlert(result)
      showAlert(alert.title, alert.message)
    } catch (e: any) {
      const code = String((e as any)?.code || "")
      const msg = String(e?.message || e)
      if (code === "MergeConflictError" || msg.includes("合并冲突")) {
        try {
          await loadAll()
        } catch (_e) {
          /* 忽略 */
        }
        openConflictsPage()
        showAlert("合并冲突", msg)
      } else {
        showAlert("合并失败", msg)
      }
    } finally {
      try {
        await loadAll()
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      setMerging(false)
    }
  }

  async function handleMergePrompt() {
    if (
      merging ||
      mergeInProgress ||
      committing ||
      stagingBusy ||
      stashBusy ||
      pushing ||
      pulling ||
      historyBusy
    ) {
      return
    }
    try {
      const input = await Dialog.prompt({
        title: "合并到当前",
        message: `合并进「${branchInfo.current || "当前分支"}」`,
        placeholder: "feature 或 origin/feature",
        cancelLabel: "取消",
        confirmLabel: "合并",
      })
      if (input == null) return
      const source = input.trim()
      if (!source) {
        showAlert("gitgit", "请输入要合并的分支名")
        return
      }
      await handleMergeIntoCurrent(source)
    } catch (e: any) {
      showAlert("合并失败", String(e?.message || e))
    }
  }

  async function handleSwitchBranch(ref: string) {
    try {
      await checkoutBranch(bookmarkName, ref)
      await loadAll()
    } catch (e: any) {
      showAlert("切换失败", String(e?.message || e))
    }
  }

  async function handleCreateBranch() {
    try {
      const branchName = await Dialog.prompt({
        title: "新建分支",
        message: "输入新分支名称，将创建并切换到该分支",
        placeholder: "feature/xxx",
        cancelLabel: "取消",
        confirmLabel: "创建",
      })
      if (branchName == null) return
      const name = branchName.trim()
      if (!name) {
        showAlert("gitgit", "分支名称不能为空")
        return
      }
      const emptyBefore = !hasCommits
      await createBranch(bookmarkName, name)
      await loadAll()
      showAlert(
        emptyBefore ? "已设置" : "已创建本地分支",
        emptyBefore
          ? `空仓库目标分支已设为 ${name}，首次提交后生效`
          : hasRemote
            ? `已创建并切换到 ${name}。点击「推送 Push」发布到 GitHub。`
            : `已创建并切换到 ${name}`
      )
    } catch (e: any) {
      showAlert("创建失败", String(e?.message || e))
    }
  }

  async function handleStage(filepath: string) {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await addFiles(bookmarkName, filepath)
      await loadChanges()
    } catch (e: any) {
      showAlert("暂存失败", String(e?.message || e))
    } finally {
      setStagingBusy(false)
    }
  }

  async function handleStageAll() {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await stageAll(bookmarkName)
      await loadChanges()
    } catch (e: any) {
      showAlert("全部暂存失败", String(e?.message || e))
    } finally {
      setStagingBusy(false)
    }
  }

  async function handleUnstageAll() {
    if (stagingBusy || stashBusy) return
    setStagingBusy(true)
    try {
      await unstageAll(bookmarkName)
      await loadChanges()
    } catch (e: any) {
      showAlert("全部取消暂存失败", String(e?.message || e))
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
      showAlert("已保存到 Stash", message.trim() || "当前改动已保存")
    } catch (e: any) {
      showAlert("保存 Stash 失败", String(e?.message || e))
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
      showAlert("Stash 已应用", `「${entry.message}」已恢复，列表项仍保留`)
    } catch (e: any) {
      try {
        await Promise.all([loadChanges(), loadStashes()])
      } catch (_refreshError) {
        /* 保留原错误提示 */
      }
      showAlert("应用 Stash 失败", String(e?.message || e))
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

  async function handleCommit() {
    const title = commitTitleText.trim()
    if (!title) {
      showAlert("gitgit", "请填写提交信息（标题）")
      return
    }
    if (!changes.some((change) => change.staged)) {
      showAlert("没有暂存内容", "请先暂存要提交的文件。")
      return
    }
    setCommitting(true)
    try {
      const msg = buildCommitMessage(title, commitDescription)
      const oid = await commit(bookmarkName, msg)
      setCommitTitleText("")
      setCommitDescription("")
      // 先清空改动，避免 loadAll 完成前按钮仍显示「取消暂存」
      setChanges([])
      await loadAll()
      await notifySync("commit", displayName, shortOid(oid))
      showAlert("提交成功", shortOid(oid))
    } catch (e: any) {
      showAlert("提交失败", String(e?.message || e))
    } finally {
      setCommitting(false)
    }
  }

  // === 历史操作 ===

  async function handleCopyCommit(entry: CommitEntry) {
    try {
      // 只复制完整 oid，不要其它信息
      await Pasteboard.setString(entry.oid)
      showAlert("已复制", shortOid(entry.oid))
    } catch (e: any) {
      showAlert("复制失败", String(e?.message || e))
    }
  }

  function handleRevertRequest(entry: CommitEntry) {
    setPending({ type: "revert", entry })
  }

  function handleSoftResetRequest(entry: CommitEntry) {
    setPending({ type: "softReset", entry })
  }

  async function handleAmendRequest(entry: CommitEntry) {
    try {
      const message = await Dialog.prompt({
        title: "重编提交",
        message: "输入新的提交信息，确认后将改写最近一次提交",
        defaultValue: commitTitle(entry.message),
        cancelLabel: "取消",
        confirmLabel: "下一步",
      })
      if (message == null) return
      const trimmedMessage = message.trim()
      if (!trimmedMessage) {
        showAlert("gitgit", "提交信息不能为空")
        return
      }
      setAmendMessage(trimmedMessage)
      setPending({ type: "amend" })
    } catch (e: any) {
      showAlert("重编失败", String(e?.message || e))
    }
  }

  // 设置历史操作忙态，并让出一帧以便遮罩先渲染
  async function beginHistoryBusy(title: string, message?: string) {
    setHistoryBusy({ title, message })
    await yieldForUi()
  }

  async function updateHistoryBusy(title: string, message?: string) {
    setHistoryBusy({ title, message })
    await yieldForUi()
  }

  async function submitAmend() {
    const msg = amendMessage.trim()
    if (!msg) {
      showAlert("gitgit", "提交信息不能为空")
      return
    }
    try {
      await beginHistoryBusy("正在重编", "准备改写最近一次提交…")
      // 先 fetch 刷新远端跟踪引用，让 amend 内的「未推送」安全判定基于最新远端 tip
      if (hasRemote) {
        try {
          await updateHistoryBusy("正在重编", "刷新远端引用…")
          await fetchRemote(bookmarkName, "origin", branchInfo.current || undefined)
        } catch (_e) {
          /* fetch 失败则沿用旧引用，交由 amend 内 guard 判定 */
        }
      }
      await updateHistoryBusy("正在重编", "改写提交…")
      const oid = await amendHeadCommit(bookmarkName, msg)
      setAmendMessage("")
      await updateHistoryBusy("正在重编", "刷新仓库状态…")
      await loadAll()
      showAlert("已重编", shortOid(oid))
    } catch (e: any) {
      showAlert("重编失败", String(e?.message || e))
    } finally {
      setHistoryBusy(null)
    }
  }

  async function runPending() {
    const action = pending
    setPending(null)
    if (!action) return
    try {
      if (action.type === "restore") {
        await restoreFile(bookmarkName, action.filepath)
        await loadAll()
        return
      }
      if (action.type === "dropStash") {
        setStashBusy(true)
        try {
          await dropStash(bookmarkName, action.entry.index)
          await loadStashes()
          showAlert("Stash 已删除", `「${action.entry.message}」已删除`)
        } finally {
          setStashBusy(false)
        }
        return
      }
      if (action.type === "revert") {
        await beginHistoryBusy("正在撤销", "准备创建反向提交…")
        // 先拉最新，避免在落后 HEAD 上生成反向提交（pull 失败则中止）
        if (hasRemote) {
          await updateHistoryBusy("正在撤销", "先拉取最新…")
          await pull(bookmarkName, "origin", branchInfo.current || undefined)
        }
        await updateHistoryBusy("正在撤销", "生成反向提交…")
        const oid = await revertCommit(bookmarkName, action.entry.oid)
        await updateHistoryBusy("正在撤销", "刷新仓库状态…")
        await loadAll()
        showAlert("已撤销", `新建反向提交 ${shortOid(oid)}`)
        return
      }
      if (action.type === "softReset") {
        await beginHistoryBusy("正在回退", "准备 soft 回退 HEAD…")
        // 先 fetch 刷新远端跟踪引用，让 reset 内判定基于最新远端 tip
        if (hasRemote) {
          try {
            await updateHistoryBusy("正在回退", "刷新远端引用…")
            await fetchRemote(bookmarkName, "origin", branchInfo.current || undefined)
          } catch (_e) {
            /* fetch 失败则沿用旧引用，交由 reset 内 guard 判定 */
          }
        }
        await updateHistoryBusy("正在回退", "移动 HEAD…")
        await softResetHead(bookmarkName)
        await updateHistoryBusy("正在回退", "刷新仓库状态…")
        await loadAll()
        showAlert("已回退", "已 soft 回退 HEAD，改动保留在工作区/暂存区")
        return
      }
      if (action.type === "amend") {
        await submitAmend()
        return
      }
    } catch (e: any) {
      const title =
        action.type === "restore"
          ? "撤销失败"
          : action.type === "dropStash"
            ? "删除 Stash 失败"
            : action.type === "revert"
              ? "撤销提交失败"
              : action.type === "amend"
                ? "重编失败"
                : "回退失败"
      // revert/reset 失败前可能已改工作区或 HEAD，刷新以避免页面状态与实际不一致
      try {
        if (
          action.type === "revert" ||
          action.type === "softReset" ||
          action.type === "amend"
        ) {
          await updateHistoryBusy(
            action.type === "revert"
              ? "正在撤销"
              : action.type === "softReset"
                ? "正在回退"
                : "正在重编",
            "刷新仓库状态…"
          )
        }
        await loadAll()
      } catch (_e) {
        /* 忽略刷新失败 */
      }
      showAlert(title, String(e?.message || e))
    } finally {
      // 历史改写类操作统一收尾；submitAmend 也会清，重复赋值无害
      if (
        action.type === "revert" ||
        action.type === "softReset" ||
        action.type === "amend"
      ) {
        setHistoryBusy(null)
      }
    }
  }

  const pulledLabel = lastPulledAt
    ? relativeTime(new Date(lastPulledAt).toISOString())
    : "尚未拉取"

  // 仓库级互斥：任一写操作进行中时禁用分支切换、暂存、提交、同步、合并、撤销等
  const mutating =
    committing ||
    stagingBusy ||
    stashBusy ||
    pushing ||
    pulling ||
    merging ||
    historyBusy != null

  // 可合并源：排除当前分支及其 origin/同名（自合并）
  const currentBranch = branchInfo.current || ""
  const mergeSources = branchInfo.branches.filter(
    (b) => b !== currentBranch && b !== `origin/${currentBranch}`
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

  // 声明式弹窗：确认操作优先
  let confirmTitle = ""
  let confirmMessage = ""
  let confirmButton = "确定"
  if (pending?.type === "restore") {
    confirmTitle = "丢弃改动？"
    confirmMessage = `将「${pending.filepath}」恢复到 HEAD，不可撤销。`
    confirmButton = "丢弃"
  } else if (pending?.type === "revert") {
    confirmTitle = "撤销该提交？"
    confirmMessage = `将为 HEAD 创建反向提交，撤销「${commitTitle(pending.entry.message)}」。`
    confirmButton = "撤销"
  } else if (pending?.type === "softReset") {
    confirmTitle = "回退未推送提交？"
    confirmMessage =
      "将 soft reset 到上一提交，提交记录移除，文件改动保留。仅限未推送的 HEAD。"
    confirmButton = "回退"
  } else if (pending?.type === "amend") {
    confirmTitle = "重编提交？"
    confirmMessage =
      "将改写最近提交信息。只能用于尚未推送的 HEAD，已推送会被拒绝。"
    confirmButton = "重编"
  } else if (pending?.type === "dropStash") {
    confirmTitle = "删除 Stash？"
    confirmMessage = `将永久删除「${pending.entry.message}」。`
    confirmButton = "删除"
  }

  const activeAlert =
    pending != null
      ? {
        title: confirmTitle,
        message: confirmMessage,
        isConfirm: true as const,
        confirmButton,
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
        historyBusy
          ? {
            alignment: "center",
            content: (
              <BusyOverlay
                title={historyBusy.title}
                message={historyBusy.message}
              />
            ),
          }
          : undefined
      }
      onAppear={() => {
        loadAll()
      }}
      toolbar={{
        topBarTrailing: (
          <Button
            title="刷新"
            systemImage="arrow.clockwise"
            action={handleRefresh}
            disabled={loading}
          />
        ),
      }}
      navigationDestination={{
        isPresented:
          showUpload ||
          showRemotes ||
          showConflicts ||
          selectedCommitOid != null,
        onChanged: (presented: boolean) => {
          if (!presented) {
            setShowUpload(false)
            setShowRemotes(false)
            setShowConflicts(false)
            setSelectedCommitOid(null)
            // 从冲突页返回时刷新合并状态
            loadMergeState()
          }
        },
        content: showUpload ? (
          <UploadGitHubPage
            bookmarkName={bookmarkName}
            defaultName={displayName}
            onUploaded={(repo) => {
              setDisplayName(repo.name)
              setRepoSource(repo.source || "clone")
              setHasRemote(true)
              setShowUpload(false)
              // 关闭子页后再由父页弹成功提示（子页正在退出，其 alert 不可见）
              loadAll().then(() => {
                showAlert("上传成功", `已上传到 ${repo.name}`)
              })
            }}
          />
        ) : showRemotes ? (
          <RemotesPage
            bookmarkName={bookmarkName}
            onChanged={() => {
              loadRemote()
              loadBranches()
              loadUpstream()
              refreshMeta()
            }}
          />
        ) : showConflicts ? (
          <ConflictsPage
            bookmarkName={bookmarkName}
            onChanged={() => {
              loadMergeState()
              loadChanges()
              loadLog()
            }}
          />
        ) : selectedCommitOid ? (
          // key 强制按提交重建，防止 navigationDestination 复用旧实例
          <CommitDetailPage
            key={selectedCommitOid}
            bookmarkName={bookmarkName}
            oid={selectedCommitOid}
          />
        ) : (
          <Text>加载中…</Text>
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
      <Section
        header={
          <HStack alignment="center" spacing={8}>
            <Text>分支</Text>
            <Spacer />
            {/* 合并在新建左侧；有候选分支用 Menu，否则点按输入 */}
            {mergeSources.length > 0 ? (
              <Menu
                label={
                  <HStack alignment="center" spacing={4}>
                    <Image
                      systemName="arrow.triangle.merge"
                      font="caption"
                      foregroundStyle={COLOR_ACCENT}
                    />
                    <Text font="caption" foregroundStyle={COLOR_ACCENT}>
                      {merging ? "合并中…" : "合并"}
                    </Text>
                  </HStack>
                }
              >
                {mergeSources.map((b) => (
                  <Button
                    key={b}
                    title={b}
                    action={() => handleMergeIntoCurrent(b)}
                    disabled={mutating || mergeInProgress || !hasCommits}
                  />
                ))}
                <Button
                  title="其它分支"
                  action={handleMergePrompt}
                  disabled={mutating || mergeInProgress || !hasCommits}
                />
              </Menu>
            ) : (
              <Button
                action={handleMergePrompt}
                disabled={mutating || mergeInProgress || !hasCommits}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="arrow.triangle.merge"
                    font="caption"
                    foregroundStyle={COLOR_ACCENT}
                  />
                  <Text font="caption" foregroundStyle={COLOR_ACCENT}>
                    {merging ? "合并中…" : "合并"}
                  </Text>
                </HStack>
              </Button>
            )}
            <Button
              action={handleCreateBranch}
              disabled={mutating || mergeInProgress}
            >
              <HStack alignment="center" spacing={4}>
                <Image
                  systemName="plus.circle"
                  font="caption"
                  foregroundStyle={COLOR_ACCENT}
                />
                <Text font="caption" foregroundStyle={COLOR_ACCENT}>
                  新建
                </Text>
              </HStack>
            </Button>
          </HStack>
        }
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {!hasCommits
              ? `空仓库默认 ${branchInfo.current || DEFAULT_BRANCH}，首次提交后才会真正创建分支引用`
              : hasRemote
                ? "含本地与 origin 远端分支"
                : "仅本地分支"}
          </Text>
        }
      >
        {branchInfo.branches.length > 0 ? (
          <Picker
            title="当前分支"
            value={branchInfo.current ?? ""}
            onChanged={(v: string) => handleSwitchBranch(v)}
          >
            {branchInfo.branches.map((b) => (
              <Text key={b} tag={b}>
                {b}
              </Text>
            ))}
          </Picker>
        ) : (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            默认 {DEFAULT_BRANCH}（尚未初始化）
          </Text>
        )}
      </Section>

      {mergeInProgress ? (
        <Section
          header={<Text>合并冲突</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              {conflictCount > 0
                ? `仍有 ${conflictCount} 个文件待解决`
                : "冲突已解决，请完成合并提交或中止合并"}
            </Text>
          }
        >
          <Button
            title={
              conflictCount > 0
                ? `处理冲突（${conflictCount}）`
                : "完成或中止合并"
            }
            systemImage="exclamationmark.triangle"
            action={openConflictsPage}
            disabled={pushing || pulling || merging}
          />
        </Section>
      ) : null}

      {hasRemote ? (
        <Section
          header={
            <HStack alignment="center" spacing={8}>
              <Text>同步</Text>
              <Spacer />
              <Button
                action={() => {
                  setSelectedCommitOid(null)
                  setShowUpload(false)
                  setShowConflicts(false)
                  setShowRemotes(true)
                }}
                disabled={pushing || pulling || merging}
              >
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="network"
                    font="caption"
                    foregroundStyle={COLOR_ACCENT}
                  />
                  <Text font="caption" foregroundStyle={COLOR_ACCENT}>
                    远端管理
                  </Text>
                </HStack>
              </Button>
            </HStack>
          }
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              {pullActionFooterHint(branchInfo.current, upstream)}
              {"\n"}
              最近拉取：{pulledLabel}
            </Text>
          }
        >
          <HStack alignment="center">
            <Button
              action={handlePush}
              disabled={pushing || pulling || merging || mergeInProgress}
            >
              <HStack alignment="center" spacing={6}>
                <Image systemName="arrow.up.circle" />
                <Text>
                  {pushing
                    ? syncBusyLabel || formatBusyActionLabel("推送中")
                    : "推送 Push"}
                </Text>
              </HStack>
            </Button>
            <Spacer />
            {pushing ? (
              <Button
                title="取消"
                foregroundStyle="red"
                font="caption"
                buttonStyle="plain"
                action={handleCancelSync}
                disabled={syncCancelling}
              />
            ) : null}
          </HStack>
          <HStack alignment="center">
            <Button
              action={handlePull}
              disabled={pushing || pulling || merging || mergeInProgress}
            >
              <HStack alignment="center" spacing={6}>
                <Image systemName="arrow.down.circle" />
                <Text>
                  {pulling
                    ? syncBusyLabel || formatBusyActionLabel("拉取中")
                    : "拉取 Pull"}
                </Text>
              </HStack>
            </Button>
            <Spacer />
            {pulling ? (
              <Button
                title="取消"
                foregroundStyle="red"
                font="caption"
                buttonStyle="plain"
                action={handleCancelSync}
                disabled={syncCancelling}
              />
            ) : null}
          </HStack>
        </Section>
      ) : canUpload ? (
        <Section
          header={<Text>上传</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              本地仓库 · 默认分支 {branchInfo.current || DEFAULT_BRANCH}
              · 需至少一次提交后再上传
            </Text>
          }
        >
          <Button
            title="上传到 GitHub"
            systemImage="arrow.up.circle"
            action={() => {
              setSelectedCommitOid(null)
              setShowRemotes(false)
              setShowUpload(true)
            }}
          />
          <Button
            title="远端管理"
            systemImage="network"
            action={() => {
              setSelectedCommitOid(null)
              setShowUpload(false)
              setShowRemotes(true)
            }}
          />
        </Section>
      ) : (
        <Section
          header={<Text>远端</Text>}
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              可手动添加 origin，或克隆/上传后自动出现同步区
            </Text>
          }
        >
          <Button
            title="远端管理"
            systemImage="network"
            action={() => {
              setSelectedCommitOid(null)
              setShowUpload(false)
              setShowRemotes(true)
            }}
          />
        </Section>
      )}

      <Section>
        <Picker
          title="视图"
          value={tab}
          onChanged={handleTabChange}
          pickerStyle="segmented"
        >
          <Text tag={0}>改动</Text>
          <Text tag={1}>Stash</Text>
          <Text tag={2}>文件</Text>
          <Text tag={3}>历史</Text>
        </Picker>
      </Section>

      {tab === 0 ? (
        <ChangesTab
          bookmarkName={bookmarkName}
          changes={changes}
          loading={loading}
          title={commitTitleText}
          setTitle={setCommitTitleText}
          description={commitDescription}
          setDescription={setCommitDescription}
          committing={committing}
          stagingBusy={stagingBusy}
          onCommit={handleCommit}
          onStage={handleStage}
          onStageAll={handleStageAll}
          onUnstageAll={handleUnstageAll}
          onRestore={handleRestore}
        />
      ) : tab === 1 ? (
        <StashTab
          changes={changes}
          stashes={stashes}
          loading={loading}
          committing={committing}
          stagingBusy={stagingBusy}
          stashBusy={stashBusy}
          onCreateStash={handleCreateStash}
          onApplyStash={handleApplyStash}
          onDropStash={handleDropStash}
        />
      ) : tab === 2 ? (
        <FilesTab files={trackedFiles} loading={loading} />
      ) : (
        <HistoryTab
          log={log}
          loading={loading}
          onCopy={handleCopyCommit}
          onSelect={(entry) => {
            // 独占受控导航，避免与上传/远端/冲突子页状态叠加
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
          hasMore={historyHasMore}
          searchBusy={historySearchBusy}
          totalMatches={historyTotalMatches}
        />
      )}
    </List>
  )
}
