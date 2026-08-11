import { Script } from "scripting"
import type { CommitEntry } from "../types/git"
import {
  matchesHistoryQuery,
  normalizeHistoryQuery,
  paginateHistory,
} from "../utils/history"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

const entries: CommitEntry[] = [
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

function main(): void {
  assert(normalizeHistoryQuery("  LOGIN ") === "login", "搜索词规范化")
  assert(matchesHistoryQuery(entries[0], "login"), "匹配提交信息")
  assert(matchesHistoryQuery(entries[1], "BOB@EXAMPLE.COM"), "匹配作者邮箱")
  assert(matchesHistoryQuery(entries[2], "CCC333"), "匹配 OID")
  assert(!matchesHistoryQuery(entries[1], "missing"), "过滤不匹配提交")

  const first = paginateHistory(entries, 0, 2)
  assert(first.entries.length === 2, "第一页数量")
  assert(first.hasMore, "第一页 hasMore")
  assert(first.totalMatches === null, "无搜索不计算总数")

  const second = paginateHistory(entries, 2, 2)
  assert(second.entries.length === 1, "第二页数量")
  assert(!second.hasMore, "末页 hasMore")

  const searched = paginateHistory(entries, 0, 1, "storage")
  assert(searched.entries[0]?.oid === "ccc333", "搜索结果顺序")
  assert(searched.totalMatches === 1, "搜索匹配总数")
  assert(!searched.hasMore, "搜索末页 hasMore")
  assert(!searched.limited, "纯分页工具默认不标记受限")

  const empty = paginateHistory(entries, 0, 50, "not-found")
  assert(empty.entries.length === 0, "搜索空结果")
  assert(empty.totalMatches === 0, "搜索空结果总数")

  const normalized = paginateHistory(entries, -4, 0)
  assert(normalized.entries.length === 1, "非法分页参数归一化")
}

try {
  main()
  console.log("history tests passed")
  Script.exit("history tests passed")
} catch (error) {
  console.error(error)
  throw error
}
