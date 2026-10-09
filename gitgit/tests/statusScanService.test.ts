/**
 * tests/statusScanService.test.ts - 状态扫描服务的并发共享、代次与缓存语义
 *
 * 全部使用模拟 GitContext（git.statusMatrix 为受 gate 控制的 mock，fs 为 null，
 * mock 不访问文件系统），并给每个用例分配唯一仓库 key，
 * 既不读写真机用户仓库，也不写 Storage 仓库列表。
 */
import { Script } from "scripting"
import type { RepoListStatus } from "../types/git"
import { resolveGitdir, type GitContext } from "../services/git/runtime"
import {
  cacheRepoStatus,
  canPublishStatus,
  getCachedRepoStatus,
  rememberChangesCount,
  runStatusMutation,
  runStatusRead,
  scanStatusMatrix,
  statusRevision,
  validatedChangesCount,
  type StatusMatrix,
} from "../services/git/statusScanService"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 让出事件循环：一次性冲干当前挂起的微任务（协调器全部走微任务） */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function expectReject(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("断言失败: 期望 Promise 被拒绝")
}

/** 唯一仓库 key：resolveGitdir 只做字符串归一，不写 Storage */
let sequence = 0
function uniqueName(tag: string): string {
  sequence++
  return `zz-scan-test-${tag}-${sequence}-${Date.now().toString(36)}`
}

function makeMatrix(rows: number): StatusMatrix {
  return Array.from({ length: rows }, (_, index) => {
    return [`file-${index}.txt`, 1, 1, 1] as [string, number, number, number]
  })
}

function makeStatus(overrides: Partial<RepoListStatus> = {}): RepoListStatus {
  return {
    branch: "main",
    uncommitted: 0,
    ahead: 0,
    behind: 0,
    syncState: "upToDate",
    hasRemote: false,
    workdirOk: true,
    conflictCount: 0,
    mergeInProgress: false,
    ...overrides,
  }
}

/** 模拟 GitContext：fs 为 null（mock 不访问），gitdir 必须与 resolveGitdir 一致以共享同一协调器键 */
function createCtx(
  bookmarkName: string,
  statusMatrix: () => Promise<StatusMatrix>
): GitContext {
  return {
    git: { statusMatrix },
    fs: null,
    dir: "/tmp/zz-scan-test/" + bookmarkName,
    gitdir: resolveGitdir(bookmarkName),
  }
}

/** runStatusRead 内并发调用 scanStatusMatrix：同仓必须共享一次底层扫描 */
async function testSharedScanInRead(): Promise<void> {
  const name = uniqueName("shared")
  const matrix = makeMatrix(3)
  const gate = deferred<StatusMatrix>()
  let calls = 0
  // 计数用快照读取：直接断言局部变量会被 TS 窄化成字面量，影响后续比较
  const callsNow = () => calls
  const ctx = createCtx(name, async () => {
    calls++
    return gate.promise
  })

  const first = runStatusRead(name, () => scanStatusMatrix(name, ctx, "详情刷新"))
  const second = runStatusRead(name, () => scanStatusMatrix(name, ctx, "列表刷新"))
  await tick()

  assert(callsNow() === 1, "同仓并发 runStatusRead 共享一次扫描")
  assert(first !== second, "两个读取仍是各自独立的 Promise")

  gate.resolve(matrix)
  const [a, b] = await Promise.all([first, second])
  assert(a === matrix && b === matrix, "两个调用拿到同一矩阵实例")
  assert(callsNow() === 1, "共享期间底层 statusMatrix 只执行一次")
}

/** 写入屏障让已开始的旧读作废，并自动重跑扫描返回新矩阵 */
async function testMutationInvalidatesInFlightRead(): Promise<void> {
  const name = uniqueName("stale")
  const oldMatrix = makeMatrix(1)
  const newMatrix = makeMatrix(2)
  const gate = deferred<StatusMatrix>()
  let calls = 0
  let current = oldMatrix
  const ctx = createCtx(name, async () => {
    calls++
    if (calls === 1) return gate.promise
    return current
  })

  const read = runStatusRead(name, () => scanStatusMatrix(name, ctx, "详情刷新"))
  await tick()
  assert(calls === 1, "旧读已开始扫描")
  const mutation = runStatusMutation(name, async () => {
    current = newMatrix
    return "written"
  })
  await tick()
  assert(statusRevision(name) === 1, "写入开始即递增代次")

  // 旧读此时返回旧矩阵：runStatusRead 必须丢弃它并重读
  gate.resolve(oldMatrix)
  const value = await read
  assert(value === newMatrix, "写入后旧读丢弃旧结果并重试返回新矩阵")
  assert(Number(calls) === 2, "重试确实重跑了底层扫描")
  assert((await mutation) === "written", "写入自身正常完成")
  assert(statusRevision(name) === 2, "写入前后各递增一次代次")
  assert(getCachedRepoStatus(name) === undefined, "写入后不会残留缓存")
}

