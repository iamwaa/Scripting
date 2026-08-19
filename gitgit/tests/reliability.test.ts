import { Script } from "scripting"
import { createFS, loadGitEngine } from "../services/gitCore"
import {
  branchLastPulledAtPatch,
  cleanupCloneAttempt,
  getBranchLastPulledAt,
} from "../services/repoStore"
import { compareCommitTrees } from "../services/gitService"
import { resetToCommitAndPushInternal } from "../services/git/historyMutationService"
import { normalizeRemoteBranches } from "../services/git/branchQueryService"
import { lineDiff } from "../services/diffService"
import {
  readGithubUser,
  readRepos,
  STORAGE_KEYS,
  writeGithubUser,
  writeRepos,
} from "../services/storage"
import { buildFileTree } from "../utils/fileTree"
import {
  buildCommitMessage,
  commitBody,
  commitTitle,
  suggestCommitTitle,
} from "../utils/format"
import {
  matchesHistoryQuery,
  normalizeHistoryQuery,
  paginateHistory,
} from "../utils/history"
import {
  acquireRepoMutationLock,
  buildUploadPendingPatch,
  buildUploadSuccessPatch,
  computeSyncTopology,
  desiredOriginAfterFailedPush,
  releaseRepoMutationLock,
  resolveUploadRemoteTarget,
  topologyFromCounts,
} from "../utils/gitSync"
import {
  pathsNeedingStage,
  pathsNeedingUnstage,
  stageActionForRow,
} from "../utils/stageSelection"
import {
  collectGhostStashIndices,
  dropStashReflogAtIndex,
  isStatusMatrixClean,
  isValidOid,
  pairStashEntriesWithOids,
  parseStashEntries,
  repairStashReflogLines,
  sanitizeStashMessage,
  stashOidsNewestFirst,
} from "../utils/stash"
import {
  assertCanAddRemote,
  findRemote,
  formatUpstreamLabel,
  normalizeUpstreamMerge,
  parseUpstreamConfig,
  planDeleteRemote,
  planSetRemoteUrl,
  planSetUpstream,
  repoRemoteUrlMetaAfterChange,
  shouldClearRepoRemoteUrlMeta,
  validateRemoteName,
  validateRemoteUrl,
} from "../utils/remote"
import {
  branchExists,
  normalizeBranchName,
  planDeleteBranch,
  planDeleteRemoteBranch,
  planRenameBranch,
  stripRemotePrefix,
  validateBranchName,
} from "../utils/branch"
import {
  buildConflictFilesFromErrorData,
  buildConflictReport,
  buildMergeState,
  conflictKindLabel,
  containsConflictMarkers,
  formatAutoMarkSummary,
  defaultMergeCommitMessage,
  getMergeConflictErrorData,
  formatRepoListMergeSummary,
  hasUnresolvedConflicts,
  isMergeConflictError,
  mergeCommitParents,
  parseMergeState,
  removeResolvedConflict,
  resolutionActionForConflict,
  serializeMergeState,
  stageForResolution,
} from "../utils/mergeConflict"
import {
  formatMergeSuccessAlert,
  formatPullSuccessAlert,
  normalizeBranchMergeSource,
  planMergeIntoCurrent,
  pullActionFooterHint,
  resolvePullTarget,
} from "../utils/branchMerge"
import {
  createGitOnProgress,
  createRemoteCancelledError,
  emitRemoteProgress,
  formatBusyActionLabel,
  formatBusyWithPercent,
  formatRemoteProgress,
  isRemoteOperationCancelled,
  localizeProgressPhase,
  progressPercent,
  REMOTE_OPERATION_CANCELLED,
  RemoteCancelToken,
  toRemoteProgressInfo,
} from "../utils/remoteProgress"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

async function assertRejects(
  operation: () => Promise<unknown>,
  verify: (error: any) => boolean,
  message: string
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    assert(verify(error), message)
    return
  }
  throw new Error("断言失败（未抛错）: " + message)
}

function errorWithCode(code: string | number): Error {
  const error = new Error(String(code))
  ;(error as any).code = code
  return error
}

function testBranchLastPulledAt(): void {
  const repo = {
    name: "demo",
    bookmarkName: "repo-1",
    createdAt: 1,
    lastPulledAtByBranch: { main: 100 },
  }

  assert(
    getBranchLastPulledAt(repo, "main") === 100,
    "应读取当前分支自己的最近拉取时间"
  )
  assert(
    getBranchLastPulledAt(repo, "feature") === null,
    "未拉取过的分支不应复用其它分支时间"
  )

  const featurePatch = branchLastPulledAtPatch(repo, " feature ", 200)
  assert(
    featurePatch?.lastPulledAtByBranch?.main === 100 &&
      featurePatch.lastPulledAtByBranch.feature === 200,
    "更新一个分支时必须保留其它分支的拉取时间"
  )
  assert(
    branchLastPulledAtPatch(repo, "", 300) === null &&
      branchLastPulledAtPatch(repo, "main", Number.NaN) === null,
    "无效分支或时间不得写入映射"
  )
}

function testGithubUserCache(): void {
  const key = STORAGE_KEYS.githubUser
  const previous = Storage.get<unknown>(key)
  try {
    writeGithubUser({ login: "octocat", avatarUrl: "https://example.com/a.png" })
    const saved = readGithubUser()
    assert(
      saved?.login === "octocat" &&
        saved.avatarUrl === "https://example.com/a.png",
      "应能读写带头像的已验证用户"
    )

    // 旧版缓存是纯字符串登录名，升级后必须可读
    Storage.set(key, "legacycat")
    const legacy = readGithubUser()
    assert(
      legacy?.login === "legacycat" && legacy.avatarUrl === "",
      "旧版纯用户名缓存应读取为无头像用户"
    )

    writeGithubUser(null)
    assert(readGithubUser() === null, "清除后不应再有已验证用户")
  } finally {
    // 还原测试前的缓存，避免污染真实设置
    Storage.remove(key)
    if (previous != null) Storage.set(key, previous as any)
  }
}

function testHistoryPagination(): void {
  const entries = [
    {
      oid: "aaa111",
      message: "Fix Login Flow",
      author: { name: "Alice", email: "alice@example.com" },
      date: "2026-01-03T00:00:00.000Z",
    },
    {
      oid: "bbb222",
      message: "Update docs",
      author: { name: "Bob", email: "bob@example.com" },
      date: "2026-01-02T00:00:00.000Z",
    },
    {
      oid: "ccc333",
      message: "Refactor storage",
      author: { name: "Carol", email: "carol@example.com" },
      date: "2026-01-01T00:00:00.000Z",
    },
  ]

  assert(normalizeHistoryQuery("  LOGIN ") === "login", "搜索词应去空格并统一大小写")
  assert(matchesHistoryQuery(entries[0], "login"), "搜索应匹配提交标题")
  assert(matchesHistoryQuery(entries[1], "BOB@EXAMPLE.COM"), "搜索应匹配作者邮箱")
  assert(matchesHistoryQuery(entries[2], "CCC333"), "搜索应匹配 OID")
  assert(!matchesHistoryQuery(entries[1], "missing"), "不匹配的提交不应被返回")

  const first = paginateHistory(entries, 0, 2)
  assert(first.entries.length === 2, "第一页应返回限定数量")
  assert(first.hasMore, "第一页存在后续记录时应标记 hasMore")
  assert(first.totalMatches === null, "无搜索时不需要计算匹配总数")

  const searched = paginateHistory(entries, 0, 1, "storage")
  assert(searched.entries[0].oid === "ccc333", "搜索结果应按历史顺序返回")
  assert(searched.totalMatches === 1, "搜索应返回匹配总数")
  assert(!searched.hasMore, "搜索结果已全部返回时不应继续加载")

  const normalized = paginateHistory(entries, -4, 0, "")
  assert(normalized.entries.length === 1, "非法分页参数应归一化为安全边界")
}

