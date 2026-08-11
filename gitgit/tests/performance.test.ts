import { Script } from "scripting"
import { setLruEntry } from "../utils/lru"
import {
  buildPerformanceReport,
  clearSlowOperations,
  getSlowOperations,
  recordSlowOperation,
  SLOW_OPERATION_LIMIT,
} from "../utils/performance"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function testLru(): void {
  const cache = new Map<string, number>()
  setLruEntry(cache, "a", 1, 2)
  setLruEntry(cache, "b", 2, 2)
  setLruEntry(cache, "a", 3, 2)
  setLruEntry(cache, "c", 4, 2)
  assert(!cache.has("b"), "淘汰最久未使用项")
  assert(cache.get("a") === 3, "更新值并刷新最近使用顺序")
  assert(cache.get("c") === 4, "保留最新项")
}

function testPerformanceDiagnostics(): void {
  clearSlowOperations()
  recordSlowOperation("快速操作", 1999, "/private/repo")
  assert(getSlowOperations().length === 0, "阈值以下不记录")
  recordSlowOperation("慢操作", 2500, "/private/projects/demo")
  const first = getSlowOperations()[0]
  assert(first?.context === "demo", "绝对路径上下文只保留末级")

  for (let index = 0; index < SLOW_OPERATION_LIMIT + 5; index++) {
    recordSlowOperation(`操作${index}`, 2000 + index, "repo-id")
  }
  const entries = getSlowOperations()
  assert(entries.length === SLOW_OPERATION_LIMIT, "诊断记录遵守环形上限")
  assert(entries[0]?.operation === "操作5", "超限后淘汰最早记录")

  const report = buildPerformanceReport({
    historyRepoCount: 2,
    historyEntryCount: 300,
    historyRepoLimit: 4,
    historyEntryLimit: 5000,
  })
  assert(report.includes("# GitGit 性能诊断"), "报告标题")
  assert(report.includes("内部阶段"), "报告说明嵌套阶段不是重复扫描")
  assert(report.includes("历史缓存：2 / 4 个仓库"), "报告包含缓存统计")
  assert(report.includes("操作5"), "报告包含慢操作")
  clearSlowOperations()
}

try {
  testLru()
  testPerformanceDiagnostics()
  console.log("performance tests passed")
  Script.exit("performance tests passed")
} catch (error) {
  console.error(error)
  throw error
}
