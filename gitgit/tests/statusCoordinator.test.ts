/**
 * tests/statusCoordinator.test.ts - 状态协调器并发语义（模拟 gate，不碰真实仓库）
 *
 * 按生产约定，扫描一律经 coordinator.read(key, () => coordinator.scan(...)) 发起。
 * 覆盖：同仓共享一次扫描、异仓全局串行、待排详情优先、失败释放重试、
 * read 持有到完整 task 结束、写入屏障与排队、失败 mutation 释放屏障与 revision、第二个 mutation 拒绝。
 */
import { Script } from "scripting"
import { StatusCoordinator, type ScanRun } from "../utils/statusCoordinator"

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

/** 让出事件循环：一次性冲干当前所有挂起的微任务（drain 链全部走微任务） */
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

/** 同仓的列表与详情请求必须共享同一次扫描 */
async function testSharedScan(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-shared"
  let calls = 0
  let run: ScanRun | undefined
  const lateSources: string[] = []
  const gate = deferred<string>()

  function scanTask() {
    return async (current: ScanRun): Promise<string> => {
      calls++
      run = current
      return gate.promise
    }
  }

  const listRead = coordinator.read(key, () => coordinator.scan(key, "列表刷新", scanTask()))
  const detailRead = coordinator.read(key, () => coordinator.scan(key, "详情刷新", scanTask()))
  await tick()

  assert(calls === 1, "同仓列表与详情共享一次扫描")
  assert(run != null, "扫描任务已开始")
  assert(run!.sources.has("列表刷新") && run!.sources.has("详情刷新"), "并入的详情来源会写进同一次 run")

  // 扫描已在执行：此时再加入的来源走 onSource 通知，不新建扫描
  const joined: string[] = []
  run!.onSource = (source) => joined.push(source)
  const extraRead = coordinator.read(key, () => coordinator.scan(key, "历史刷新", scanTask()))
  await tick()
  assert(calls === 1, "执行中加入的来源不触发第二次扫描")
  assert(joined.join(",") === "历史刷新", "执行中并入的来源通知 onSource")
  assert(run!.sources.has("历史刷新"), "执行中并入的来源同样记入 run")

  gate.resolve("matrix")
  const [listValue, detailValue, extraValue] = await Promise.all([listRead, detailRead, extraRead])
  assert(
    listValue === "matrix" && detailValue === "matrix" && extraValue === "matrix",
    "同仓三个调用共享同一矩阵结果"
  )
  assert(calls === 1, "共享期间扫描任务只执行一次")
}

/** 不同仓库之间也全局只允许一个矩阵扫描在跑 */
async function testGlobalSerialScans(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const started: string[] = []
  let running = 0
  let peak = 0
  const gates = new Map<string, Deferred<string>>()
  gates.set("repo-b", deferred<string>())
  gates.set("repo-c", deferred<string>())

  function scanTask(name: string) {
    return async (): Promise<string> => {
      started.push(name)
      running++
      peak = Math.max(peak, running)
      try {
        return await gates.get(name)!.promise
      } finally {
        running--
      }
    }
  }

  const readB = coordinator.read("repo-b", () => coordinator.scan("repo-b", "详情刷新", scanTask("repo-b")))
  const readC = coordinator.read("repo-c", () => coordinator.scan("repo-c", "详情刷新", scanTask("repo-c")))
  await tick()

  assert(started.join(",") === "repo-b", "异仓扫描串行：第二个仓库尚未开始")
  assert(peak === 1, "全局最多一个矩阵在跑")

  gates.get("repo-b")!.resolve("b")
  await tick()
  assert(started.join(",") === "repo-b,repo-c", "第一个仓库结束后才启动第二个")
  assert(peak === 1, "串行期间并发峰值始终为 1")

  gates.get("repo-c")!.resolve("c")
  assert((await readB) === "b" && (await readC) === "c", "各仓扫描各自返回")
  assert(running === 0, "扫描全部结束后无残留并发")
}