async function testFsErrorPropagation(): Promise<void> {
  const permissionError = errorWithCode("EACCES")
  const permissionManager = {
    readAsBytes: async () => {
      throw permissionError
    },
    exists: async () => {
      throw permissionError
    },
    remove: async () => {
      throw permissionError
    },
  } as any
  const permissionFs = createFS("/git", "/work", permissionManager)
  await assertRejects(
    () => permissionFs.readFile("file.txt"),
    (error) => error === permissionError,
    "读取权限错误必须原样传播"
  )
  await assertRejects(
    () => permissionFs.exists("file.txt"),
    (error) => error === permissionError,
    "exists 权限错误不能伪装成不存在"
  )
  await assertRejects(
    () => permissionFs.unlink("file.txt"),
    (error) => error === permissionError,
    "unlink 权限错误不能被吞掉"
  )

  const missingManager = {
    readAsBytes: async () => {
      throw errorWithCode(260)
    },
    exists: async () => {
      throw errorWithCode("ENOENT")
    },
    remove: async () => {
      throw errorWithCode("ENOENT")
    },
  } as any
  const missingFs = createFS("/git", "/work", missingManager)
  await assertRejects(
    () => missingFs.readFile("missing.txt"),
    (error) => error?.code === "ENOENT",
    "明确缺失错误应转换为 ENOENT"
  )
  assert(!(await missingFs.exists("missing.txt")), "缺失路径 exists 应返回 false")
  await missingFs.unlink("missing.txt")

  const removedPaths: string[] = []
  let directoryReadCount = 0
  const directoryEntries = new Map<string, string[]>([
    ["/work/1/2", []],
    ["/work/1", []],
    ["/work", []],
  ])
  const pruningManager = {
    remove: async (path: string) => {
      removedPaths.push(path)
    },
    readDirectory: async (path: string) => {
      directoryReadCount++
      return directoryEntries.get(path) || []
    },
  } as any
  const pruningFs = createFS("/git", "/work", pruningManager)
  await pruningFs.unlink("1/2/1.txt")
  await pruningFs.unlink("1/2/2.txt")
  assert(
    directoryReadCount === 0 &&
      removedPaths.join(",") === "/work/1/2/1.txt,/work/1/2/2.txt",
    "批量删除文件期间不得提前读取或删除父目录"
  )
  await pruningFs.pruneEmptyWorkdirParents()
  assert(
    removedPaths.join(",") ===
      "/work/1/2/1.txt,/work/1/2/2.txt,/work/1/2,/work/1",
    "checkout 完成后应逐级清理空父目录，但保留工作区根目录"
  )

  const keptPaths: string[] = []
  const nonEmptyManager = {
    remove: async (path: string) => {
      keptPaths.push(path)
    },
    readDirectory: async () => ["kept.txt"],
  } as any
  const nonEmptyFs = createFS("/git", "/work", nonEmptyManager)
  await nonEmptyFs.unlink("sub/deleted.txt")
  await nonEmptyFs.pruneEmptyWorkdirParents()
  assert(
    keptPaths.join(",") === "/work/sub/deleted.txt",
    "父目录仍有其它文件时不得删除目录"
  )

  const internalPaths: string[] = []
  const internalManager = {
    remove: async (path: string) => {
      internalPaths.push(path)
    },
    readDirectory: async () => {
      throw new Error("Git 内部文件删除不应扫描工作区父目录")
    },
  } as any
  const internalFs = createFS("/git", "/work", internalManager)
  await internalFs.unlink("shallow")
  assert(
    internalPaths.join(",") === "/git/shallow",
    "Git 内部路径删除不得触发工作区空目录清理"
  )

  // iOS 中文系统文案：clone/init 读尚未创建的 config 时必须映射为 ENOENT
  const chineseMissing = new Error('未能打开文件“config”，因为它不存在。')
  const chineseManager = {
    readAsBytes: async () => {
      throw chineseMissing
    },
    exists: async () => {
      throw chineseMissing
    },
    remove: async () => {
      throw chineseMissing
    },
    stat: async () => {
      throw chineseMissing
    },
    isDirectory: async () => {
      throw chineseMissing
    },
  } as any
  const chineseFs = createFS("/git", "/work", chineseManager)
  await assertRejects(
    () => chineseFs.readFile("config"),
    (error) => error?.code === "ENOENT",
    "中文缺失文案读 config 必须转换为 ENOENT"
  )
  await assertRejects(
    () => chineseFs.stat("config"),
    (error) => error?.code === "ENOENT",
    "中文缺失文案 stat config 必须转换为 ENOENT"
  )
  assert(!(await chineseFs.exists("config")), "中文缺失文案 exists 应返回 false")
  await chineseFs.unlink("config")

  // stat 并行 isDirectory；即使 FileStat.type 误报 file，目录仍应正确识别
  let isFileCalls = 0
  let isDirCalls = 0
  const typedStatManager = {
    stat: async () => ({
      // 模拟真机：目录也可能 type=file
      type: "file",
      size: 0,
      modificationDate: 1700000000000,
      creationDate: 1600000000000,
    }),
    isFile: async () => {
      isFileCalls++
      return false
    },
    isDirectory: async () => {
      isDirCalls++
      return true
    },
  } as any
  const typedFs = createFS("/git", "/work", typedStatManager)
  const dirStat = await typedFs.stat("src")
  assert(dirStat.isDirectory() === true, "isDirectory 优先于错误 type")
  assert(dirStat.isFile() === false, "目录不应是文件")
  assert(dirStat.type === "dir", "适配器 type 应为 dir")
  assert(isDirCalls === 1, "应调用一次 isDirectory")
  assert(isFileCalls === 0, "不应再调用 isFile")

  const fileStatManager = {
    stat: async () => ({
      type: "file",
      size: 12,
      modificationDate: 1700000000000,
      creationDate: 1600000000000,
    }),
    isDirectory: async () => false,
  } as any
  const fileFs = createFS("/git", "/work", fileStatManager)
  const fileStat = await fileFs.stat("a.txt")
  assert(fileStat.isFile() === true && fileStat.size === 12, "普通文件应识别为文件")

  // clean clone 会删除不存在的 shallow；中文系统可能只报“未能移除”
  const removeFailed = new Error('未能移除“Shallow”。')
  const shallowManager = {
    remove: async () => {
      throw removeFailed
    },
    exists: async () => false,
  } as any
  const shallowFs = createFS("/git", "/work", shallowManager)
  await shallowFs.unlink("shallow")
  await shallowFs.rmdir("shallow")

  // 路径仍存在时的移除失败必须继续抛出
  const stillThereManager = {
    remove: async () => {
      throw removeFailed
    },
    exists: async () => true,
  } as any
  const stillThereFs = createFS("/git", "/work", stillThereManager)
  await assertRejects(
    () => stillThereFs.unlink("shallow"),
    (error) => error === removeFailed,
    "路径仍存在时的移除失败不能被吞掉"
  )
}

async function testGitInternalPathMapping(): Promise<void> {
  const reads: string[] = []
  const writes: string[] = []
  const mkdirs: string[] = []
  const manager = {
    readAsBytes: async (path: string) => {
      reads.push(path)
      return new Uint8Array([1])
    },
    writeAsString: async (path: string) => {
      writes.push(path)
    },
    writeAsBytes: async (path: string) => {
      writes.push(path)
    },
    exists: async () => true,
    createDirectory: async (path: string) => {
      mkdirs.push(path)
    },
    readDirectory: async (path: string) => {
      reads.push("readdir:" + path)
      return []
    },
  } as any
  const fs = createFS("/git", "/work", manager)

  await fs.readFile("config")
  await fs.readFile("index")
  await fs.readFile("index.lock")
  await fs.readFile("refs/heads/main")
  await fs.readFile("index.ts")
  await fs.readFile("config.json")
  await fs.readFile("src/index.tsx")
  await fs.writeFile("description.md", "x")
  // 裸目录名：isomorphic-git 会 mkdir/readdir("refs")，必须进 gitdir
  await fs.mkdir("refs")
  await fs.mkdir("objects")
  await fs.mkdir("info")
  await fs.mkdir("hooks")
  await fs.mkdir("logs")
  await fs.readdir("refs")
  await fs.readdir("objects")

  assert(
    reads.includes("/git/config") &&
      reads.includes("/git/index") &&
      reads.includes("/git/index.lock"),
    "git 内部 config/index/index.lock 必须映射到 gitdir"
  )
  assert(
    reads.includes("/git/refs/heads/main"),
    "refs 目录必须映射到 gitdir"
  )
  assert(
    mkdirs.includes("/git/refs") &&
      mkdirs.includes("/git/objects") &&
      mkdirs.includes("/git/info") &&
      mkdirs.includes("/git/hooks") &&
      mkdirs.includes("/git/logs"),
    "裸 git 目录名 mkdir 必须映射到 gitdir"
  )
  assert(
    reads.includes("readdir:/git/refs") && reads.includes("readdir:/git/objects"),
    "裸 git 目录名 readdir 必须映射到 gitdir"
  )
  assert(
    reads.includes("/work/index.ts") &&
      reads.includes("/work/config.json") &&
      reads.includes("/work/src/index.tsx"),
    "工作区 index/config 前缀文件不得误入 gitdir"
  )
  assert(
    writes.includes("/work/description.md"),
    "工作区 description.md 不得映射到 gitdir/description"
  )
}

async function testCloneCleanup(): Promise<void> {
  const removed: string[] = []
  const created: string[] = []
  const bookmarks: string[] = []
  const manager = {
    exists: async () => true,
    remove: async (path: string) => removed.push(path),
    createDirectory: async (path: string) => created.push(path),
    bookmarkExists: () => true,
    removeFileBookmark: (name: string) => bookmarks.push(name),
  } as any

  await cleanupCloneAttempt("repo-id", "/parent/repo", true, "temp-bookmark", manager)
  assert(removed.includes("/parent/repo"), "失败克隆必须删除临时工作目录内容")
  assert(
    removed.some((path) => path.endsWith("/git-repos/repo-id")),
    "失败克隆必须删除 gitdir"
  )
  assert(created.includes("/parent/repo"), "原有空目录应在清理后恢复")
  assert(bookmarks.includes("temp-bookmark"), "失败克隆必须移除临时书签")
}

async function testSharedBookmarkCleanup(): Promise<void> {
  const previousRepos = readRepos()
  const bookmarks: string[] = []
  const manager = {
    exists: async () => true,
    remove: async () => undefined,
    createDirectory: async () => undefined,
    bookmarkExists: () => true,
    removeFileBookmark: (name: string) => bookmarks.push(name),
  } as any

  writeRepos([
    {
      name: "existing",
      bookmarkName: "existing-repo",
      repoId: "existing-repo",
      workdir: "/parent/existing",
      accessBookmarkName: "shared-bookmark",
      source: "clone",
      createdAt: 1,
    },
  ])
  try {
    await cleanupCloneAttempt(
      "failed-repo",
      "/parent/failed",
      false,
      "shared-bookmark",
      manager
    )
    assert(
      !bookmarks.includes("shared-bookmark"),
      "失败克隆不能删除仍被其它仓库使用的共享书签"
    )
  } finally {
    writeRepos(previousRepos)
  }
}

function testCommitTreeComparison(): void {
  const parent = new Map<string, string>([
    ["deleted.txt", "blob-deleted"],
    ["modified.txt", "blob-old"],
    ["same.txt", "blob-same"],
  ])
  const current = new Map<string, string>([
    ["added.txt", "blob-added"],
    ["modified.txt", "blob-new"],
    ["same.txt", "blob-same"],
  ])

  const changes = compareCommitTrees(parent, current)
  assert(changes.length === 3, "提交树比较应忽略未变化文件")
  assert(
    changes.map((change) => `${change.filepath}:${change.status}`).join(",") ===
      "added.txt:added,deleted.txt:deleted,modified.txt:modified",
    "提交树比较应按路径排序并正确区分新增、删除和修改"
  )

  const rootChanges = compareCommitTrees(new Map(), current)
  assert(
    rootChanges.every((change) => change.status === "added"),
    "根提交相对空树的所有文件都应标记为新增"
  )
}

