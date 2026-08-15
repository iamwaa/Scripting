/**
 * 轻量探针：Actions 日志按步骤分段（parseStepSegments）
 *
 * 用贴近真实的 Job 日志片段验证：
 * - Set up job 的内部 group（Operating System / Runner Image / …）不会被当成用户步骤
 * - Set up job 里的 "Complete job name: build" 不会把后面所有步骤误判成后置段
 * - 每个 "##[group]Run xxx" 对应一个用户步骤，skipped 步骤不占块
 */
import { Script } from "scripting"
import type { ActionStep } from "../types/github"
import { parseStepSegments, getSegmentText } from "../utils/actionsLog"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

let clock = 0
/** 生成带时间戳前缀的日志行 */
function ts(content: string): string {
  clock++
  const d = new Date(Date.UTC(2026, 7, 14, 14, 50, 0) + clock * 1000)
  return `${d.toISOString().replace("Z", "0000Z")} ${content}`
}

function step(
  number: number,
  name: string,
  conclusion: ActionStep["conclusion"] = "success"
): ActionStep {
  return { number, name, status: "completed", conclusion }
}

async function main() {
  // 真实 Job 日志的典型结构
  const rawLog = [
    ts("Current runner version: '2.336.0'"),
    ts("##[group]Runner Image Provisioner"),
    ts("Hosted Compute Agent"),
    ts("##[endgroup]"),
    ts("##[group]Operating System"),
    ts("macOS"),
    ts("##[endgroup]"),
    ts("##[group]Runner Image"),
    ts("Image: macos-15"),
    ts("##[endgroup]"),
    ts("##[group]GITHUB_TOKEN Permissions"),
    ts("Contents: read"),
    ts("##[endgroup]"),
    ts("Secret source: Actions"),
    ts("Prepare workflow directory"),
    ts("Prepare all required actions"),
    ts("Getting action download info"),
    ts("Download action repository 'actions/checkout@v6' (SHA:aaa)"),
    ts("Download action repository 'actions/upload-artifact@v7' (SHA:bbb)"),
    ts("Complete job name: build"),
    // 步骤 2：checkout
    ts("##[group]Run actions/checkout@v6"),
    ts("with:"),
    ts("  repository: iamwaa/DYYY"),
    ts("##[endgroup]"),
    ts("Syncing repository: iamwaa/DYYY"),
    // 步骤 3：make package
    ts("##[group]Run make package SCHEME=rootful FINALPACKAGE=1"),
    ts("##[endgroup]"),
    ts("> Making all for tweak DYYY"),
    ts("==> Preprocessing Waa.xm"),
    ts("==> Linking tweak DYYY"),
    // 步骤 4：upload
    ts("##[group]Run actions/upload-artifact@v7"),
    ts("##[endgroup]"),
    ts("Artifact upload complete"),
    // 后置段
    ts("Post job cleanup."),
    ts("[command]/usr/bin/git version"),
    ts("Cleaning up orphan processes"),
  ].join("\n")

  const steps: ActionStep[] = [
    step(1, "Set up job"),
    step(2, "Checkout"),
    step(3, "Build package"),
    step(4, "Upload artifact"),
    step(5, "Skipped release", "skipped"),
    step(6, "Post Checkout"),
    step(7, "Complete job"),
  ]

  const segments = parseStepSegments(rawLog, steps)

  // Set up job 段：整块归到步骤 1，不拆成多个用户步骤
  const setup = getSegmentText(segments, 1)
  assert(setup.includes("Current runner version: '2.336.0'"), "Set up job 含 runner 版本")
  assert(setup.includes("Download action repository 'actions/upload-artifact@v7'"), "Set up job 含 action 下载")
  assert(setup.includes("Complete job name: build"), "Set up job 含 Complete job name 行")
  assert(!setup.includes("Syncing repository"), "Set up job 不含用户步骤内容")

  // 步骤 2：checkout
  const checkout = getSegmentText(segments, 2)
  assert(checkout.startsWith("Run actions/checkout@v6"), "步骤2 以 Run actions/checkout 开头: " + checkout.slice(0, 40))
  assert(checkout.includes("Syncing repository: iamwaa/DYYY"), "步骤2 含 checkout 输出")
  assert(!checkout.includes("Making all for tweak"), "步骤2 不含构建输出")

  // 步骤 3：make package —— 网页版看到的内容
  const build = getSegmentText(segments, 3)
  assert(build.includes("Run make package SCHEME=rootful"), "步骤3 含 Run make package")
  assert(build.includes("> Making all for tweak DYYY"), "步骤3 含 Making all")
  assert(build.includes("==> Linking tweak DYYY"), "步骤3 含 Linking")
  assert(!build.includes("Current runner version"), "步骤3 不含 Set up job 内容")

  // 步骤 4：upload
  const upload = getSegmentText(segments, 4)
  assert(upload.includes("Artifact upload complete"), "步骤4 含上传结果")

  // skipped 步骤没有日志
  assert(getSegmentText(segments, 5) === "", "skipped 步骤无日志")

  // 后置段
  const post = getSegmentText(segments, -1)
  assert(post.includes("Post job cleanup."), "后置段含 Post job cleanup")
  assert(post.includes("Cleaning up orphan processes"), "后置段含 orphan processes")
  assert(!post.includes("Making all for tweak"), "后置段不含用户步骤输出")

  // 无 steps 时兜底为完整日志
  const fallback = parseStepSegments(rawLog, [])
  assert(fallback.length === 1 && fallback[0].label === "完整日志", "无步骤时兜底单段")

  console.log("actionsLog.test 全部通过")
  Script.exit()
}

main()
