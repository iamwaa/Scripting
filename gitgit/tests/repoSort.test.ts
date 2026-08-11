/**
 * 轻量探针：仓库列表按名称排序纯逻辑
 */
import { Script } from "scripting"
import type { RepoListStatus, RepoMeta, RepoSnapshot } from "../types/git"
import { sortReposByName, sortReposForList } from "../utils/repoSort"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function repo(name: string, id: string): RepoMeta {
  return {
    name,
    bookmarkName: id,
    repoId: id,
    workdir: "/tmp/" + id,
    source: "local",
    createdAt: 0,
  } as RepoMeta
}

async function main() {
  const list = [
    repo("zeta", "r1"),
    repo("Alpha", "r2"),
    repo("beta", "r3"),
    repo("苹果", "r4"),
    repo("仓库", "r5"),
  ]

  const asc = sortReposByName(list)
  // ASCII 名升序在前（忽略大小写），中文名按拼音在后
  assert(
    asc.map((r) => r.name).join(",") === "Alpha,beta,zeta,仓库,苹果",
    "升序与分组: " + asc.map((r) => r.name).join(",")
  )
  assert(asc !== list, "返回新数组")
  assert(
    list.map((r) => r.bookmarkName).join(",") === "r1,r2,r3,r4,r5",
    "原数组未被排序影响"
  )

  // 数字后缀按自然序，不按字典序
  const numeric = sortReposByName([repo("app10", "a"), repo("app2", "b")]).map(
    (r) => r.name
  )
  assert(numeric.join(",") === "app2,app10", "数字自然序: " + numeric.join(","))

  // 名称缺失/空白不应抛错
  assert(
    sortReposByName([repo("  b ", "x"), repo("", "y")]).length === 2,
    "空名称可排序"
  )

  const statuses: Record<string, RepoListStatus> = {
    r1: {
      branch: "main",
      uncommitted: 0,
      ahead: 0,
      behind: 0,
      syncState: "upToDate",
      hasRemote: true,
      workdirOk: true,
      conflictCount: 0,
      mergeInProgress: false,
    },
    r3: {
      branch: "main",
      uncommitted: 2,
      ahead: 0,
      behind: 0,
      syncState: "upToDate",
      hasRemote: true,
      workdirOk: true,
      conflictCount: 0,
      mergeInProgress: false,
    },
    r5: {
      branch: "main",
      uncommitted: 0,
      ahead: 1,
      behind: 0,
      syncState: "ahead",
      hasRemote: true,
      workdirOk: true,
      conflictCount: 0,
      mergeInProgress: false,
    },
  }
  const snapshots: Record<string, RepoSnapshot> = {
    r4: {
      name: "苹果",
      branch: "main",
      uncommitted: 0,
      ahead: 0,
      behind: 1,
      updatedAt: 0,
    },
  }
  const prioritized = sortReposForList(list, statuses, snapshots)
  assert(
    prioritized.map((r) => r.name).join(",") === "beta,仓库,苹果,Alpha,zeta",
    "待处理优先且组内按名称: " + prioritized.map((r) => r.name).join(",")
  )
  assert(prioritized !== list, "待处理排序返回新数组")

  console.log("repoSort 测试通过")
}

main()
  .then(() => Script.exit())
  .catch((e) => {
    console.error(String(e?.message || e))
    Script.exit()
  })