/** 尚未开始时，排队中的详情扫描优先于列表扫描 */
async function testQueuedDetailPriority(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const started: string[] = []
  // 详情扫描需阻塞住，否则它瞬间完成后列表扫描会在同一个 tick 里跟上
  const detailGate = deferred<string>()

  // 列表扫描先入队（以「列表」开头），随后入队的详情扫描应被提到前面
  const listRead = coordinator.read(
    "repo-list-first",
    () => coordinator.scan("repo-list-first", "列表刷新", async () => {
      started.push("list")
      return "list-matrix"
    })
  )
  const detailRead = coordinator.read(
    "repo-detail-second",
    () => coordinator.scan("repo-detail-second", "详情刷新", async () => {
      started.push("detail")
      return detailGate.promise
    })
  )
  await tick()

  assert(started.join(",") === "detail", "待排详情扫描优先执行")

  detailGate.resolve("detail-matrix")
  assert((await detailRead) === "detail-matrix", "详情扫描结果")
  assert((await listRead) === "list-matrix", "列表扫描在详情之后补跑")
  assert(started.join(",") === "detail,list", "两者都执行且顺序正确")
}

/** 扫描失败后必须释放共享条目，允许同键重试 */
async function testScanFailureRetry(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-retry"
  // 计数用快照读取：直接断言属性会被 TS 窄化成字面量，影响后续比较
  const counts = { scan: 0, join: 0 }
  const countsNow = () => ({ scan: counts.scan, join: counts.join })
  const gate = deferred<string>()

  const failing = coordinator.read(
    key,
    () => coordinator.scan(key, "详情刷新", async () => {
      counts.scan++
      return gate.promise
    })
  )
  await tick()

  // 失败前加入的调用共享同一次失败
  const joinedFail = coordinator.read(
    key,
    () => coordinator.scan(key, "列表刷新", async () => {
      counts.join++
      return "should-not-run"
    })
  )
  assert(countsNow().join === 0, "失败期间加入的调用复用同一次扫描")

  gate.reject(new Error("扫描失败"))
  await expectReject(failing)
  await expectReject(joinedFail)
  const afterFail = countsNow()
  assert(afterFail.scan === 1 && afterFail.join === 0, "失败只发生一次")

  const retried = await coordinator.read(
    key,
    () => coordinator.scan(key, "详情刷新", async () => {
      counts.scan++
      return "retry-ok"
    })
  )
  assert(retried === "retry-ok", "失败后同键可以重新扫描")
  assert(countsNow().scan === 2, "重试确实执行了新任务")
}

/** 写入屏障必须等到已有 read 的完整 task 结束，而不只是等到它登记 */
async function testMutateWaitsFullRead(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-hold"
  const gate = deferred<string>()
  let readFinished = false
  let mutateStarted = false

  const readPromise = coordinator.read(key, async () => {
    await gate.promise
    readFinished = true
    return "read-done"
  })
  await tick()

  const mutatePromise = coordinator.mutate(key, async () => {
    mutateStarted = true
    return "mutated"
  })
  await tick()

  assert(!readFinished, "read 仍在进行")
  assert(!mutateStarted, "read 完整结束前 mutation 不开始")

  gate.resolve("go")
  await tick()
  assert(readFinished, "read 已完整结束")
  assert(mutateStarted, "read 结束后 mutation 才开始")

  assert((await readPromise) === "read-done", "read 结果")
  assert((await mutatePromise) === "mutated", "mutation 结果")
}

