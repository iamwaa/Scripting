import { Script } from "scripting"
import { compareTreeOidsByPath } from "../services/git/commitService"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

type Entry = {
  path: string
  oid: string
  type: "tree" | "blob"
  mode: string
}

const trees: Record<string, Entry[]> = {
  parent: [
    { path: "docs", oid: "same-docs", type: "tree", mode: "040000" },
    { path: "src", oid: "old-src", type: "tree", mode: "040000" },
    { path: "old.txt", oid: "old-blob", type: "blob", mode: "100644" },
    { path: "swap", oid: "old-swap", type: "blob", mode: "100644" },
  ],
  current: [
    { path: "docs", oid: "same-docs", type: "tree", mode: "040000" },
    { path: "src", oid: "new-src", type: "tree", mode: "040000" },
    { path: "new.txt", oid: "new-blob", type: "blob", mode: "100644" },
    { path: "swap", oid: "swap-tree", type: "tree", mode: "040000" },
  ],
  "same-docs": [
    { path: "large.md", oid: "same-large", type: "blob", mode: "100644" },
  ],
  "old-src": [
    { path: "keep.ts", oid: "same-keep", type: "blob", mode: "100644" },
    { path: "modify.ts", oid: "old-modify", type: "blob", mode: "100644" },
    { path: "remove.ts", oid: "remove-blob", type: "blob", mode: "100644" },
  ],
  "new-src": [
    { path: "add.ts", oid: "add-blob", type: "blob", mode: "100644" },
    { path: "keep.ts", oid: "same-keep", type: "blob", mode: "100644" },
    { path: "modify.ts", oid: "new-modify", type: "blob", mode: "100644" },
  ],
  "swap-tree": [
    { path: "nested.txt", oid: "nested-blob", type: "blob", mode: "100644" },
  ],
}

async function main(): Promise<void> {
  const reads: string[] = []
  const git = {
    async readTree({ oid }: { oid: string }) {
      reads.push(oid)
      const tree = trees[oid]
      if (!tree) throw new Error("未知 tree: " + oid)
      return { tree }
    },
  }
  const changes = await compareTreeOidsByPath(
    git,
    {},
    "/repo",
    "/gitdir",
    "parent",
    "current"
  )
  const summary = changes.map((item) => `${item.status}:${item.filepath}`)
  assert(!reads.includes("same-docs"), "相同子树 OID 必须整棵跳过")
  assert(summary.includes("modified:src/modify.ts"), "识别修改文件")
  assert(summary.includes("added:src/add.ts"), "识别新增文件")
  assert(summary.includes("deleted:src/remove.ts"), "识别删除文件")
  assert(summary.includes("added:new.txt"), "识别根目录新增")
  assert(summary.includes("deleted:old.txt"), "识别根目录删除")
  assert(summary.includes("deleted:swap"), "文件切换为目录时删除原文件")
  assert(summary.includes("added:swap/nested.txt"), "文件切换为目录时展开新目录")
  assert(!summary.some((item) => item.includes("keep.ts")), "忽略未变化文件")

  reads.length = 0
  const unchanged = await compareTreeOidsByPath(
    git,
    {},
    "/repo",
    "/gitdir",
    "current",
    "current"
  )
  assert(unchanged.length === 0, "相同根树没有差异")
  assert(reads.length === 0, "相同根树不执行 readTree")

  const token = { cancelled: true }
  let cancelled = false
  try {
    await compareTreeOidsByPath(
      git,
      {},
      "/repo",
      "/gitdir",
      "parent",
      "current",
      token
    )
  } catch (error: any) {
    cancelled = String(error?.message || error).includes("已取消")
  }
  assert(cancelled, "取消后停止提交树读取")
  assert(reads.length === 0, "取消后不执行 readTree")
}

main()
  .then(() => {
    console.log("commit tree diff tests passed")
    Script.exit("commit tree diff tests passed")
  })
  .catch((error) => {
    console.error(error)
    throw error
  })
