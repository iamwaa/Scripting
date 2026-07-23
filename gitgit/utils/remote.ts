/**
 * utils/remote.ts - Remote / upstream 校验与变更规划纯逻辑
 *
 * 供 gitService 与自动化测试共用，避免把命名/回滚规则锁在引擎调用里。
 */

/** 远端列表项（对齐 isomorphic-git listRemotes） */
export interface RemoteListItem {
  remote: string
  url: string
}

/** 分支 upstream 配置 */
export interface UpstreamConfig {
  remote: string
  merge: string
}

/** 删除 remote 失败后的回滚目标 */
export type RemoteDeleteRollback =
  | { action: "none" }
  | { action: "restore"; remote: string; url: string }

/** 修改 URL 失败后的回滚目标 */
export type RemoteUrlRollback =
  | { action: "none" }
  | { action: "restore"; remote: string; url: string }

const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 规范化 remote 名称（trim） */
export function normalizeRemoteName(name: unknown): string {
  return String(name ?? "").trim()
}

/** 规范化 remote URL（trim，去掉尾部多余 /） */
export function normalizeRemoteUrl(url: unknown): string {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "")
}

/**
 * 校验 remote 名称：非空、无空白、无路径分隔，且符合常见 git remote 命名。
 * 合法示例：origin、upstream、my-fork
 */
export function validateRemoteName(name: unknown): string {
  const remote = normalizeRemoteName(name)
  if (!remote) {
    throw new Error("远端名称不能为空")
  }
  if (/\s/.test(remote)) {
    throw new Error("远端名称不能包含空白")
  }
  if (remote.includes("/") || remote.includes("\\")) {
    throw new Error("远端名称不能包含路径分隔符")
  }
  if (!REMOTE_NAME_RE.test(remote)) {
    throw new Error(
      "远端名称无效：需以字母或数字开头，仅含字母、数字、. _ -"
    )
  }
  return remote
}

/**
 * 校验 remote URL：非空，且为 http(s)/git/ssh 或 scp-like git@host:path。
 */
export function validateRemoteUrl(url: unknown): string {
  const remoteUrl = normalizeRemoteUrl(url)
  if (!remoteUrl) {
    throw new Error("远端 URL 不能为空")
  }
  if (/\s/.test(remoteUrl)) {
    throw new Error("远端 URL 不能包含空白")
  }

  const lower = remoteUrl.toLowerCase()
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("git://") ||
    lower.startsWith("ssh://")
  ) {
    // 协议后至少还要有主机/路径
    const rest = remoteUrl.slice(remoteUrl.indexOf("://") + 3)
    if (!rest || rest === "/") {
      throw new Error("远端 URL 无效：缺少主机或路径")
    }
    return remoteUrl
  }

  // scp-like：git@github.com:user/repo.git
  if (/^[^@\s/]+@[^:\s/]+:.+$/.test(remoteUrl)) {
    return remoteUrl
  }

  throw new Error(
    "远端 URL 无效：请使用 https://、http://、git://、ssh:// 或 git@host:path"
  )
}

/** 在列表中按名称查找 remote */
export function findRemote(
  remotes: readonly RemoteListItem[],
  name: unknown
): RemoteListItem | null {
  const remote = normalizeRemoteName(name)
  if (!remote) return null
  const hit = remotes.find((item) => item.remote === remote)
  return hit
    ? { remote: hit.remote, url: String(hit.url || "") }
    : null
}

/** 添加前：名称/URL 合法，且名称不重复 */
export function assertCanAddRemote(
  remotes: readonly RemoteListItem[],
  name: unknown,
  url: unknown
): { remote: string; url: string } {
  const remote = validateRemoteName(name)
  const remoteUrl = validateRemoteUrl(url)
  if (findRemote(remotes, remote)) {
    throw new Error(`远端「${remote}」已存在`)
  }
  return { remote, url: remoteUrl }
}

/**
 * 修改 URL 前：remote 必须已存在；新 URL 合法且与旧值不同。
 * 返回规范化后的目标与失败回滚信息。
 */
export function planSetRemoteUrl(
  remotes: readonly RemoteListItem[],
  name: unknown,
  url: unknown
): {
  remote: string
  nextUrl: string
  previousUrl: string
  rollback: RemoteUrlRollback
} {
  const remote = validateRemoteName(name)
  const nextUrl = validateRemoteUrl(url)
  const existing = findRemote(remotes, remote)
  if (!existing) {
    throw new Error(`远端「${remote}」不存在`)
  }
  const previousUrl = normalizeRemoteUrl(existing.url)
  if (!previousUrl) {
    throw new Error(`远端「${remote}」当前 URL 无效，请先删除后重新添加`)
  }
  if (previousUrl === nextUrl) {
    throw new Error("新 URL 与当前相同，无需修改")
  }
  return {
    remote,
    nextUrl,
    previousUrl,
    rollback: { action: "restore", remote, url: previousUrl },
  }
}

/**
 * 删除前：remote 必须存在。
 * 返回删除目标与失败回滚（把刚删掉的加回去）。
 */
