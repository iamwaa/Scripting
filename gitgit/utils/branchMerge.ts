/**
 * utils/branchMerge.ts - 合并到当前分支 / Pull 目标与文案纯逻辑
 *
 * 与引擎无关：校验源分支名、解析 Pull 目标（upstream 或回退）、统一成功提示文案。
 */

import { upstreamMergeBranch } from "./remote"

/** Pull 结果（当前分支 ← remote/跟踪分支） */
export type PullResultStatus = "upToDate" | "updated"

export interface PullResult {
  status: PullResultStatus
  /** 本地分支（ours） */
  branch: string
  /** 拉取用的 remote 名 */
  remote: string
  /** 远端跟踪分支短名（theirs，可能与本地不同名） */
  remoteBranch: string
  /** 是否按 branch.*.upstream 配置解析 */
  usedUpstream: boolean
}

/** 合并到当前分支的结果 */
export type MergeIntoCurrentStatus = "upToDate" | "merged"

export interface MergeIntoCurrentResult {
  status: MergeIntoCurrentStatus
  ours: string
  theirs: string
}

/** 解析 Pull 目标用的 upstream 片段 */
export interface PullUpstreamInput {
  remote: string
  merge: string
}

/** 已解析的 Pull 目标 */
export interface PullTarget {
  localBranch: string
  remote: string
  remoteBranch: string
  /** 展示：origin/main */
  track: string
  usedUpstream: boolean
}

/**
 * 规范化用户输入的合并源：
 * 去掉 refs/heads/、refs/remotes/ 前缀与首尾空白。
 * 例：`refs/heads/hua` → `hua`，`origin/hua` 保持。
 */
export function normalizeBranchMergeSource(input: unknown): string {
  let s = String(input ?? "").trim()
  if (s.startsWith("refs/heads/")) s = s.slice("refs/heads/".length)
  else if (s.startsWith("refs/remotes/")) s = s.slice("refs/remotes/".length)
  return s.trim()
}

/**
 * 规划「合并 source 到当前分支」：校验非空、禁止明显自合并。
 * 不解析 oid；同内容不同名分支允许合并（结果为 upToDate 由服务层判断）。
 */
export function planMergeIntoCurrent(
  currentBranch: unknown,
  source: unknown
): { current: string; source: string } {
  const current = String(currentBranch ?? "").trim()
  const src = normalizeBranchMergeSource(source)
  if (!current) {
    throw new Error("当前没有可合并的分支")
  }
  if (!src) {
    throw new Error("请指定要合并的分支")
  }
  if (/\s/.test(src)) {
    throw new Error("分支名称不能包含空白")
  }
  // 禁止 main←main、main←origin/main 这类自合并
  if (src === current || src === `origin/${current}`) {
    throw new Error(
      `不能将「${src}」合并进当前分支「${current}」（同一分支）`
    )
  }
  return { current, source: src }
}

/**
 * 解析 Pull 目标：
 * 1. 传入 explicitRef → 使用 remote + 同名 ref（供 push 前先拉，不读 upstream）
 * 2. 否则有 upstream → 当前分支 ← upstream.remote/merge 分支
 * 3. 否则回退 remote（默认 origin）+ 当前分支同名
 */
export function resolvePullTarget(input: {
  localBranch: unknown
  /** pull 的 remote 参数；无 upstream 时作回退，默认 origin */
  remote?: unknown
  /** 显式 ref：本地与远端均用该名，忽略 upstream */
  explicitRef?: unknown
  upstream?: PullUpstreamInput | null
}): PullTarget {
  const defaultRemote = String(input.remote ?? "origin").trim() || "origin"
  const explicit = String(input.explicitRef ?? "").trim()

  if (explicit) {
    if (/\s/.test(explicit)) {
      throw new Error("分支名称不能包含空白")
    }
    return {
      localBranch: explicit,
      remote: defaultRemote,
      remoteBranch: explicit,
      track: `${defaultRemote}/${explicit}`,
      usedUpstream: false,
    }
  }

  const local = String(input.localBranch ?? "").trim()
  if (!local) {
    throw new Error("当前没有可拉取的分支")
  }

  const up = input.upstream
  if (up && String(up.remote || "").trim() && String(up.merge || "").trim()) {
    try {
      const remote = String(up.remote).trim()
      const remoteBranch = upstreamMergeBranch(up.merge)
      if (remote && remoteBranch) {
        return {
          localBranch: local,
          remote,
          remoteBranch,
          track: `${remote}/${remoteBranch}`,
          usedUpstream: true,
        }
      }
    } catch (_e) {
      // upstream 非法则回退同名
    }
  }

  return {
    localBranch: local,
    remote: defaultRemote,
    remoteBranch: local,
    track: `${defaultRemote}/${local}`,
    usedUpstream: false,
  }
}

/** Pull 成功弹窗文案：区分「已是最新」与「已更新」 */
export function formatPullSuccessAlert(result: PullResult): {
  title: string
  message: string
} {
  const branch = String(result.branch || "").trim() || "当前分支"
  const remote = String(result.remote || "origin").trim() || "origin"
  const remoteBranch =
    String(result.remoteBranch || "").trim() || branch
  const track = `${remote}/${remoteBranch}`

  if (result.status === "upToDate") {
    return {
      title: "已是最新",
      message: `${branch} 与 ${track} 一致`,
    }
  }
  return {
    title: "拉取成功",
    message: `已将 ${track} 合并进 ${branch}`,
  }
}

/** 合并到当前分支成功弹窗文案 */
export function formatMergeSuccessAlert(result: MergeIntoCurrentResult): {
  title: string
  message: string
} {
  const ours = String(result.ours || "").trim() || "当前分支"
  const theirs = String(result.theirs || "").trim() || "源分支"
  if (result.status === "upToDate") {
    return {
      title: "无需合并",
      message: `「${theirs}」与「${ours}」已一致`,
    }
  }
  return {
    title: "合并成功",
    message: `已将「${theirs}」合并进「${ours}」`,
  }
}

/** 远端管理页说明：展示 Pull 实际跟踪目标 */
export function pullActionFooterHint(
  localBranch: string | null | undefined,
  upstream?: PullUpstreamInput | null
): string {
  try {
    const t = resolvePullTarget({
      localBranch: localBranch || "",
      remote: "origin",
      upstream: upstream ?? null,
    })
    return `远端拉取：${t.localBranch} ← ${t.track}`
  } catch (_e) {
    return "拉取：当前分支 ← Upstream / origin 同名"
  }
}
