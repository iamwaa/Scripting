import { Script } from "scripting"
import { isRepoStatusFresh, REPO_STATUS_FRESHNESS_MS } from "../utils/statusFreshness"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function main() {
  const base = { completedAt: 10000, revision: 2, currentRevision: 2 }
  assert(isRepoStatusFresh({ ...base, now: 15000 }), "完成后五秒内复用")
  assert(!isRepoStatusFresh({ ...base, now: 10000 + REPO_STATUS_FRESHNESS_MS }), "到期后检测外部改动")
  assert(!isRepoStatusFresh({ ...base, now: 15000, force: true }), "手动强制绕过缓存")
  assert(!isRepoStatusFresh({ ...base, now: 15000, currentRevision: 4 }), "本仓写入立即失效")
  assert(!isRepoStatusFresh({ ...base, now: 9000 }), "时钟回退保守刷新")
  assert(!isRepoStatusFresh({ ...base, now: NaN }), "非法时间不命中")
  // 每仓独立传入代次；更新其它仓库不改变本仓参数。
  const repoA = { ...base, currentRevision: 4 }
  const repoB = { ...base }
  assert(!isRepoStatusFresh({ ...repoA, now: 15000 }), "A 变更失效")
  assert(isRepoStatusFresh({ ...repoB, now: 15000 }), "A 变更不影响 B")
}

try {
  main()
  Script.exit("status freshness tests passed")
} catch (error) {
  console.error(error)
  Script.exit("status freshness tests failed: " + error)
  throw error
}