function testLineDiff(): void {
  const largeOld = Array.from({ length: 5000 }, (_, index) => `line-${index}`)
  const largeNew = [...largeOld]
  largeNew[2500] = "line-changed"
  const largeDiff = lineDiff(largeOld, largeNew)
  assert(
    largeDiff.filter((line) => line.type === "add").length === 1 &&
      largeDiff.filter((line) => line.type === "del").length === 1,
    "大文件单行修改不能退化成整文件删除和新增"
  )
  assert(largeDiff.length < 20, "大文件 Diff 只应保留变更附近上下文")

  const githubLikeOld = Array.from({ length: 1600 }, (_, index) => `code-${index}`)
  const githubLikeNew = githubLikeOld.filter((_, index) => index < 700 || index >= 707)
  githubLikeNew.splice(900, 0, ...Array.from({ length: 362 }, (_, index) => `added-${index}`))
  const githubLikeDiff = lineDiff(githubLikeOld, githubLikeNew)
  assert(
    githubLikeDiff.filter((line) => line.type === "add").length === 362 &&
      githubLikeDiff.filter((line) => line.type === "del").length === 7,
    "大文件多处增删应与 GitHub 一样只统计实际变化行"
  )
  assert(githubLikeDiff.length < 400, "大文件多处增删不应渲染全部未变化代码")
  assert(
    githubLikeDiff.some((line) => line.type === "skip"),
    "多处变更之间应插入 skip 折叠行"
  )

  const lines = lineDiff(
    ["a", "unchanged", "old", "tail"],
    ["a", "unchanged", "new", "tail"]
  )
  assert(
    lines.some((line) => line.type === "context" && line.content === "a") &&
      lines.some((line) => line.type === "context" && line.content === "tail"),
    "小范围修改应保留未变化行，不能显示为整文件替换"
  )
  assert(
    lines.filter((line) => line.type === "add").length === 1 &&
      lines.filter((line) => line.type === "del").length === 1,
    "小范围修改应只显示一行新增和一行删除"
  )

  const crlf = lineDiff(["same"], ["same"])
  assert(crlf.length === 1 && crlf[0].type === "context", "相同行应识别为上下文")
}

function testFileTree(): void {
  const tree = buildFileTree([
    "README.md",
    "src/app/main.ts",
    "src/app/view.tsx",
    "src/index.ts",
    "tests/reliability.test.ts",
  ])
  assert(
    tree.map((node) => `${node.type}:${node.name}`).join(",") ===
      "directory:src,directory:tests,file:README.md",
    "文件树根节点应按目录优先、名称排序"
  )
  assert(
    tree[0].children.map((node) => node.name).join(",") === "app,index.ts",
    "一级目录应显示二级目录和文件"
  )
  assert(
    tree[0].children[0].children.map((node) => node.name).join(",") ===
      "main.ts,view.tsx",
    "二级目录应保留文件并按名称排序"
  )
}

function testSyncTopology(): void {
  const base = "c0"
  const localOnly = "cL"
  const remoteOnly = "cR"
  const sharedA = "cA"
  const sharedB = "cB"

  // 同 oid：已同步
  assert(
    JSON.stringify(
      computeSyncTopology(
        base,
        base,
        new Set([base]),
        new Set([base])
      )
    ) ===
      JSON.stringify({ ahead: 0, behind: 0, syncState: "upToDate" }),
    "相同提交应判定为 upToDate"
  )

  // 本地领先：base <- shared <- localOnly
  const aheadLocal = new Set([base, sharedA, localOnly])
  const aheadRemote = new Set([base, sharedA])
  const ahead = computeSyncTopology(
    localOnly,
    sharedA,
    aheadLocal,
    aheadRemote
  )
  assert(
    ahead.ahead === 1 && ahead.behind === 0 && ahead.syncState === "ahead",
    "仅本地多出的提交应计为 ahead"
  )

  // 远端领先
  const behind = computeSyncTopology(
    sharedA,
    remoteOnly,
    new Set([base, sharedA]),
    new Set([base, sharedA, remoteOnly])
  )
  assert(
    behind.ahead === 0 &&
      behind.behind === 1 &&
      behind.syncState === "behind",
    "仅远端多出的提交应计为 behind"
  )

  // 分叉：共同祖先后各自前进
  const diverged = computeSyncTopology(
    localOnly,
    remoteOnly,
    new Set([base, sharedA, sharedB, localOnly]),
    new Set([base, sharedA, remoteOnly])
  )
  assert(
    diverged.ahead === 2 &&
      diverged.behind === 1 &&
      diverged.syncState === "diverged",
    "分叉历史应同时统计 ahead/behind 并标记 diverged"
  )

  // 深历史：只统计对称差，不被固定深度截断
  const deepLocal = new Set<string>(["root"])
  const deepRemote = new Set<string>(["root"])
  for (let i = 0; i < 120; i++) deepLocal.add("L" + i)
  for (let i = 0; i < 80; i++) deepRemote.add("R" + i)
  const deep = computeSyncTopology("L119", "R79", deepLocal, deepRemote)
  assert(
    deep.ahead === 120 &&
      deep.behind === 80 &&
      deep.syncState === "diverged",
    "深历史分叉应按完整可达集合统计，而不是固定深度日志"
  )

  // 缺 oid 或空输入
  assert(
    computeSyncTopology(null, base, new Set(), new Set()).syncState ===
      "unknown",
    "缺少本地 oid 时应为 unknown"
  )
  assert(
    computeSyncTopology(base, undefined, new Set([base]), new Set()).syncState ===
      "unknown",
    "缺少远端 oid 时应为 unknown"
  )

  // merge-base 路径：由计数推导状态
  assert(
    JSON.stringify(topologyFromCounts(0, 0)) ===
      JSON.stringify({ ahead: 0, behind: 0, syncState: "upToDate" }),
    "0/0 应为 upToDate"
  )
  assert(
    topologyFromCounts(3, 0).syncState === "ahead" &&
      topologyFromCounts(3, 0).ahead === 3,
    "仅 ahead 计数"
  )
  assert(
    topologyFromCounts(0, 2).syncState === "behind",
    "仅 behind 计数"
  )
  assert(
    topologyFromCounts(2, 1).syncState === "diverged",
    "双向计数应为 diverged"
  )
  assert(
    topologyFromCounts(-1.2, 1.8).ahead === 0 &&
      topologyFromCounts(-1.2, 1.8).behind === 1,
    "负值与小数应规整"
  )
}

function testUploadFailureRecovery(): void {
  // 无 pending：需要新建远端
  const createTarget = resolveUploadRemoteTarget({
    requestedName: "demo-app",
  })
  assert(createTarget.shouldCreateRemote === true, "无 pending 时应创建远端")
  assert(createTarget.remoteUrl === null, "新建场景 remoteUrl 应为空")
  assert(createTarget.remoteName === "demo-app", "新建场景应使用请求名")

  // 有 pending：复用已创建远端，禁止重复建仓
  const retryTarget = resolveUploadRemoteTarget({
    pendingRemoteUrl: "https://github.com/u/demo-app.git",
    pendingRemoteName: "demo-app",
    requestedName: "renamed-should-not-create",
  })
  assert(
    retryTarget.shouldCreateRemote === false,
    "存在 pendingRemoteUrl 时不得再次 createRepo"
  )
  assert(
    retryTarget.remoteUrl === "https://github.com/u/demo-app.git",
    "重试应复用 pending 远端 URL"
  )
  assert(
    retryTarget.remoteName === "demo-app",
    "重试应优先使用 pending 远端名"
  )

  // pending 只有 URL 时名称回退到请求名
  const fallbackName = resolveUploadRemoteTarget({
    pendingRemoteUrl: "https://github.com/u/x.git",
    requestedName: "fallback",
  })
  assert(
    fallbackName.remoteName === "fallback",
    "pending 无名时 remoteName 回退到请求名"
  )

  const pendingPatch = buildUploadPendingPatch({
    url: "https://github.com/u/demo-app.git",
    name: "demo-app",
  })
  assert(
    pendingPatch.pendingRemoteUrl === "https://github.com/u/demo-app.git" &&
      pendingPatch.pendingRemoteName === "demo-app",
    "建仓成功后应写入 pending 字段供失败重试"
  )

  const successPatch = buildUploadSuccessPatch({
    remoteName: "demo-app",
    remoteUrl: "https://github.com/u/demo-app.git",
    pushBranch: "main",
  })
  assert(
    successPatch.source === "clone" &&
      successPatch.remoteUrl === "https://github.com/u/demo-app.git" &&
      successPatch.pendingRemoteUrl === undefined &&
      successPatch.pendingRemoteName === undefined &&
      successPatch.defaultBranch === "main",
    "推送成功后应清除 pending 并标记为 clone 来源"
  )

  // origin 回滚目标
  assert(
    desiredOriginAfterFailedPush({ url: "https://old.example/repo.git" })
      ?.url === "https://old.example/repo.git",
    "原先有 origin 时失败后应恢复原 URL"
  )
  assert(
    desiredOriginAfterFailedPush(null) === null,
    "原先无 origin 时失败后应删除临时 origin"
  )
  assert(
    desiredOriginAfterFailedPush(undefined) === null,
    "无原 origin 信息时回滚目标为 null"
  )
}