export function planDeleteRemote(
  remotes: readonly RemoteListItem[],
  name: unknown
): {
  remote: string
  previousUrl: string
  rollback: RemoteDeleteRollback
} {
  const remote = validateRemoteName(name)
  const existing = findRemote(remotes, remote)
  if (!existing) {
    throw new Error(`远端「${remote}」不存在`)
  }
  const previousUrl = normalizeRemoteUrl(existing.url)
  if (!previousUrl) {
    // 仍允许删除脏配置，但无法可靠回滚 URL
    return {
      remote,
      previousUrl: "",
      rollback: { action: "none" },
    }
  }
  return {
    remote,
    previousUrl,
    rollback: { action: "restore", remote, url: previousUrl },
  }
}

/**
 * 规范化 merge ref：
 * - main → refs/heads/main
 * - refs/heads/main 保持不变
 * - 拒绝空 / 含空白 / remotes 路径
 */
export function normalizeUpstreamMerge(merge: unknown): string {
  const raw = String(merge ?? "").trim()
  if (!raw) {
    throw new Error("上游分支不能为空")
  }
  if (/\s/.test(raw)) {
    throw new Error("上游分支不能包含空白")
  }
  if (raw.startsWith("refs/remotes/")) {
    throw new Error("上游 merge 应为本地分支 ref（refs/heads/...），不是 remotes")
  }
  if (raw.startsWith("refs/heads/")) {
    const branch = raw.slice("refs/heads/".length)
    if (!branch || branch.includes("/../") || branch === "..") {
      throw new Error("上游分支名称无效")
    }
    return raw
  }
  if (raw.startsWith("refs/")) {
    throw new Error("上游 merge 仅支持 refs/heads/<branch> 或短分支名")
  }
  // 短名：去掉误写的 origin/ 前缀
  const short = raw.replace(/^origin\//, "").replace(/^heads\//, "")
  if (!short || short.includes("..") || short.startsWith("/")) {
    throw new Error("上游分支名称无效")
  }
  return `refs/heads/${short}`
}

/** 从 merge ref 提取短分支名 */
export function upstreamMergeBranch(merge: string): string {
  const normalized = normalizeUpstreamMerge(merge)
  return normalized.slice("refs/heads/".length)
}

/**
 * 设置/变更 upstream 前校验：
 * - 本地分支名非空
 * - remote 在列表中
 * - merge 可规范化
 */
export function planSetUpstream(
  remotes: readonly RemoteListItem[],
  branch: unknown,
  remote: unknown,
  merge: unknown
): {
  branch: string
  remote: string
  merge: string
  mergeBranch: string
} {
  const branchName = String(branch ?? "").trim()
  if (!branchName) {
    throw new Error("本地分支名称不能为空")
  }
  if (/\s/.test(branchName) || branchName.includes("..")) {
    throw new Error("本地分支名称无效")
  }
  const remoteName = validateRemoteName(remote)
  if (!findRemote(remotes, remoteName)) {
    throw new Error(`远端「${remoteName}」不存在，请先添加 remote`)
  }
  const mergeRef = normalizeUpstreamMerge(merge)
  return {
    branch: branchName,
    remote: remoteName,
    merge: mergeRef,
    mergeBranch: upstreamMergeBranch(mergeRef),
  }
}

/** 解析 getConfig 读到的 upstream；缺一则视为未配置 */
export function parseUpstreamConfig(
  remote: unknown,
  merge: unknown
): UpstreamConfig | null {
  const remoteName = normalizeRemoteName(remote)
  const mergeRaw = String(merge ?? "").trim()
  if (!remoteName || !mergeRaw) return null
  try {
    return {
      remote: remoteName,
      merge: normalizeUpstreamMerge(mergeRaw),
    }
  } catch (_e) {
    return null
  }
}

/**
 * 展示用：与同步区拉取同一格式。
 * 有本地分支时 `main ← origin/main`；仅配置时 `origin/main`；未设置时「未设置」。
 */
export function formatUpstreamLabel(
  upstream: UpstreamConfig | null | undefined,
  localBranch?: string | null
): string {
  if (!upstream) return "未设置"
  let track: string
  try {
    track = `${upstream.remote}/${upstreamMergeBranch(upstream.merge)}`
  } catch (_e) {
    const mergeShort = String(upstream.merge || "").replace(
      /^refs\/heads\//,
      ""
    )
    track = `${upstream.remote}/${mergeShort || upstream.merge}`
  }
  const local = String(localBranch ?? "").trim()
  return local ? `${local} ← ${track}` : track
}

/**
 * 删除 origin 后，RepoMeta.remoteUrl 是否应清空。
 * 仅当被删的是 origin 时返回 true。
 */
export function shouldClearRepoRemoteUrlMeta(deletedRemote: string): boolean {
  return normalizeRemoteName(deletedRemote) === "origin"
}

/**
 * 添加/修改 origin 后，RepoMeta.remoteUrl 应写入的值。
 * 非 origin 返回 null（不改 meta）。
 */
export function repoRemoteUrlMetaAfterChange(
  remote: string,
  url: string
): string | null {
  if (normalizeRemoteName(remote) !== "origin") return null
  return validateRemoteUrl(url)
}