/** 写入期间缓存不可见，旧代次结果一律不得发布 */
async function testCacheHiddenDuringWrite(): Promise<void> {
  const name = uniqueName("hidden")
  const revision = statusRevision(name)
  cacheRepoStatus(name, makeStatus({ uncommitted: 1 }), revision)
  const before = getCachedRepoStatus(name)
  assert(before?.uncommitted === 1, "写入前缓存可见")

  const gate = deferred<void>()
  const mutation = runStatusMutation(name, async () => {
    await gate.promise
    return "ok"
  })
  await tick()

  assert(getCachedRepoStatus(name) === undefined, "写入期间缓存不可见")
  assert(!canPublishStatus(name, revision), "写入期间禁止发布")

  cacheRepoStatus(name, makeStatus({ uncommitted: 9 }), revision)
  assert(getCachedRepoStatus(name) === undefined, "写入期间旧结果不得发布")
  assert(rememberChangesCountResult(name, revision) === false, "写入期间计数也不得发布")

  gate.resolve()
  await mutation
  assert(getCachedRepoStatus(name) === undefined, "写入后本仓旧缓存不可见")

  cacheRepoStatus(name, makeStatus({ uncommitted: 9 }), revision)
  assert(getCachedRepoStatus(name) === undefined, "写入后旧代次结果不得发布")
  assert(rememberChangesCountResult(name, revision) === false, "写入后旧代次计数不得发布")

  const nextRevision = statusRevision(name)
  assert(nextRevision === 2, "代次在写入前后各递增一次")
  assert(canPublishStatus(name, nextRevision), "新代次可发布")
  cacheRepoStatus(name, makeStatus({ uncommitted: 9 }), nextRevision)
  assert(getCachedRepoStatus(name)?.uncommitted === 9, "新代次结果可以发布")
}

/** 借助返回值判断 rememberChangesCount 是否真的写入（内部走 canPublishStatus 同一闸门） */
function rememberChangesCountResult(name: string, revision: number): boolean {
  rememberChangesCount(name, 42, revision)
  return validatedChangesCount(name, 42) === 42
}

/** 写后缓存失效只影响本仓 */
async function testMutationInvalidatesOnlyOwnKey(): Promise<void> {
  const a = uniqueName("inv-a")
  const b = uniqueName("inv-b")
  cacheRepoStatus(a, makeStatus({ uncommitted: 4 }), statusRevision(a))
  cacheRepoStatus(b, makeStatus({ uncommitted: 7 }), statusRevision(b))
  assert(getCachedRepoStatus(a)?.uncommitted === 4, "A 已缓存")
  assert(getCachedRepoStatus(b)?.uncommitted === 7, "B 已缓存")

  await runStatusMutation(a, async () => "ok")

  assert(getCachedRepoStatus(a) === undefined, "写后本仓缓存失效")
  assert(getCachedRepoStatus(b)?.uncommitted === 7, "异仓缓存不受影响")
  assert(statusRevision(a) === 2 && statusRevision(b) === 0, "代次只在本仓递增")
}

/** known count 只接受本代次且数值匹配的记录 */
async function testKnownChangesCount(): Promise<void> {
  const name = uniqueName("count")
  const revision = statusRevision(name)

  assert(validatedChangesCount(name, undefined) === undefined, "未提供计数返回 undefined")
  assert(validatedChangesCount(name, 3) === undefined, "未记录时返回 undefined")

  rememberChangesCount(name, 3, revision)
  assert(validatedChangesCount(name, 3) === 3, "本代次匹配值被接受")
  assert(validatedChangesCount(name, 4) === undefined, "数值不匹配不采纳")
  rememberChangesCount(name, 0, revision)
  assert(validatedChangesCount(name, 0) === 0, "数值为 0 且匹配时按 0 采纳")

  rememberChangesCount(name, 5, revision + 99)
  assert(rememberChangesCountResult(name, revision) === true, "本代次仍可写入")
  assert(validatedChangesCount(name, 5) === undefined, "非本代次写入被拒绝")

  await runStatusMutation(name, async () => "ok")
  assert(validatedChangesCount(name, 3) === undefined, "写入后旧代次计数失效")
}