async function testRepoMutationLock(): Promise<void> {
  const locks = new Set<string>()
  const repoA = "/git-repos/repo-a"
  const repoB = "/git-repos/repo-b"

  assert(
    acquireRepoMutationLock(locks, repoA) === true,
    "空闲仓库应成功获取写锁"
  )
  assert(
    acquireRepoMutationLock(locks, repoA) === false,
    "同一仓库并发写操作应立即失败"
  )
  assert(
    acquireRepoMutationLock(locks, repoB) === true,
    "不同仓库之间应允许并行写操作"
  )

  // 模拟 in-flight 操作完成后 finally 释放
  let releasedInFinally = false
  try {
    // 已占用时外层应拒绝，不进入 operation
    if (!acquireRepoMutationLock(locks, repoA)) {
      // 预期路径
    } else {
      throw new Error("已占用锁不应再次获取成功")
    }
  } finally {
    // 模拟成功路径的 finally：只释放自己持有的锁
    releaseRepoMutationLock(locks, repoA)
    releasedInFinally = true
  }
  assert(releasedInFinally, "写操作 finally 必须执行")
  assert(!locks.has(repoA), "释放后同仓库应可再次获取锁")
  assert(
    acquireRepoMutationLock(locks, repoA) === true,
    "finally 释放后同仓库写操作应可重试"
  )
  // 上一断言只验证可重获，随即释放以免干扰后续失败路径
  releaseRepoMutationLock(locks, repoA)

  // 失败路径也必须释放
  let sawError = false
  try {
    if (!acquireRepoMutationLock(locks, repoA)) {
      throw new Error("测试准备失败：未能再次占用锁")
    }
    try {
      throw new Error("模拟写操作失败")
    } finally {
      releaseRepoMutationLock(locks, repoA)
    }
  } catch (error: any) {
    sawError = String(error?.message || error).includes("模拟写操作失败")
  }
  assert(sawError, "写操作失败应向上抛出")
  assert(!locks.has(repoA), "写操作失败后锁仍须释放")
  assert(locks.has(repoB), "释放 A 不得影响 B 的锁")
  releaseRepoMutationLock(locks, repoB)
  assert(locks.size === 0, "全部释放后锁集合应为空")
}

function testStageSelection(): void {
  // statusMatrix: [filepath, head, workdir, stage]
  const matrix = [
    ["clean.txt", 1, 1, 1],
    ["unstaged-mod.txt", 1, 2, 1],
    ["staged-mod.txt", 1, 2, 2],
    ["both-mod.txt", 1, 2, 3],
    ["unstaged-del.txt", 1, 0, 1],
    ["staged-del.txt", 1, 0, 0],
    ["untracked.txt", 0, 2, 0],
    ["staged-new.txt", 0, 2, 2],
    ["/leading-slash.txt", 1, 2, 1],
  ] as const

  const needStage = pathsNeedingStage(matrix)
  assert(
    needStage.join(",") ===
      "unstaged-mod.txt,both-mod.txt,unstaged-del.txt,untracked.txt,leading-slash.txt",
    "全部暂存应包含工作区与索引不同的路径（含删除与未跟踪）"
  )
  assert(
    !needStage.includes("clean.txt") &&
      !needStage.includes("staged-mod.txt") &&
      !needStage.includes("staged-del.txt") &&
      !needStage.includes("staged-new.txt"),
    "已与索引一致的路径不应再被全部暂存"
  )

  const needUnstage = pathsNeedingUnstage(matrix)
  assert(
    needUnstage.join(",") ===
      "staged-mod.txt,both-mod.txt,staged-del.txt,staged-new.txt",
    "全部取消暂存应包含索引相对 HEAD 有差异的路径"
  )
  assert(
    !needUnstage.includes("clean.txt") &&
      !needUnstage.includes("unstaged-mod.txt") &&
      !needUnstage.includes("unstaged-del.txt") &&
      !needUnstage.includes("untracked.txt"),
    "未进入索引的改动不应被取消暂存"
  )

  assert(
    stageActionForRow(["gone.txt", 1, 0, 1]) === "remove",
    "工作区删除应使用 remove 暂存"
  )
  assert(
    stageActionForRow(["file.txt", 1, 2, 1]) === "add",
    "工作区修改应使用 add 暂存"
  )
  assert(
    stageActionForRow(["same.txt", 1, 2, 2]) === "skip",
    "工作区与索引一致时应跳过"
  )
  assert(
    stageActionForRow(["", 1, 2, 1]) === "skip",
    "空路径应跳过"
  )
}

function testStashHelpers(): void {
  const raw = [
    "stash@{1}: WIP on main: abc1234 second",
    "malformed stash entry",
    "stash@{0}: WIP on main: def5678 first",
    "stash@{-1}: invalid",
    "stash@{2}:   ",
    // 幽灵项：缺 tab / 空消息，用户未真正保存，应过滤
    "stash@{3}: undefined",
  ]
  const entries = parseStashEntries(raw)
  assert(
    entries.length === 2 &&
      entries[0].ref === "stash@{0}" &&
      entries[0].message.includes("first") &&
      entries[1].index === 1 &&
      entries[1].message.includes("second"),
    "Stash 列表应只保留真实条目，过滤空消息与 undefined 幽灵项"
  )
  const ghosts = collectGhostStashIndices(raw)
  assert(
    ghosts.length === 2 && ghosts[0] === 3 && ghosts[1] === 2,
    "幽灵索引应按降序返回，便于安全 drop"
  )
  assert(parseStashEntries(null).length === 0, "非数组 stash 列表应返回空数组")

  // 多行 message 必须压成单行，避免拆坏 reflog
  assert(
    sanitizeStashMessage('Revert "x"\n\nThis reverts commit abc.') ===
      'Revert "x" This reverts commit abc.',
    "stash message 应压成单行"
  )
  assert(isValidOid("a".repeat(40)), "合法 40 hex 应通过")
  assert(!isValidOid("reverts"), "reverts 不应被视为 OID")

  const oidA = "a".repeat(40)
  const oidB = "b".repeat(40)
  const oidC = "c".repeat(40)
  const dirtyReflog =
    `0000000000000000000000000000000000000000 ${oidA} user me@x 1 +0000\tWIP on main\n` +
    `This reverts commit ${oidA}.\n` +
    `0000000000000000000000000000000000000000 ${oidB} user me@x 2 +0000\t修改\n` +
    `0000000000000000000000000000000000000000 ${oidC} user me@x 3 +0000\t最新\n`
  const repaired = repairStashReflogLines(dirtyReflog)
  assert(
    repaired.changed &&
      repaired.lines.length === 3 &&
      repaired.tipOid === oidC &&
      !repaired.lines.some((l) => l.includes("reverts")),
    "清洗应去掉 reverts 续行并保留合法 tip"
  )
  // 文件序旧→新：drop index 0 = 删 newest(oidC)
  const dropped = dropStashReflogAtIndex(repaired.lines, 0)
  assert(
    dropped.lines.length === 2 && dropped.tipOid === oidB,
    "drop newest 后 tip 应回退到前一条"
  )

  assert(
    isStatusMatrixClean([
      ["a.txt", 1, 1, 1],
      ["b.txt", 0, 0, 0],
    ]),
    "HEAD、工作区和索引一致时才能应用 Stash"
  )
  assert(
    !isStatusMatrixClean([["a.txt", 1, 2, 1]]),
    "存在工作区改动时不得应用 Stash"
  )
  assert(
    !isStatusMatrixClean([["a.txt", 1, 1, 2]]),
    "存在暂存改动时不得应用 Stash"
  )

  // reflog → newest-first oid 列表，再与 list 条目配对
  const oidsNewest = stashOidsNewestFirst(repaired.lines)
  assert(
    oidsNewest.length === 3 &&
      oidsNewest[0] === oidC &&
      oidsNewest[1] === oidB &&
      oidsNewest[2] === oidA,
    "stashOidsNewestFirst 应与 stash@{0..} 索引对齐"
  )
  const paired = pairStashEntriesWithOids(
    [
      { index: 0, ref: "stash@{0}", message: "最新" },
      { index: 2, ref: "stash@{2}", message: "最早" },
    ],
    oidsNewest
  )
  assert(
    paired[0].oid === oidC && paired[1].oid === oidA,
    "pairStashEntriesWithOids 应按 index 写入 oid"
  )
  assert(
    pairStashEntriesWithOids(
      [{ index: 9, ref: "stash@{9}", message: "越界" }],
      oidsNewest
    )[0].oid === undefined,
    "越界 index 不应伪造 oid"
  )
}

/**
 * 复现「克隆后切分支」假改动：两分支各有独占文件时，非 force checkout
 * 在自定义 FS 上可能残留旧文件；force checkout 后 statusMatrix 必须干净。
 */
