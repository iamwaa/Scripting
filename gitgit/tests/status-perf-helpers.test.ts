/**
 * 轻量探针：status 加载优化相关的纯逻辑与 createFS.stat
 */
import { Script } from "scripting"
import { createFS } from "../services/gitCore"
import { computeSyncTopology, topologyFromCounts } from "../utils/gitSync"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

async function main() {
  assert(
    JSON.stringify(topologyFromCounts(2, 1)) ===
      JSON.stringify({ ahead: 2, behind: 1, syncState: "diverged" }),
    "topologyFromCounts diverged"
  )
  assert(topologyFromCounts(0, 0).syncState === "upToDate", "0/0 upToDate")
  assert(topologyFromCounts(3, 0).syncState === "ahead", "ahead")
  assert(topologyFromCounts(0, 2).syncState === "behind", "behind")

  let isFileCalls = 0
  let isDirCalls = 0
  const typedStatManager = {
    stat: async () => ({
      type: "file", // 模拟真机目录 type 误报
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
  assert(dirStat.isDirectory() === true, "dir via isDirectory")
  assert(isFileCalls === 0, "no isFile")
  assert(isDirCalls === 1, "one isDirectory")

  const realRoot = FileManager.temporaryDirectory + "/gitgit-stat-probe"
  try {
    await FileManager.createDirectory(realRoot, true)
    const realFs = createFS(realRoot + "/.git", realRoot)
    await FileManager.createDirectory(realRoot + "/subdir", true)
    await FileManager.writeAsString(realRoot + "/a.txt", "x", "utf8")
    const d = await realFs.stat("subdir")
    const f = await realFs.stat("a.txt")
    console.log("real dir", d.type, d.isDirectory(), d.isFile())
    console.log("real file", f.type, f.isDirectory(), f.isFile())
    assert(d.isDirectory(), "real dir")
    assert(f.isFile(), "real file")
  } finally {
    try {
      await FileManager.remove(realRoot)
    } catch (_e) {
      /* ignore */
    }
  }

  assert(
    computeSyncTopology("a", "a", new Set(["a"]), new Set(["a"])).syncState ===
      "upToDate",
    "same oid"
  )
  console.log("✅ status-perf helpers passed")
  Script.exit("status-perf helpers passed")
}

main().catch((e) => {
  console.error(e)
  Script.exit("failed: " + String((e as any)?.message || e))
})
