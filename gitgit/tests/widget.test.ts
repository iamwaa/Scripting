import { Script } from "scripting"
import type { RepoSnapshot } from "../types/git"
import {
  WIDGET_STALE_AFTER_MS,
  buildWidgetSummary,
  formatWidgetUpdatedAt,
} from "../utils/widget"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

const now = Date.UTC(2026, 7, 5, 8, 0, 0)
const snapshots: RepoSnapshot[] = [
  {
    name: "Clean",
    branch: "main",
    uncommitted: 0,
    ahead: 0,
    behind: 0,
    updatedAt: now - 10 * 60 * 1000,
  },
  {
    name: "Work",
    branch: "feature/widget",
    uncommitted: 3,
    ahead: 2,
    behind: 1,
    updatedAt: now - 60 * 60 * 1000,
  },
]

function main(): void {
  const all = buildWidgetSummary(snapshots, "", now)
  assert(all.repoCount === 2, "汇总仓库数量")
  assert(all.dirtyRepoCount === 1, "汇总有改动仓库数量")
  assert(all.uncommitted === 3, "汇总未提交数量")
  assert(all.ahead === 2 && all.behind === 1, "汇总同步状态")
  assert(all.snapshots[0]?.name === "Work", "优先展示需处理的仓库")
  assert(!all.isStale, "最新快照未过期")

  const selected = buildWidgetSummary(snapshots, " work ", now)
  assert(selected.repoCount === 1, "参数筛选仓库")
  assert(selected.snapshots[0]?.branch === "feature/widget", "保留分支信息")
  assert(selected.parameterMatched, "参数匹配状态")

  const missing = buildWidgetSummary(snapshots, "missing", now)
  assert(missing.repoCount === 0, "未知仓库不回退到全局")
  assert(!missing.parameterMatched, "未知参数状态")

  const stale = buildWidgetSummary(
    [{ ...snapshots[0], updatedAt: now - WIDGET_STALE_AFTER_MS - 1 }],
    "",
    now
  )
  assert(stale.isStale, "识别过期快照")
  assert(formatWidgetUpdatedAt(null, now) === "暂无更新", "无更新时间")
  assert(
    formatWidgetUpdatedAt(now - 30 * 1000, now) === "刚刚更新",
    "一分钟内更新时间"
  )
  assert(
    formatWidgetUpdatedAt(now - 2 * 60 * 60 * 1000, now) ===
      "2 小时前更新",
    "小时更新时间"
  )
}

try {
  main()
  console.log("widget tests passed")
  Script.exit("widget tests passed")
} catch (error) {
  console.error(error)
  throw error
}