function testRemoteHelpers(): void {
  const remotes = [
    { remote: "origin", url: "https://github.com/u/a.git" },
    { remote: "upstream", url: "git@github.com:org/b.git" },
  ]

  assert(validateRemoteName(" origin ") === "origin", "remote 名称应 trim")
  assert(validateRemoteUrl(" https://github.com/u/a.git/ ") === "https://github.com/u/a.git", "URL 应 trim 并去掉尾 /")
  assert(validateRemoteUrl("git@github.com:u/a.git") === "git@github.com:u/a.git", "scp-like URL 应合法")

  let sawNameError = false
  try {
    validateRemoteName("bad name")
  } catch (_e) {
    sawNameError = true
  }
  assert(sawNameError, "含空白的 remote 名称应拒绝")

  let sawUrlError = false
  try {
    validateRemoteUrl("not-a-url")
  } catch (_e) {
    sawUrlError = true
  }
  assert(sawUrlError, "非法 URL 应拒绝")

  assert(findRemote(remotes, "origin")?.url === "https://github.com/u/a.git", "应按名称查找 remote")
  assert(findRemote(remotes, "missing") === null, "缺失 remote 应返回 null")

  const add = assertCanAddRemote(remotes, "fork", "https://github.com/me/a.git")
  assert(add.remote === "fork" && add.url === "https://github.com/me/a.git", "添加规划应规范化名称与 URL")

  let sawDup = false
  try {
    assertCanAddRemote(remotes, "origin", "https://github.com/u/other.git")
  } catch (_e) {
    sawDup = true
  }
  assert(sawDup, "重复 remote 名称应拒绝添加")

  const setUrl = planSetRemoteUrl(
    remotes,
    "origin",
    "https://github.com/u/a-new.git"
  )
  assert(
    setUrl.remote === "origin" &&
      setUrl.nextUrl === "https://github.com/u/a-new.git" &&
      setUrl.previousUrl === "https://github.com/u/a.git" &&
      setUrl.rollback.action === "restore" &&
      setUrl.rollback.url === "https://github.com/u/a.git",
    "修改 URL 应记录旧值供回滚"
  )

  let sawSame = false
  try {
    planSetRemoteUrl(remotes, "origin", "https://github.com/u/a.git")
  } catch (_e) {
    sawSame = true
  }
  assert(sawSame, "相同 URL 修改应拒绝")

  const del = planDeleteRemote(remotes, "upstream")
  assert(
    del.remote === "upstream" &&
      del.previousUrl === "git@github.com:org/b.git" &&
      del.rollback.action === "restore",
    "删除规划应保留可回滚 URL"
  )

  let sawMissingDel = false
  try {
    planDeleteRemote(remotes, "nope")
  } catch (_e) {
    sawMissingDel = true
  }
  assert(sawMissingDel, "删除不存在的 remote 应失败")

  assert(
    normalizeUpstreamMerge("main") === "refs/heads/main",
    "短分支名应规范为 refs/heads/*"
  )
  assert(
    normalizeUpstreamMerge("refs/heads/develop") === "refs/heads/develop",
    "完整 merge ref 应保持"
  )

  const upstream = planSetUpstream(remotes, "feature", "origin", "main")
  assert(
    upstream.branch === "feature" &&
      upstream.remote === "origin" &&
      upstream.merge === "refs/heads/main" &&
      upstream.mergeBranch === "main",
    "设置 upstream 应校验 remote 并规范化 merge"
  )

  let sawBadUpstream = false
  try {
    planSetUpstream(remotes, "feature", "missing", "main")
  } catch (_e) {
    sawBadUpstream = true
  }
  assert(sawBadUpstream, "不存在的 remote 不能设为 upstream")

  assert(
    parseUpstreamConfig("origin", "refs/heads/main")?.remote === "origin",
    "完整 upstream 配置应解析成功"
  )
  assert(
    parseUpstreamConfig("origin", null) === null,
    "缺 merge 应视为未配置"
  )
  assert(
    formatUpstreamLabel({ remote: "origin", merge: "refs/heads/main" }) ===
      "origin/main",
    "无本地分支时 upstream 展示 remote/branch"
  )
  assert(
    formatUpstreamLabel(
      { remote: "origin", merge: "refs/heads/main" },
      "main"
    ) === "main ← origin/main",
    "有本地分支时与拉取 footer 同为 local ← remote/branch"
  )
  assert(formatUpstreamLabel(null) === "未设置", "无 upstream 时展示未设置")

  assert(
    shouldClearRepoRemoteUrlMeta("origin") === true,
    "删除 origin 后应清理 RepoMeta.remoteUrl"
  )
  assert(
    shouldClearRepoRemoteUrlMeta("upstream") === false,
    "删除非 origin 不应清理 meta remoteUrl"
  )
  assert(
    repoRemoteUrlMetaAfterChange("origin", "https://github.com/u/x.git") ===
      "https://github.com/u/x.git",
    "修改 origin 后 meta remoteUrl 应同步"
  )
  assert(
    repoRemoteUrlMetaAfterChange("upstream", "https://github.com/u/x.git") ===
      null,
    "非 origin 变更不写 meta remoteUrl"
  )
}

function testMergeConflictHelpers(): void {
  const data = {
    filepaths: ["a.txt", "b.txt", "c.txt", "/a.txt"],
    bothModified: ["a.txt"],
    deleteByUs: ["b.txt"],
    deleteByTheirs: ["c.txt"],
  }
  const files = buildConflictFilesFromErrorData(data)
  assert(
    files.map((f) => f.filepath + ":" + f.kind).join(",") ===
      "a.txt:bothModified,b.txt:deleteByUs,c.txt:deleteByTheirs",
    "应从 MergeConflictError.data 分类冲突文件并去重排序"
  )
  assert(conflictKindLabel("bothModified") === "双方修改", "冲突类型标签")

  const err = {
    code: "MergeConflictError",
    data,
    message: "Automatic merge failed",
  }
  assert(isMergeConflictError(err), "应按 code 识别 MergeConflictError")
  const errData = getMergeConflictErrorData(err)
  const errPaths = Array.isArray(errData?.filepaths)
    ? (errData!.filepaths as unknown[])
    : []
  assert(errPaths.length === 4, "应提取冲突 data")
  assert(!isMergeConflictError(new Error("network")), "普通错误不是冲突")

  const state = buildMergeState({
    oursOid: "a".repeat(40),
    theirsOid: "b".repeat(40),
    oursLabel: "main",
    theirsLabel: "origin/main",
    conflicts: files,
  })
  assert(state.version === 1 && state.conflicts.length === 3, "合并状态应可构建")
  const roundTrip = parseMergeState(serializeMergeState(state))
  assert(
    roundTrip != null &&
      roundTrip.oursOid === state.oursOid &&
      roundTrip.conflicts.length === 3,
    "合并状态应可序列化再解析"
  )
  assert(parseMergeState("{not json") === null, "非法 JSON 应返回 null")
  assert(parseMergeState({ version: 1 }) === null, "缺字段状态应返回 null")
  // 冲突全部解决后仍保留 ours/theirs，conflicts 可为空
  const pendingCommit = parseMergeState(
    serializeMergeState({
      ...state,
      conflicts: [],
    })
  )
  assert(
    pendingCommit != null &&
      pendingCommit.conflicts.length === 0 &&
      pendingCommit.oursOid === state.oursOid,
    "空冲突列表状态应可解析，供完成合并提交"
  )

  const afterOne = removeResolvedConflict(state, "a.txt")
  assert(
    afterOne != null && afterOne.conflicts.length === 2,
    "解决一个冲突后应保留其余项"
  )
  assert(
    removeResolvedConflict(afterOne!, "b.txt") != null,
    "仍有冲突时不得清空状态"
  )
  const onlyC = removeResolvedConflict(
    removeResolvedConflict(state, "a.txt")!,
    "b.txt"
  )!
  assert(
    removeResolvedConflict(onlyC, "c.txt") === null,
    "全部解决后状态应为 null"
  )

  assert(
    resolutionActionForConflict("bothModified", "ours") === "write",
    "双方修改选 ours 应写文件"
  )
  assert(
    resolutionActionForConflict("deleteByUs", "ours") === "remove",
    "我方删除冲突选 ours 应删除"
  )
  assert(
    resolutionActionForConflict("deleteByUs", "theirs") === "write",
    "我方删除冲突选 theirs 应写回对方内容"
  )
  assert(
    resolutionActionForConflict("deleteByTheirs", "theirs") === "remove",
    "对方删除冲突选 theirs 应删除"
  )
  assert(stageForResolution("ours") === 2, "ours 对应 stage 2")
  assert(stageForResolution("theirs") === 3, "theirs 对应 stage 3")

  assert(hasUnresolvedConflicts(files), "有冲突列表应视为未解决")
  assert(!hasUnresolvedConflicts([]), "空列表应视为已解决")

  assert(
    formatRepoListMergeSummary({ conflictCount: 3, mergeInProgress: true }) ===
      "3 冲突",
    "有未解决冲突时列表应显示冲突数"
  )
  assert(
    formatRepoListMergeSummary({ conflictCount: 0, mergeInProgress: true }) ===
      "待完成合并",
    "冲突已清但仍在合并时应提示待完成合并"
  )
  assert(
    formatRepoListMergeSummary({ conflictCount: 0, mergeInProgress: false }) ===
      null,
    "无合并状态时列表摘要应回落到普通改动文案"
  )

  // 面向 Agent 的冲突清单：包含仓库、目录、合并双方与逐文件类型
  const report = buildConflictReport({
    repoName: "demo",
    workdir: "/tmp/demo",
    oursLabel: state.oursLabel,
    theirsLabel: state.theirsLabel,
    oursOid: state.oursOid,
    theirsOid: state.theirsOid,
    conflicts: state.conflicts,
  })
  assert(report.includes("- 仓库：demo"), "清单应包含仓库名")
  assert(report.includes("- 目录：/tmp/demo"), "清单应包含工作目录")
  assert(
    report.includes("- 合并：origin/main (bbbbbbb) → main (aaaaaaa)"),
    "清单应包含合并双方标签与短 OID"
  )
  assert(report.includes("- 待解决：3 个文件"), "清单应包含冲突数量")
  assert(
    report.includes("1. `a.txt` — 双方修改") &&
      report.includes("2. `b.txt` — 我方删除 · 对方修改") &&
      report.includes("3. `c.txt` — 对方删除 · 我方修改"),
    "清单应逐行列出冲突文件与类型标签"
  )
  assert(
    report.includes("## 执行约束") &&
      report.includes("**严禁**执行 `git add`") &&
      report.includes("「完成合并提交」"),
    "清单应包含面向 Agent 的执行约束"
  )
  assert(
    report.includes("## 执行约束") &&
      report.includes("**严禁**执行 `git add`") &&
      report.includes("「完成合并提交」"),
    "清单应包含面向 Agent 的执行约束"
  )
  const reportNoDir = buildConflictReport({
    repoName: "",
    workdir: null,
    oursLabel: "main",
    theirsLabel: "origin/main",
    conflicts: [],
  })
  assert(
    reportNoDir.includes("- 仓库：未命名仓库") &&
      reportNoDir.includes("- 目录：（无法解析工作目录）") &&
      reportNoDir.includes("- 待解决：0 个文件"),
    "缺仓库名/目录时清单应使用占位文案"
  )

  // 冲突标记检测：严格行首 7 字符格式
  assert(
    containsConflictMarkers("const a = 1\n<<<<<<< HEAD\nconst b = 2"),
    "应识别 <<<<<<< 后跟空格"
  )
  assert(
    containsConflictMarkers(">>>>>>> origin/main\n") &&
      containsConflictMarkers("<<<<<<<"),
    "应识别 >>>>>>> 与行尾的 <<<<<<<"
  )
  assert(
    containsConflictMarkers("前半\n=======\n后半") &&
      containsConflictMarkers("=======\r\n后半"),
    "应识别独占一行的 7 个等号（含 CRLF）"
  )
  assert(
    !containsConflictMarkers("标题\n=====\n") &&
      !containsConflictMarkers("标题\n==========\n") &&
      !containsConflictMarkers("标题\n========\n"),
    "Markdown setext 下划线（非恰好 7 个等号）不应误报"
  )
  assert(
    !containsConflictMarkers(" <<<<<<< HEAD") &&
      !containsConflictMarkers("<<<<<<<< HEAD") &&
      !containsConflictMarkers("普通文本\n没有标记"),
    "前导空格、8 个尖括号、无标记文本不应误报"
  )

  // 自动标记摘要文案
  const allMarked = formatAutoMarkSummary({
    marked: ["a.txt", "b.txt"],
    markerFiles: [],
    unchangedDeleteFiles: [],
    failedFiles: [],
  })
  assert(
    allMarked.title === "检测完成" &&
      allMarked.message.includes("已自动标记 2 个文件") &&
      allMarked.message.includes("无残留冲突"),
    "全部标记时应提示无残留冲突"
  )
  const partial = formatAutoMarkSummary({
    marked: ["a.txt"],
    markerFiles: ["b.txt"],
    unchangedDeleteFiles: ["delete.txt"],
    failedFiles: ["c.bin"],
  })
  assert(
    partial.title === "部分文件未解决" &&
      partial.message.includes("已标记 1 个文件") &&
      partial.message.includes("b.txt（仍含冲突标记）") &&
      partial.message.includes("delete.txt（删除冲突尚未决定保留或删除）") &&
      partial.message.includes("c.bin（读取或标记失败）"),
    "部分标记时应列明未解决文件与原因"
  )
  const noneMarked = formatAutoMarkSummary({
    marked: [],
    markerFiles: ["b.txt"],
    unchangedDeleteFiles: [],
    failedFiles: [],
  })
  assert(
    noneMarked.title === "未能自动标记" &&
      !noneMarked.message.includes("已标记"),
    "未标记任何文件时不应出现已标记文案"
  )

  const parents = mergeCommitParents("a".repeat(40), "b".repeat(40))
  assert(
    parents[0] === "a".repeat(40) && parents[1] === "b".repeat(40),
    "合并提交双亲顺序应为 ours, theirs"
  )
  assert(
    defaultMergeCommitMessage("origin/main", "main") ===
      "Merge origin/main into main",
    "默认合并说明应含双方标签"
  )
}

