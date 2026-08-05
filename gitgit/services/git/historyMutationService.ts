import { resolveAuthor } from "../authStore"
import {
  checkoutWithEmptyDirCleanup,
  ensureGitConfigAuthor,
  getCtx,
  writeSymbolicHead,
} from "./runtime"

async function resolveHeadOid(
  git: any,
  fs: any,
  dir: string,
  gitdir: string
): Promise<string> {
  return git.resolveRef({ fs, dir, gitdir, ref: "HEAD" })
}

async function assertHeadCanBeRewritten(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  headOid: string,
  action: "回退" | "重编"
): Promise<string> {
  let branch: string | null = null
  try {
    branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    branch = null
  }
  if (!branch) throw new Error(`当前不在命名分支上，无法${action}`)
  try {
    const remoteOid = await git.resolveRef({
      fs,
      dir,
      gitdir,
      ref: "refs/remotes/origin/" + branch,
    })
    if (remoteOid === headOid) {
      throw new Error(
        action === "回退"
          ? "该提交已在远端，请使用「撤销提交」生成反向提交"
          : "该提交已推送，不能重编；请新建提交或使用撤销"
      )
    }
    let remoteIsAncestor = false
    try {
      remoteIsAncestor = await git.isDescendent({
        fs,
        dir,
        gitdir,
        oid: headOid,
        ancestor: remoteOid,
        depth: -1,
      })
    } catch (_e) {
      remoteIsAncestor = false
    }
    if (!remoteIsAncestor) {
      throw new Error(
        action === "回退"
          ? "本地与远端已分叉或远端领先，为避免改写已发布历史，请使用「撤销提交」"
          : "本地与远端已分叉或远端领先，不能重编；请新建提交"
      )
    }
  } catch (error: any) {
    if (error?.code !== "NotFoundError") throw error
  }
  return branch
}

export async function revertCommitInternal(
  bookmarkName: string,
  oid: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  if (oid !== headOid) {
    throw new Error("目前仅支持撤销最新提交（HEAD）。更早的提交请在电脑上操作。")
  }
  const target = await git.readCommit({ fs, dir, gitdir, oid })
  const parents: string[] = target.commit.parent || []
  if (parents.length > 1) throw new Error("暂不支持撤销合并提交")
  const parentOid = parents[0]
  if (!parentOid) throw new Error("无法撤销初始提交（无父提交）")
  let branch: string | null = null
  try {
    branch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
  } catch (_e) {
    branch = null
  }
  if (!branch) throw new Error("当前不在命名分支上，无法撤销")
  const matrix = (await git.statusMatrix({ fs, dir, gitdir })) as [
    string,
    number,
    number,
    number,
  ][]
  if (matrix.some((row) => !(row[1] === 1 && row[2] === 1 && row[3] === 1))) {
    throw new Error("工作区有未提交改动，撤销前请先提交或暂存（stash），以免丢失改动。")
  }

  await checkoutWithEmptyDirCleanup(git, fs, {
    dir,
    gitdir,
    ref: parentOid,
    force: true,
  })
  await git.writeRef({
    fs,
    dir,
    gitdir,
    ref: "refs/heads/" + branch,
    value: headOid,
    force: true,
  })
  await writeSymbolicHead(fs, branch)
  await git.add({ fs, dir, gitdir, filepath: "." })
  try {
    const checkoutMatrix = await git.statusMatrix({ fs, dir, gitdir })
    for (const row of checkoutMatrix as [string, number, number, number][]) {
      if (row[1] === 1 && row[2] === 0) {
        await git.remove({ fs, dir, gitdir, filepath: row[0] }).catch(() => undefined)
      }
    }
  } catch (_e) {
    // 删除暂存补偿失败时仍交由 commit 返回实际结果
  }
  const title = (target.commit.message || "").split("\n")[0].trim()
  return git.commit({
    fs,
    dir,
    gitdir,
    message: `Revert "${title}"\n\nThis reverts commit ${oid}.`,
    author: resolvedAuthor,
  })
}

export async function softResetHeadInternal(
  bookmarkName: string
): Promise<{ parentOid: string }> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  const commit = await git.readCommit({ fs, dir, gitdir, oid: headOid })
  const parentOid = (commit.commit.parent || [])[0]
  if (!parentOid) throw new Error("没有父提交，无法回退")
  const branch = await assertHeadCanBeRewritten(
    git,
    fs,
    dir,
    gitdir,
    headOid,
    "回退"
  )
  await git.writeRef({
    fs,
    dir,
    gitdir,
    ref: "refs/heads/" + branch,
    value: parentOid,
    force: true,
  })
  await writeSymbolicHead(fs, branch)
  return { parentOid }
}

export async function amendHeadCommitInternal(
  bookmarkName: string,
  message: string,
  author?: { name: string; email: string }
): Promise<string> {
  const { git, fs, dir, gitdir } = await getCtx(bookmarkName)
  const resolvedAuthor = await resolveAuthor(author)
  await ensureGitConfigAuthor(git, fs, dir, gitdir, resolvedAuthor)
  const headOid = await resolveHeadOid(git, fs, dir, gitdir)
  await assertHeadCanBeRewritten(git, fs, dir, gitdir, headOid, "重编")
  return git.commit({
    fs,
    dir,
    gitdir,
    message,
    author: resolvedAuthor,
    amend: true,
  })
}
