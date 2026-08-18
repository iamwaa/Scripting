import { Script } from "scripting"
import type { ActionRun } from "../types/github"
import {
  optimisticRerunRun,
  rerunAvailability,
  rerunModeLabel,
} from "../utils/actionsRerun"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function main(): void {
  // 未结束的运行一律不可重跑，并给出原因
  const queued = rerunAvailability({ status: "queued", conclusion: null })
  assert(!queued.canRerunAll && !queued.canRerunFailed, "排队中的运行不可重跑")
  assert(queued.reason === "运行排队中，结束后才能重新运行", "排队中给出原因文案")

  const running = rerunAvailability({ status: "in_progress", conclusion: null })
  assert(!running.canRerunAll && !running.canRerunFailed, "进行中的运行不可重跑")
  assert(running.reason === "运行进行中，结束后才能重新运行", "进行中给出原因文案")

  // 已结束的运行都可重跑全部 Job
  const success = rerunAvailability({ status: "completed", conclusion: "success" })
  assert(success.canRerunAll, "成功的运行可重跑全部 Job")
  assert(!success.canRerunFailed, "成功的运行没有失败 Job 可重跑")
  assert(success.reason === undefined, "可重跑时不返回原因")

  // 仅失败类结论才允许「仅重跑失败 Job」
  assert(
    rerunAvailability({ status: "completed", conclusion: "failure" }).canRerunFailed,
    "失败的运行可仅重跑失败 Job"
  )
  assert(
    rerunAvailability({ status: "completed", conclusion: "timed_out" }).canRerunFailed,
    "超时的运行可仅重跑失败 Job"
  )
  assert(
    !rerunAvailability({ status: "completed", conclusion: "cancelled" }).canRerunFailed,
    "已取消的运行没有失败 Job 可重跑"
  )
  assert(
    !rerunAvailability({ status: "completed", conclusion: "skipped" }).canRerunFailed,
    "已跳过的运行没有失败 Job 可重跑"
  )
  assert(
    rerunAvailability({ status: "completed", conclusion: null }).canRerunAll,
    "结论缺失的已完成运行仍可重跑全部 Job"
  )

  assert(rerunModeLabel("all") === "重新运行全部 Job", "全部重跑方式名称")
  assert(rerunModeLabel("failed") === "仅重新运行失败 Job", "失败重跑方式名称")

  // 乐观更新把运行改回排队中，且不修改原对象
  const failedRun = {
    id: 1,
    name: "CI",
    workflowName: "ci.yml",
    headBranch: "main",
    displayTitle: "fix: bug",
    status: "completed",
    conclusion: "failure",
    event: "push",
    actorLogin: "octocat",
    actorAvatarUrl: "",
    createdAt: "",
    updatedAt: "",
    htmlUrl: "",
    headShaShort: "abc1234",
  } as ActionRun
  const optimistic = optimisticRerunRun(failedRun)
  assert(optimistic.status === "queued", "乐观更新后状态为排队中")
  assert(optimistic.conclusion === null, "乐观更新后清空结论")
  assert(optimistic.id === failedRun.id && optimistic.displayTitle === "fix: bug", "乐观更新保留其它字段")
  assert(failedRun.status === "completed" && failedRun.conclusion === "failure", "乐观更新不修改原对象")
  assert(
    !rerunAvailability(optimistic).canRerunAll,
    "乐观更新后的运行立即变为不可重跑"
  )
}

try {
  main()
  console.log("actionsRerun tests passed")
  Script.exit("actionsRerun tests passed")
} catch (error) {
  console.error(error)
  throw error
}