function testBranchMergeHelpers(): void {
  assert(
    normalizeBranchMergeSource("  refs/heads/hua  ") === "hua",
    "应去掉 refs/heads/ 前缀"
  )
  assert(
    normalizeBranchMergeSource("refs/remotes/origin/dev") === "origin/dev",
    "应去掉 refs/remotes/ 前缀并保留 remote/branch"
  )
  assert(
    normalizeBranchMergeSource("origin/main") === "origin/main",
    "origin/ 形式应原样保留"
  )

  const planned = planMergeIntoCurrent("main", "feature")
  assert(
    planned.current === "main" && planned.source === "feature",
    "规划合并应返回规范化 current/source"
  )
  assert(
    planMergeIntoCurrent("main", "refs/heads/hua").source === "hua",
    "规划合并应规范化源分支名"
  )

  let selfMergeBlocked = false
  try {
    planMergeIntoCurrent("main", "main")
  } catch (_e) {
    selfMergeBlocked = true
  }
  assert(selfMergeBlocked, "禁止将当前分支合并进自身")

  let originSelfBlocked = false
  try {
    planMergeIntoCurrent("main", "origin/main")
  } catch (_e) {
    originSelfBlocked = true
  }
  assert(originSelfBlocked, "禁止将 origin/当前 合并进当前（自合并）")

  let emptySourceBlocked = false
  try {
    planMergeIntoCurrent("main", "  ")
  } catch (_e) {
    emptySourceBlocked = true
  }
  assert(emptySourceBlocked, "空源分支应拒绝")

  // Pull 目标：无 upstream 回退 origin/同名
  const fallback = resolvePullTarget({
    localBranch: "main",
    remote: "origin",
    upstream: null,
  })
  assert(
    fallback.remote === "origin" &&
      fallback.remoteBranch === "main" &&
      !fallback.usedUpstream,
    "无 upstream 应回退 origin/同名"
  )

  // 有 upstream：可跨 remote / 不同名分支
  const withUp = resolvePullTarget({
    localBranch: "main",
    remote: "origin",
    upstream: { remote: "upstream", merge: "refs/heads/main" },
  })
  assert(
    withUp.remote === "upstream" &&
      withUp.remoteBranch === "main" &&
      withUp.usedUpstream &&
      withUp.track === "upstream/main",
    "有 upstream 应按配置解析"
  )

  const cross = resolvePullTarget({
    localBranch: "main",
    remote: "origin",
    upstream: { remote: "origin", merge: "hua" },
  })
  assert(
    cross.remoteBranch === "hua" &&
      cross.localBranch === "main" &&
      cross.usedUpstream,
    "upstream 可指定不同名远端分支"
  )

  // 显式 ref 忽略 upstream（push 前先拉）
  const explicit = resolvePullTarget({
    localBranch: "main",
    remote: "origin",
    explicitRef: "feature",
    upstream: { remote: "upstream", merge: "refs/heads/main" },
  })
  assert(
    explicit.localBranch === "feature" &&
      explicit.remoteBranch === "feature" &&
      !explicit.usedUpstream,
    "显式 ref 应忽略 upstream 并固定同名"
  )

  const upToDatePull = formatPullSuccessAlert({
    status: "upToDate",
    branch: "main",
    remote: "origin",
    remoteBranch: "main",
    usedUpstream: false,
  })
  assert(upToDatePull.title === "已是最新", "Pull 无新提交标题应为已是最新")
  assert(
    upToDatePull.message.includes("origin/main"),
    "已是最新文案应含跟踪目标"
  )

  const crossPull = formatPullSuccessAlert({
    status: "updated",
    branch: "main",
    remote: "origin",
    remoteBranch: "hua",
    usedUpstream: true,
  })
  assert(
    crossPull.message.includes("origin/hua") &&
      crossPull.message.includes("main"),
    "跨名 Pull 文案应写明 track 与本地分支"
  )

  const updatedPull = formatPullSuccessAlert({
    status: "updated",
    branch: "dev",
    remote: "origin",
    remoteBranch: "dev",
    usedUpstream: false,
  })
  assert(updatedPull.title === "拉取成功", "Pull 更新标题应为拉取成功")
  assert(
    updatedPull.message.includes("origin/dev") &&
      updatedPull.message.includes("dev"),
    "拉取成功文案应写明 origin/分支 → 当前"
  )

  const upToDateMerge = formatMergeSuccessAlert({
    status: "upToDate",
    ours: "main",
    theirs: "feature",
  })
  assert(upToDateMerge.title === "无需合并", "同源提交合并标题应为无需合并")

  const merged = formatMergeSuccessAlert({
    status: "merged",
    ours: "main",
    theirs: "origin/hua",
  })
  assert(merged.title === "合并成功", "合并成功标题")
  assert(
    merged.message.includes("origin/hua") && merged.message.includes("main"),
    "合并成功文案应含源与目标"
  )

  assert(
    pullActionFooterHint("main") === "远端拉取：main ← origin/main",
    "无 upstream 时 footer 默认 origin/同名"
  )
  assert(
    pullActionFooterHint("main", {
      remote: "upstream",
      merge: "refs/heads/main",
    }) === "远端拉取：main ← upstream/main",
    "有 upstream 时 footer 应展示实际跟踪"
  )
  assert(
    pullActionFooterHint("").includes("拉取"),
    "无当前分支时 footer 仍应给出说明"
  )
}