/** 扫描失败（error / workdirOk=false）不得成为新鲜缓存 */
async function testFailureStatusNotFresh(): Promise<void> {
  const name = uniqueName("fail-cache")
  const revision = statusRevision(name)

  cacheRepoStatus(name, makeStatus({ uncommitted: 2 }), revision)
  const cached = getCachedRepoStatus(name, true)
  assert(cached?.uncommitted === 2, "正常状态可作为新鲜缓存")

  cacheRepoStatus(name, makeStatus({ error: "工作区不可访问" }), revision)
  assert(getCachedRepoStatus(name) === undefined, "错误状态不缓存")
  assert(getCachedRepoStatus(name, true) === undefined, "错误状态不作为新鲜缓存")

  cacheRepoStatus(name, makeStatus({ uncommitted: 3 }), revision)
  assert(getCachedRepoStatus(name)?.uncommitted === 3, "重新缓存正常状态")
  cacheRepoStatus(name, makeStatus({ workdirOk: false }), revision)
  assert(getCachedRepoStatus(name) === undefined, "工作区不可用状态不缓存")
  assert(getCachedRepoStatus(name, true) === undefined, "工作区不可用也不新鲜")
}

/** 失败扫描必须释放共享条目，允许重试 */
async function testFailedScanCanRetry(): Promise<void> {
  const name = uniqueName("retry")
  const matrix = makeMatrix(2)
  let calls = 0
  const ctx = createCtx(name, async () => {
    calls++
    if (calls === 1) throw new Error("模拟 statusMatrix 失败")
    return matrix
  })

  // 并发共享同一次失败
  const first = runStatusRead(name, () => scanStatusMatrix(name, ctx, "详情刷新"))
  const second = runStatusRead(name, () => scanStatusMatrix(name, ctx, "列表刷新"))
  const firstErrorPromise = expectReject(first)
  const secondErrorPromise = expectReject(second)
  await tick()
  assert(calls === 1, "失败期间同仓仍只扫描一次")

  const firstError = await firstErrorPromise
  const secondError = await secondErrorPromise
  assert(String((firstError as Error).message) === "模拟 statusMatrix 失败", "首个读取收到失败")
  assert(String((secondError as Error).message) === "模拟 statusMatrix 失败", "共享读取同样失败")

  const value = await runStatusRead(name, () => scanStatusMatrix(name, ctx, "详情刷新"))
  assert(value === matrix, "失败后可以重试成功")
  assert(Number(calls) === 2, "重试触发了新的底层扫描")
}

/** 缓存读写都必须是副本，互不污染 */
function testCachedStatusIsCopy(): void {
  const name = uniqueName("copy")
  const revision = statusRevision(name)
  const source = makeStatus({ uncommitted: 3 })

  cacheRepoStatus(name, source, revision)
  source.uncommitted = 99
  assert(getCachedRepoStatus(name)?.uncommitted === 3, "写入时复制，外部改动不影响缓存")

  const copy = getCachedRepoStatus(name)
  assert(copy, "缓存存在")
  copy.uncommitted = 71
  copy.branch = "hacked"
  const again = getCachedRepoStatus(name)
  assert(again, "缓存仍存在")
  assert(
    again.uncommitted === 3 && again.branch === "main",
    "返回值是副本，改动不污染缓存"
  )
}

async function main(): Promise<void> {
  await testSharedScanInRead()
  await testMutationInvalidatesInFlightRead()
  await testCacheHiddenDuringWrite()
  await testMutationInvalidatesOnlyOwnKey()
  await testKnownChangesCount()
  await testFailureStatusNotFresh()
  await testFailedScanCanRetry()
  testCachedStatusIsCopy()
  console.log("status scan service tests passed")
}

main().then(
  () => Script.exit("status scan service tests passed"),
  (error) => {
    console.error(error)
    // 必须显式结束运行，否则运行会挂到超时；失败信息写进结果再抛出，保留失败语义
    Script.exit("status scan service tests failed: " + String((error as Error)?.message ?? error))
    throw error
  }
)