/** mutation 期间的新 read 被挡在屏障后，并排在已有 read 之后 */
async function testMutateBlocksNewRead(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-order"
  const gate = deferred<string>()
  const order: string[] = []

  const read1 = coordinator.read(key, async () => {
    order.push("read1-start")
    await gate.promise
    order.push("read1-end")
    return "r1"
  })
  await tick()

  const mutate = coordinator.mutate(key, async () => {
    order.push("mutate")
    return "m"
  })
  const read2 = coordinator.read(key, async () => {
    order.push("read2")
    return "r2"
  })
  await tick()

  assert(order.join(",") === "read1-start", "屏障挡住新 read 并等待已有 read")
  gate.resolve("go")
  assert((await read1) === "r1", "已有 read 正常结束")
  assert((await mutate) === "m", "mutation 正常结束")
  assert((await read2) === "r2", "被挡住的 read 随后执行")
  assert(order.join(",") === "read1-start,read1-end,mutate,read2", "顺序：已有 read → 写 → 排队 read")
}

/** 失败的 mutation 必须释放屏障，并在前后各递增一次 revision */
async function testFailedMutateReleasesBarrier(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-mutate-fail"
  assert(coordinator.revision(key) === 0, "初始 revision 为 0")

  const error = await expectReject(coordinator.mutate(key, async () => {
    throw new Error("写失败")
  }))
  assert(String((error as Error).message) === "写失败", "mutation 失败向上抛出")
  assert(coordinator.revision(key) === 2, "失败的 mutation 也前后各递增一次 revision")

  // 屏障已释放：后续 mutation 不再被拒绝
  assert((await coordinator.mutate(key, async () => "again")) === "again", "失败后屏障释放可再次写入")
  assert(coordinator.revision(key) === 4, "第二次 mutation 继续递增 revision")

  // 读也不再被永久挡住
  assert((await coordinator.read(key, async () => "r")) === "r", "失败后 read 正常")
}

/** 同一 key 上的第二个 mutation 直接拒绝，不排队 */
async function testSecondMutateRejected(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-mutate-busy"
  const gate = deferred<string>()

  const first = coordinator.mutate(key, async () => {
    await gate.promise
    return "m1"
  })
  await tick()

  let message = ""
  await expectReject(coordinator.mutate(key, async () => "m2")).then((error) => {
    message = String((error as Error)?.message ?? error)
  })
  assert(message.includes("正在执行其它写操作"), "第二个 mutation 被拒绝")

  gate.resolve("done")
  assert((await first) === "m1", "首个 mutation 不受影响")

  // 不同 key 的 mutation 互不阻塞
  const other = coordinator.mutate("gitdir/other", async () => "other")
  assert((await other) === "other", "不同仓库的写操作互不干扰")
  assert(coordinator.revision("gitdir/other") === 2, "各自维护 revision")
}

/** 失败的扫描同样不能把写入屏障或后续扫描堵死 */
async function testScanFailureDoesNotBlockMutate(): Promise<void> {
  const coordinator = new StatusCoordinator<string>()
  const key = "gitdir/repo-scan-fail"
  const gate = deferred<string>()

  const read = coordinator.read(
    key,
    () => coordinator.scan(key, "详情刷新", async () => gate.promise)
  )
  await tick()

  const mutate = coordinator.mutate(key, async () => "mutated")
  gate.reject(new Error("矩阵读取失败"))
  await expectReject(read)

  assert((await mutate) === "mutated", "失败的扫描不阻塞随后的写操作")
}

async function main(): Promise<void> {
  await testSharedScan()
  await testGlobalSerialScans()
  await testQueuedDetailPriority()
  await testScanFailureRetry()
  await testMutateWaitsFullRead()
  await testMutateBlocksNewRead()
  await testFailedMutateReleasesBarrier()
  await testSecondMutateRejected()
  await testScanFailureDoesNotBlockMutate()
  console.log("status coordinator tests passed")
  Script.exit("status coordinator tests passed")
}

main().then(
  () => Script.exit("status coordinator tests passed"),
  (error) => {
    console.error(error)
    // 必须显式结束运行，否则运行会挂到超时；失败信息写进结果再抛出，保留失败语义
    Script.exit("status coordinator tests failed: " + String((error as Error)?.message ?? error))
    throw error
  }
)