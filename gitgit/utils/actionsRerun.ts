/**
 * utils/actionsRerun.ts - 工作流运行「重新运行」可用性判定
 *
 * GitHub 只允许对已结束（completed）的运行发起重跑：
 * - 重跑全部 Job：任何 completed 运行都可以，对应 /actions/runs/{id}/rerun
 * - 仅重跑失败 Job：需要运行里确实存在失败结果，
 *   对应 /actions/runs/{id}/rerun-failed-jobs
 *
 * queued / in_progress 的运行尚未结束，GitHub 会返回 403，因此这里提前拦下。
 */

import type { ActionRun, ActionRunConclusion, ActionRunStatus } from "../types/github"

/** 重跑方式：全部 Job / 仅失败 Job */
export type RerunMode = "all" | "failed"

/** 重跑可用性判定结果 */
export interface RerunAvailability {
  /** 是否可重跑全部 Job */
  canRerunAll: boolean
  /** 是否可仅重跑失败 Job */
  canRerunFailed: boolean
  /** 不可重跑时的原因文案，可直接用于提示；可重跑时为 undefined */
  reason?: string
}

/** 存在失败 Job 的结论：这些结论下「仅重跑失败」才有意义 */
const FAILED_CONCLUSIONS: ActionRunConclusion[] = ["failure", "timed_out"]

/**
 * 判断某个运行支持哪些重跑方式。
 * @param run 运行状态与结论（只依赖这两个字段，便于测试与复用）
 */
export function rerunAvailability(run: {
  status: ActionRunStatus
  conclusion: ActionRunConclusion
}): RerunAvailability {
  if (run.status === "queued") {
    return { canRerunAll: false, canRerunFailed: false, reason: "运行排队中，结束后才能重新运行" }
  }
  if (run.status === "in_progress") {
    return { canRerunAll: false, canRerunFailed: false, reason: "运行进行中，结束后才能重新运行" }
  }
  return {
    canRerunAll: true,
    canRerunFailed: FAILED_CONCLUSIONS.includes(run.conclusion),
  }
}

/** 重跑确认弹窗与 toast 使用的方式名称 */
export function rerunModeLabel(mode: RerunMode): string {
  return mode === "all" ? "重新运行全部 Job" : "仅重新运行失败 Job"
}

/**
 * 重跑发起后运行会回到 queued，但 GitHub 端需要几秒才反映到列表接口。
 * 这里给出乐观更新后的本地状态，避免刷新前 UI 仍显示旧的失败结论。
 */
export function optimisticRerunRun(run: ActionRun): ActionRun {
  return { ...run, status: "queued", conclusion: null }
}
