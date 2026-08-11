import { Script } from "scripting"
import { runSingleFlight } from "../utils/singleFlight"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

async function main() {
  const inFlight = new Map<string, Promise<number>>()
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const task = async () => {
    runs++
    await gate
    return 42
  }
  const first = runSingleFlight(inFlight, "repo-a", task)
  const second = runSingleFlight(inFlight, "repo-a", task)
  const other = runSingleFlight(inFlight, "repo-b", async () => 7)
  assert(first === second, "同一 key 共用 Promise")
  assert(runs === 1, "同一 key 只启动一次任务")
  assert(await other === 7, "不同 key 独立执行")
  release()
  assert(await first === 42 && await second === 42, "并发调用共享结果")
  assert(inFlight.size === 0, "完成后释放记录")

  let failures = 0
  try {
    await runSingleFlight(inFlight, "repo-a", async () => {
      failures++
      throw new Error("expected")
    })
  } catch (_e) {
    // 预期失败。
  }
  const retried = await runSingleFlight(inFlight, "repo-a", async () => {
    failures++
    return 9
  })
  assert(retried === 9 && failures === 2, "失败释放后允许重试")
  console.log("singleFlight 测试通过")
}

main()
  .then(() => Script.exit())
  .catch((error) => {
    console.error(String(error?.message || error))
    Script.exit()
  })