async function testRemoteProgressHelpers(): Promise<void> {
  assert(progressPercent(50, 100) === 50, "50/100 应为 50%")
  assert(progressPercent(0, 100) === 0, "0/100 应为 0%")
  assert(progressPercent(100, 100) === 100, "100/100 应为 100%")
  assert(progressPercent(3, 0) === null, "total=0 无法算百分比")
  assert(progressPercent(undefined, 10) === null, "loaded 缺失时无百分比")
  assert(progressPercent(1.2, 3) === 40, "非整数 loaded 应四舍五入")

  assert(
    localizeProgressPhase("Receiving objects") === "接收对象",
    "应本地化 Receiving objects"
  )
  assert(
    localizeProgressPhase("Updating workdir") === "更新工作区",
    "应本地化 Updating workdir"
  )
  assert(
    localizeProgressPhase("Connecting") === "连接远端",
    "应本地化 Connecting"
  )
  assert(
    localizeProgressPhase("Uploading") === "上传对象",
    "应本地化 Uploading"
  )
  assert(
    localizeProgressPhase("Downloading") === "下载中",
    "应本地化 Downloading"
  )
  assert(
    localizeProgressPhase("Custom Phase") === "Custom Phase",
    "未知 phase 原样保留"
  )
  assert(localizeProgressPhase("") === "进行中", "空 phase 应为进行中")

  assert(
    formatRemoteProgress({ phase: "Receiving objects", loaded: 25, total: 100 }) ===
      "接收对象 25%",
    "有 total 时应带百分比"
  )
  assert(
    formatRemoteProgress({ phase: "Resolving deltas" }) === "解析增量",
    "无 total 时仅 phase"
  )
  assert(
    formatBusyWithPercent("推送中", 50) === "推送中…（50%）",
    "忙态文案应含百分比"
  )
  assert(
    formatBusyWithPercent("拉取中…", null) === "拉取中…",
    "无百分比时仅省略号"
  )
  assert(
    formatBusyWithPercent("克隆中", 0) === "克隆中…（0%）",
    "0% 也应展示"
  )
  assert(
    formatBusyActionLabel("推送中", { percent: 50, phase: "写入对象" }) ===
      "推送中…（50%）",
    "有百分比时优先显示百分比"
  )
  assert(
    formatBusyActionLabel("拉取中", { percent: null, phase: "接收对象" }) ===
      "拉取中…（接收对象）",
    "无百分比时 phase 也用括号"
  )
  assert(
    formatBusyActionLabel("推送中", { phase: "先拉取最新" }) ===
      "推送中…（先拉取最新）",
    "先拉取最新应与进度同为括号风格"
  )
  assert(
    formatBusyActionLabel("克隆中", null) === "克隆中…",
    "无进度信息时仅基词"
  )

  const info = toRemoteProgressInfo({
    phase: "Writing objects",
    loaded: 10,
    total: 40,
  })
  assert(info.phase === "写入对象", "快照 phase 应本地化")
  assert(info.percent === 25, "快照 percent 应为 25")
  assert(info.label.includes("25%"), "快照 label 应含百分比")

  const cancelled = createRemoteCancelledError()
  assert(
    (cancelled as any).code === REMOTE_OPERATION_CANCELLED,
    "取消错误应带 code"
  )
  assert(isRemoteOperationCancelled(cancelled), "应识别取消错误")
  assert(
    !isRemoteOperationCancelled(new Error("网络失败")),
    "普通错误不应判为取消"
  )
  assert(
    isRemoteOperationCancelled({ message: "操作已取消" }),
    "message 含操作已取消也应识别"
  )

  const token = new RemoteCancelToken()
  assert(!token.isCancelled, "新建 token 未取消")
  let threw = false
  try {
    token.throwIfCancelled()
  } catch (_e) {
    threw = true
  }
  assert(!threw, "未取消时 throwIfCancelled 不应抛")
  token.cancel()
  assert(token.isCancelled, "cancel 后 isCancelled 为 true")
  let cancelThrew = false
  try {
    token.throwIfCancelled()
  } catch (e) {
    cancelThrew = isRemoteOperationCancelled(e)
  }
  assert(cancelThrew, "取消后 throwIfCancelled 应抛取消错误")

  // onProgress 现为 async：回调内 cancel 后，同一次 await 末尾检查点抛出
  const token2 = new RemoteCancelToken()
  const labels: string[] = []
  const onProgress = createGitOnProgress({
    cancelToken: token2,
    onProgress: (p) => {
      labels.push(p.label)
      token2.cancel()
    },
  })
  assert(typeof onProgress === "function", "有 options 时应返回 onProgress")
  let midThrew = false
  try {
    await onProgress!({ phase: "Receiving objects", loaded: 1, total: 10 })
  } catch (e) {
    midThrew = isRemoteOperationCancelled(e)
  }
  assert(labels.length === 1, "取消前应先回调进度")
  assert(midThrew, "回调内 cancel 后同次 onProgress 应抛出")

  // 已取消 token 再次进入 onProgress 应在入口即抛
  let entryThrew = false
  try {
    await onProgress!({ phase: "Receiving objects", loaded: 2, total: 10 })
  } catch (e) {
    entryThrew = isRemoteOperationCancelled(e)
  }
  assert(entryThrew, "取消后再次 onProgress 应抛出")

  assert(
    createGitOnProgress(undefined) === undefined,
    "无 options 时不挂 onProgress"
  )
  assert(
    createGitOnProgress({}) === undefined,
    "空 options 时不挂 onProgress"
  )

  // 手动检查点进度：应回调 UI 并在取消后抛出
  const emitted: string[] = []
  await emitRemoteProgress(
    {
      onProgress: (info) => {
        emitted.push(info.phase)
      },
    },
    "Connecting"
  )
  assert(emitted[0] === "连接远端", "emitRemoteProgress 应本地化 phase")

  const emitToken = new RemoteCancelToken()
  emitToken.cancel()
  let emitCancelThrew = false
  try {
    await emitRemoteProgress(
      {
        cancelToken: emitToken,
        onProgress: () => {
          emitted.push("should-not-run")
        },
      },
      "Uploading"
    )
  } catch (e) {
    emitCancelThrew = isRemoteOperationCancelled(e)
  }
  assert(emitCancelThrew, "已取消时 emitRemoteProgress 应抛出")
  assert(
    !emitted.includes("should-not-run"),
    "已取消时不应再回调 onProgress"
  )
}

async function testForceCheckoutCleansWorktree(): Promise<void> {
  const root =
    FileManager.appGroupDocumentsDirectory +
    "/gitgit-tests/force-checkout-" +
    Date.now()
  const workdir = root + "/work"
  const gitdir = root + "/git"
  await FileManager.createDirectory(workdir, true)
  await FileManager.createDirectory(gitdir, true)

  try {
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, workdir)
    const author = { name: "gitgit", email: "gitgit@local" }

    await git.init({ fs, dir: workdir, gitdir, defaultBranch: "main" })
    await fs.writeFile("shared.txt", "shared\n")
    await fs.writeFile("only-main.txt", "main\n")
    await fs.writeFile("1/2/1.txt", "nested one\n")
    await fs.writeFile("1/2/2.txt", "nested two\n")
    await git.add({ fs, dir: workdir, gitdir, filepath: "." })
    await git.commit({
      fs,
      dir: workdir,
      gitdir,
      message: "main base",
      author,
    })

    await git.branch({
      fs,
      dir: workdir,
      gitdir,
      ref: "feature",
      checkout: true,
    })
    // feature 删除 only-main，新增 only-feature
    await fs.unlink("only-main.txt")
    await fs.unlink("1/2/1.txt")
    await fs.unlink("1/2/2.txt")
    await git.remove({
      fs,
      dir: workdir,
      gitdir,
      filepath: "only-main.txt",
    })
    await git.remove({
      fs,
      dir: workdir,
      gitdir,
      filepath: "1/2/1.txt",
    })
    await git.remove({
      fs,
      dir: workdir,
      gitdir,
      filepath: "1/2/2.txt",
    })
    await fs.writeFile("only-feature.txt", "feature\n")
    await git.add({ fs, dir: workdir, gitdir, filepath: "." })
    await git.commit({
      fs,
      dir: workdir,
      gitdir,
      message: "feature exclusive",
      author,
    })

    // 模拟旧路径：非 force 切回 main 后，若残留 only-feature 会成假 *added
    await git.checkout({ fs, dir: workdir, gitdir, ref: "main" })
    // 再强制切到 feature，应删 only-main、写出 only-feature，且无假改动
    await git.checkout({
      fs,
      dir: workdir,
      gitdir,
      ref: "feature",
      force: true,
    })
    await fs.pruneEmptyWorkdirParents()

    const hasMainOnly = await fs.exists("only-main.txt")
    const hasFeatureOnly = await fs.exists("only-feature.txt")
    assert(!hasMainOnly, "force checkout 到 feature 后应删除 only-main.txt")
    assert(hasFeatureOnly, "force checkout 到 feature 后应写出 only-feature.txt")
    assert(
      !(await fs.exists("1/2/1.txt")) &&
        !(await fs.exists("1/2/2.txt")) &&
        !(await fs.exists("1/2")),
      "同目录多文件删除后应清理空目录"
    )

    const matrix = (await git.statusMatrix({
      fs,
      dir: workdir,
      gitdir,
    })) as [string, number, number, number][]
    assert(
      isStatusMatrixClean(matrix),
      "force checkout 后工作区与 index 必须干净，不得出现上一分支假改动"
    )

    // 再 force 回 main，对称验证
    await git.checkout({
      fs,
      dir: workdir,
      gitdir,
      ref: "main",
      force: true,
    })
    await fs.pruneEmptyWorkdirParents()
    assert(
      (await fs.exists("only-main.txt")) &&
        !(await fs.exists("only-feature.txt")) &&
        (await fs.exists("1/2/1.txt")) &&
        (await fs.exists("1/2/2.txt")),
      "force checkout 回 main 应恢复分支独占文件和嵌套文件"
    )
    const matrixMain = (await git.statusMatrix({
      fs,
      dir: workdir,
      gitdir,
    })) as [string, number, number, number][]
    assert(
      isStatusMatrixClean(matrixMain),
      "force checkout 回 main 后也应干净"
    )
  } finally {
    try {
      await FileManager.remove(root)
    } catch (_e) {
      /* 测试清理失败不阻断 */
    }
  }
}

