import { Script } from "scripting"
import {
  buildRepoSetSignature,
  REPO_STATUS_FRESHNESS_MS,
  shouldRefreshRepoStatuses,
} from "../utils/statusFreshness"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function main() {
  const signature = buildRepoSetSignature(["repo-b", "repo-a"])
  assert(signature === "repo-a\nrepo-b", "仓库签名与输入顺序无关")

  const base = {
    lastCompletedAt: 10000,
    repoSignature: signature,
    lastRepoSignature: signature,
    latestSnapshotAt: 10000,
  }
  assert(
    !shouldRefreshRepoStatuses({ ...base, now: 15000 }),
    "完成后 5 秒内保持新鲜"
  )
  assert(
    shouldRefreshRepoStatuses({
      ...base,
      now: 10000 + REPO_STATUS_FRESHNESS_MS,
    }),
    "达到 30 秒新鲜期后刷新"
  )
  assert(
    shouldRefreshRepoStatuses({
      ...base,
      now: 15000,
      repoSignature: buildRepoSetSignature(["repo-a"]),
    }),
    "仓库集合变化立即刷新"
  )
  assert(
    shouldRefreshRepoStatuses({
      ...base,
      now: 15000,
      latestSnapshotAt: 12000,
    }),
    "详情页写入更新快照后立即刷新"
  )
  assert(
    shouldRefreshRepoStatuses({ ...base, now: 15000, force: true }),
    "下拉刷新强制执行"
  )
  console.log("status freshness 测试通过")
}

try {
  main()
  Script.exit("status freshness 测试通过")
} catch (error) {
  console.error(error)
  throw error
}
