/**
 * utils/branch.ts - 分支删除 / 重命名 / 远端分支管理的校验与规划纯逻辑
 *
 * 与引擎无关：只做名称规范化、git check-ref-format 子集校验，以及
 * 「能否删除 / 重命名」的前置判断，供 gitService 与自动化测试共用。
 */

/** 规范化分支名：trim，去掉 refs/heads/ 前缀 */
export function normalizeBranchName(input: unknown): string {
  let s = String(input ?? "").trim()
  if (s.startsWith("refs/heads/")) s = s.slice("refs/heads/".length)
  return s.trim()
}

/** 规范化远端跟踪短名：trim，去掉 origin/ 前缀（默认 origin） */
export function stripRemotePrefix(input: unknown, remote = "origin"): string {
  const s = String(input ?? "").trim()
  const prefix = remote + "/"
  return (s.startsWith(prefix) ? s.slice(prefix.length) : s).trim()
}

/**
 * 校验分支名（git check-ref-format 常用子集）：
 * - 非空、无空白
 * - 不含 ~ ^ : ? * [ \ 及控制字符
 * - 不以 / . 开头或结尾，不含 // 或 ..
 * - 不含 @{，不以 .lock 结尾
 * 合法：main、feature/login、release-1.2
 */
export function validateBranchName(input: unknown): string {
  const name = normalizeBranchName(input)
  if (!name) {
    throw new Error("分支名称不能为空")
  }
  if (/\s/.test(name)) {
    throw new Error("分支名称不能包含空白")
  }
  // eslint-disable-next-line no-control-regex
  if (/[~^:?*\[\\\x00-\x1f\x7f]/.test(name)) {
    throw new Error("分支名称不能包含 ~ ^ : ? * [ \\ 等特殊字符")
  }
  if (name.startsWith("/") || name.endsWith("/")) {
    throw new Error("分支名称不能以 / 开头或结尾")
  }
  if (name.startsWith(".") || name.endsWith(".")) {
    throw new Error("分支名称不能以 . 开头或结尾")
  }
  if (name.includes("//") || name.includes("..")) {
    throw new Error("分支名称不能包含 // 或 ..")
  }
  if (name.includes("@{")) {
    throw new Error("分支名称不能包含 @{")
  }
  if (name.endsWith(".lock")) {
    throw new Error("分支名称不能以 .lock 结尾")
  }
  return name
}

/** 判断本地分支列表中是否已存在某名称 */
export function branchExists(
  locals: readonly string[],
  name: unknown
): boolean {
  const target = normalizeBranchName(name)
  if (!target) return false
  return locals.some((b) => normalizeBranchName(b) === target)
}

/**
 * 规划删除本地分支：
 * - 目标名合法且存在
 * - 不能删除当前分支（需先切走）
 */
export function planDeleteBranch(
  locals: readonly string[],
  current: unknown,
  target: unknown
): { branch: string } {
  const branch = validateBranchName(target)
  const cur = normalizeBranchName(current)
  if (cur && branch === cur) {
    throw new Error(`不能删除当前所在分支「${branch}」，请先切换到其它分支`)
  }
  if (!branchExists(locals, branch)) {
    throw new Error(`本地分支「${branch}」不存在`)
  }
  return { branch }
}

/**
 * 规划重命名本地分支：
 * - from 合法且存在
 * - to 合法、与 from 不同、且不与已有分支冲突
 * 返回是否重命名的是当前分支（服务层据此刷新 HEAD/current）
 */
export function planRenameBranch(
  locals: readonly string[],
  current: unknown,
  from: unknown,
  to: unknown
): { from: string; to: string; isCurrent: boolean } {
  const fromName = validateBranchName(from)
  const toName = validateBranchName(to)
  if (!branchExists(locals, fromName)) {
    throw new Error(`本地分支「${fromName}」不存在`)
  }
  if (fromName === toName) {
    throw new Error("新分支名与原名相同")
  }
  if (branchExists(locals, toName)) {
    throw new Error(`分支「${toName}」已存在`)
  }
  const cur = normalizeBranchName(current)
  return { from: fromName, to: toName, isCurrent: !!cur && cur === fromName }
}

/**
 * 规划删除远端分支：
 * - 去掉 remote/ 前缀后的短名合法
 * - 禁止空名
 * 返回用于 push --delete 的短分支名与展示用跟踪名。
 */
export function planDeleteRemoteBranch(
  remote: unknown,
  branch: unknown
): { remote: string; branch: string; track: string } {
  const remoteName = String(remote ?? "").trim() || "origin"
  const short = validateBranchName(stripRemotePrefix(branch, remoteName))
  return {
    remote: remoteName,
    branch: short,
    track: `${remoteName}/${short}`,
  }
}