async function testRollbackAndForcePushIntegration(): Promise<void> {
  const root =
    FileManager.appGroupDocumentsDirectory +
    "/gitgit-tests/rollback-force-push-" +
    Date.now()
  const workdir = root + "/work"
  const bookmarkName = "rollback-test-" + Date.now()
  const gitdir =
    FileManager.appGroupDocumentsDirectory + "/git-repos/" + bookmarkName
  const previousRepos = readRepos()
  await FileManager.createDirectory(workdir, true)
  await FileManager.createDirectory(gitdir, true)
  writeRepos([
    ...previousRepos,
    {
      name: bookmarkName,
      bookmarkName,
      repoId: bookmarkName,
      workdir,
      source: "local",
      createdAt: Date.now(),
    },
  ])

  try {
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, workdir)
    const author = { name: "gitgit", email: "gitgit@local" }
    const baseOptions = { fs, dir: workdir, gitdir }

    await git.init({ ...baseOptions, defaultBranch: "main" })
    await fs.writeFile("state.txt", "base\n")
    await git.add({ ...baseOptions, filepath: "state.txt" })
    const targetOid = await git.commit({
      ...baseOptions,
      message: "target",
      author,
    })
    await fs.writeFile("state.txt", "published later\n")
    await fs.writeFile("later.txt", "later\n")
    await git.add({ ...baseOptions, filepath: "." })
    const laterOid = await git.commit({
      ...baseOptions,
      message: "later",
      author,
    })

    const pushed: Array<{ branch: string; force: boolean }> = []
    const branch = await resetToCommitAndPushInternal(
      bookmarkName,
      targetOid,
      async (currentBranch, force) => {
        pushed.push({ branch: currentBranch, force })
      }
    )
    assert(branch === "main", "回滚应返回当前命名分支")
    assert(
      pushed.length === 1 && pushed[0].branch === "main" && pushed[0].force,
      "本地回滚成功后应以当前分支执行强推"
    )
    assert(
      (await git.resolveRef({ ...baseOptions, ref: "refs/heads/main" })) ===
        targetOid,
      "回滚应将本地分支 ref 移到目标提交"
    )
    assert(
      (await git.resolveRef({ ...baseOptions, ref: "HEAD" })) === targetOid,
      "回滚后 HEAD 应指向目标提交"
    )
    assert((await fs.readFile("state.txt", "utf8")) === "base\n", "回滚应恢复目标文件")
    assert(!(await fs.exists("later.txt")), "回滚应删除目标提交之后新增的文件")
    assert(
      isStatusMatrixClean(
        (await git.statusMatrix(baseOptions)) as [string, number, number, number][]
      ),
      "回滚并强推前后的工作区应保持干净"
    )

    // 强推失败不应回滚已经完成的本地 reset；上层需要据此提示远端仍是旧历史。
    const remoteFailure = new Error("push failed")
    await assertRejects(
      () =>
        resetToCommitAndPushInternal(bookmarkName, laterOid, async () => {
          throw remoteFailure
        }),
      (error) => error === remoteFailure,
      "强推失败应向上抛出原错误"
    )
    assert(
      (await git.resolveRef({ ...baseOptions, ref: "refs/heads/main" })) ===
        laterOid,
      "强推失败不应伪造成功，但本地 reset 的实际结果应保留"
    )

    await fs.writeFile("state.txt", "dirty\n")
    let dirtyPushCalled = false
    await assertRejects(
      () =>
        resetToCommitAndPushInternal(bookmarkName, targetOid, async () => {
          dirtyPushCalled = true
        }),
      (error) =>
        String(error?.message || error).includes("工作区有未提交改动"),
      "脏工作区应在 reset 和强推前被拒绝"
    )
    assert(!dirtyPushCalled, "脏工作区拒绝后不得调用强推")
    assert(
      (await git.resolveRef({ ...baseOptions, ref: "refs/heads/main" })) ===
        laterOid,
      "脏工作区拒绝后不得移动本地分支"
    )
  } finally {
    writeRepos(previousRepos)
    try {
      await FileManager.remove(root)
      await FileManager.remove(gitdir)
    } catch (_e) {
      /* 测试清理失败不阻断 */
    }
  }
}

function testRemoteBranchNormalization(): void {
  const branches = normalizeRemoteBranches(
    [
      "upstream/main",
      "upstream/feature/nested",
      "upstream/HEAD",
      "upstream/main",
      "topic/upstream/keep",
      "",
    ],
    "upstream"
  )
  assert(
    branches.join(",") === "feature/nested,main,topic/upstream/keep",
    "远端分支应去前缀、过滤 HEAD、去重并保留多级名称"
  )
}

function testBranchHelpers(): void {
  const locals = ["main", "feature/login", "release-1.2"]

  assert(normalizeBranchName(" refs/heads/main ") === "main", "应去掉 refs/heads/ 前缀并 trim")
  assert(stripRemotePrefix("origin/dev") === "dev", "应去掉 origin/ 前缀")
  assert(stripRemotePrefix("dev") === "dev", "无前缀时保持原名")

  assert(validateBranchName(" feature/x ") === "feature/x", "合法分支名应 trim")
  const badNames = ["", "a b", "a~b", "a^b", "a:b", "/a", "a/", ".a", "a.", "a..b", "a//b", "a@{b", "a.lock"]
  for (const bad of badNames) {
    let threw = false
    try {
      validateBranchName(bad)
    } catch (_e) {
      threw = true
    }
    assert(threw, "非法分支名应拒绝：" + JSON.stringify(bad))
  }

  assert(branchExists(locals, "feature/login"), "应能找到已有分支")
  assert(branchExists(locals, "refs/heads/main"), "应能匠配去前缀后的名")
  assert(!branchExists(locals, "nope"), "不存在的分支应返回 false")

  const del = planDeleteBranch(locals, "main", "feature/login")
  assert(del.branch === "feature/login", "删除规划应返回目标分支")

  let sawCurrent = false
  try {
    planDeleteBranch(locals, "main", "main")
  } catch (_e) {
    sawCurrent = true
  }
  assert(sawCurrent, "不能删除当前分支")

  let sawMissingDel = false
  try {
    planDeleteBranch(locals, "main", "ghost")
  } catch (_e) {
    sawMissingDel = true
  }
  assert(sawMissingDel, "删除不存在的分支应失败")

  const ren = planRenameBranch(locals, "main", "release-1.2", "release-1.3")
  assert(ren.from === "release-1.2" && ren.to === "release-1.3" && ren.isCurrent === false, "重命名规划应返回 from/to 与非当前")

  const renCur = planRenameBranch(locals, "main", "main", "dev")
  assert(renCur.isCurrent === true, "重命名当前分支应标记 isCurrent")

  let sawSameName = false
  try {
    planRenameBranch(locals, "main", "main", "main")
  } catch (_e) {
    sawSameName = true
  }
  assert(sawSameName, "新名与原名相同应拒绝")

  let sawConflict = false
  try {
    planRenameBranch(locals, "main", "release-1.2", "main")
  } catch (_e) {
    sawConflict = true
  }
  assert(sawConflict, "重命名到已有分支应拒绝")

  const remoteDel = planDeleteRemoteBranch("origin", "origin/feature/x")
  assert(remoteDel.remote === "origin" && remoteDel.branch === "feature/x" && remoteDel.track === "origin/feature/x", "删除远端分支应去前缀并给出 track")

  let sawBadRemote = false
  try {
    planDeleteRemoteBranch("origin", "origin/")
  } catch (_e) {
    sawBadRemote = true
  }
  assert(sawBadRemote, "空远端分支名应拒绝")
}

// 提交信息「标题 + 补充说明」拆分与重组必须无损，否则重编会丢描述
function testCommitMessageParts(): void {
  const message = buildCommitMessage("修复登录", "顺带补充了错误提示文案")
  assert(commitTitle(message) === "修复登录", "标题应为首行")
  assert(
    commitBody(message) === "顺带补充了错误提示文案",
    "正文应为首行之后的内容"
  )
  assert(
    buildCommitMessage(commitTitle(message), commitBody(message)) === message,
    "拆分后重组应还原原提交信息"
  )

  assert(commitBody("只有标题") === "", "无正文时应返回空串")
  assert(
    buildCommitMessage(commitTitle("只有标题"), commitBody("只有标题")) ===
      "只有标题",
    "无正文时重组不应追加空行"
  )

  const multiline = "标题\n\n第一段\n第二段"
  assert(
    commitBody(multiline) === "第一段\n第二段",
    "多行正文应保留内部换行"
  )
}

function testSuggestedCommitTitle(): void {
  const change = (
    filepath: string,
    status: "added" | "modified" | "deleted" | "*modified",
    staged = true
  ) => ({ filepath, status, staged, unstaged: false })

  assert(
    suggestCommitTitle([change("src/index.ts", "added")]) === "新增 src/index.ts",
    "单个新增文件应使用新增标题"
  )
  assert(
    suggestCommitTitle([change("README.md", "modified")]) === "更新 README.md",
    "单个修改文件应使用更新标题"
  )
  assert(
    suggestCommitTitle([change("legacy.ts", "deleted")]) === "删除 legacy.ts",
    "单个删除文件应使用删除标题"
  )
  assert(
    suggestCommitTitle([
      change("a.ts", "modified"),
      change("b.ts", "added"),
      change("draft.ts", "*modified", false),
    ]) === "更新 2 个文件",
    "多文件标题应只统计已暂存文件"
  )
  assert(
    suggestCommitTitle([change("draft.ts", "*modified", false)]) === "",
    "没有已暂存文件时不应生成标题"
  )
}

async function main(): Promise<void> {
  testBranchLastPulledAt()
  testGithubUserCache()
  testHistoryPagination()
  await testFsErrorPropagation()
  await testGitInternalPathMapping()
  await testCloneCleanup()
  await testSharedBookmarkCleanup()
  testCommitTreeComparison()
  testLineDiff()
  testFileTree()
  testSyncTopology()
  testUploadFailureRecovery()
  await testRepoMutationLock()
  testStageSelection()
  testStashHelpers()
  testRemoteHelpers()
  testMergeConflictHelpers()
  testBranchMergeHelpers()
  testRemoteBranchNormalization()
  testBranchHelpers()
  await testRemoteProgressHelpers()
  await testForceCheckoutCleansWorktree()
  await testRollbackAndForcePushIntegration()
  testCommitMessageParts()
  testSuggestedCommitTitle()
  console.log("✅ reliability tests passed")
}

main()
  .then(() => Script.exit("reliability tests passed"))
  .catch((error) => {
    console.error(error)
    throw error
  })
