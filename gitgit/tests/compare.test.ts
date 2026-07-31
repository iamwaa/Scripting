/**
 * tests/compare.test.ts - 分支与远端差异对比（compareWithUpstream）
 *
 * 覆盖：已同步 / 仅领先 / 仅落后 / 分叉 / 无共同祖先 / 无远端跟踪 ref / upstream 配置。
 * 用临时目录真仓 + ctx 注入，不依赖 repoStore 注册。
 */

import { Script } from "scripting"
import { createFS, loadGitEngine } from "../services/gitCore"
import { compareWithUpstream } from "../services/gitService"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

const AUTHOR = { name: "gitgit", email: "gitgit@local" }

interface TestRepo {
  root: string
  workdir: string
  gitdir: string
  git: any
  fs: any
  commitFile: (
    path: string,
    content: string,
    message: string,
    extra?: Record<string, unknown>
  ) => Promise<string>
  compare: () => Promise<Awaited<ReturnType<typeof compareWithUpstream>>>
  cleanup: () => Promise<void>
}

async function setupRepo(label: string): Promise<TestRepo> {
  const root =
    FileManager.appGroupDocumentsDirectory +
    "/gitgit-tests/compare-" +
    label +
    "-" +
    Date.now()
  const workdir = root + "/work"
  const gitdir = root + "/git"
  await FileManager.createDirectory(workdir, true)
  await FileManager.createDirectory(gitdir, true)
  const { git } = await loadGitEngine()
  const fs = createFS(gitdir, workdir)
  await git.init({ fs, dir: workdir, gitdir, defaultBranch: "main" })

  async function commitFile(
    path: string,
    content: string,
    message: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    await fs.writeFile(path, content)
    await git.add({ fs, dir: workdir, gitdir, filepath: path })
    return await git.commit({
      fs,
      dir: workdir,
      gitdir,
      message,
      author: AUTHOR,
      ...extra,
    })
  }

  return {
    root,
    workdir,
    gitdir,
    git,
    fs,
    commitFile,
    compare: async () => {
      let configuredRemote = ""
      try {
        configuredRemote =
          (await git.getConfig({
            fs,
            dir: workdir,
            gitdir,
            path: "branch.main.remote",
          })) || ""
      } catch (_e) {
        configuredRemote = ""
      }

      if (!configuredRemote) {
        let targetOid: string | null = null
        try {
          targetOid = await git.resolveRef({
            fs,
            dir: workdir,
            gitdir,
            ref: "refs/remotes/origin/main",
          })
        } catch (_e) {
          targetOid = null
        }
        if (targetOid) {
          await git.writeRef({
            fs,
            dir: workdir,
            gitdir,
            ref: "refs/remotes/compare/main",
            value: targetOid,
            force: true,
          })
        }
        await git.setConfig({
          fs,
          dir: workdir,
          gitdir,
          path: "branch.main.remote",
          value: "compare",
        })
        await git.setConfig({
          fs,
          dir: workdir,
          gitdir,
          path: "branch.main.merge",
          value: "refs/heads/main",
        })
      }

      try {
        const localOid = await git.resolveRef({
          fs,
          dir: workdir,
          gitdir,
          ref: "refs/heads/main",
        })
        await git.writeRef({
          fs,
          dir: workdir,
          gitdir,
          ref: "refs/remotes/origin/main",
          value: localOid,
          force: true,
        })
      } catch (_e) {
        // 无本地提交时由被测函数返回空态。
      }

      return compareWithUpstream("compare-test", {
        git,
        fs,
        dir: workdir,
        gitdir,
      })
    },
    cleanup: async () => {
      try {
        await FileManager.remove(root)
      } catch (_e) {
        /* 测试清理失败不阻断 */
      }
    },
  }
}

function writeRef(repo: TestRepo, ref: string, value: string): Promise<void> {
  return repo.git.writeRef({
    fs: repo.fs,
    dir: repo.workdir,
    gitdir: repo.gitdir,
    ref,
    value,
    force: true,
  })
}

/** 已同步：两端同 tip */
async function testUpToDate(): Promise<void> {
  const repo = await setupRepo("uptodate")
  try {
    await repo.commitFile("a.txt", "a1\n", "c1")
    const tip = await repo.commitFile("a.txt", "a2\n", "c2")
    await writeRef(repo, "refs/remotes/origin/main", tip)

    const res = await repo.compare()
    assert(res != null, "有远端 ref 应返回结果")
    assert(
      res.syncState === "upToDate" && res.ahead === 0 && res.behind === 0,
      "同 tip 应已同步"
    )
    assert(res.mergeBaseOid === tip, "基点应为共同 tip")
    assert(
      res.localFiles.length === 0 && res.remoteFiles.length === 0,
      "已同步应无文件差异"
    )
    assert(
      res.track === "compare/main" && res.baseTrack === "origin/main",
      "应按 origin 与远端管理目标分支对比"
    )
  } finally {
    await repo.cleanup()
  }
}

/** 仅领先：本地多 2 条（一改一增） */
async function testAheadOnly(): Promise<void> {
  const repo = await setupRepo("ahead")
  try {
    const base = await repo.commitFile("m.txt", "v1\n", "base")
    await writeRef(repo, "refs/remotes/origin/main", base)
    const l1 = await repo.commitFile("m.txt", "v2\n", "local 1")
    const l2 = await repo.commitFile("new.txt", "new\n", "local 2")

    const res = await repo.compare()
    assert(res != null, "应返回结果")
    assert(
      res.syncState === "ahead" && res.ahead === 2 && res.behind === 0,
      "应领先 2 条"
    )
    assert(res.mergeBaseOid === base, "基点应为 base")
    assert(
      res.aheadCommits.length === 2 &&
        res.aheadCommits[0].oid === l2 &&
        res.aheadCommits[1].oid === l1,
      "应加载领先提交并按最新在前排序"
    )
    assert(res.behindCommits.length === 0, "不应有落后提交")

    assert(res.localFiles.length === 0 && res.remoteFiles.length === 0, "不计算文件改动")
  } finally {
    await repo.cleanup()
  }
}

/** 仅落后：远端多 1 条，本地回退到 base */
async function testBehindOnly(): Promise<void> {
  const repo = await setupRepo("behind")
  try {
    const base = await repo.commitFile("m.txt", "v1\n", "base")
    const remoteTip = await repo.commitFile("r.txt", "r\n", "remote 1")
    await writeRef(repo, "refs/remotes/origin/main", remoteTip)
    // 本地分支回退到 base（工作区/index 落后不影响只读对比）
    await writeRef(repo, "refs/heads/main", base)

    const res = await repo.compare()
    assert(res != null, "应返回结果")
    assert(
      res.syncState === "behind" && res.behind === 1 && res.ahead === 0,
      "应落后 1 条"
    )
    assert(
      res.behindCommits.length === 1 && res.behindCommits[0].oid === remoteTip,
      "应加载落后提交"
    )
    assert(res.localFiles.length === 0 && res.remoteFiles.length === 0, "不计算文件改动")
  } finally {
    await repo.cleanup()
  }
}

/** 分叉：本地 1 条、远端 1 条，共享 base */
async function testDiverged(): Promise<void> {
  const repo = await setupRepo("diverged")
  try {
    const base = await repo.commitFile("base.txt", "b\n", "base")
    const local = await repo.commitFile("local.txt", "l\n", "local")
    // 从 base 造远端侧提交：index 换成 {base.txt, remote.txt}，显式 ref+parent
    await repo.git.remove({
      fs: repo.fs,
      dir: repo.workdir,
      gitdir: repo.gitdir,
      filepath: "local.txt",
    })
    const remote = await repo.commitFile("remote.txt", "r\n", "remote", {
      ref: "refs/heads/side",
      parent: [base],
    })
    await writeRef(repo, "refs/remotes/origin/main", remote)

    const res = await repo.compare()
    assert(res != null, "应返回结果")
    assert(
      res.syncState === "diverged" && res.ahead === 1 && res.behind === 1,
      "应分叉（各 1 条）"
    )
    assert(res.mergeBaseOid === base, "基点应为 base")
    assert(res.localOid === local && res.remoteOid === remote, "两端 oid")
    assert(
      res.aheadCommits.length === 1 && res.aheadCommits[0].oid === local,
      "应加载领先提交"
    )
    assert(
      res.behindCommits.length === 1 && res.behindCommits[0].oid === remote,
      "应加载落后提交"
    )
    assert(res.localFiles.length === 0 && res.remoteFiles.length === 0, "不计算文件改动")
  } finally {
    await repo.cleanup()
  }
}

/** 无共同祖先：仅统计两侧提交数 */
async function testNoMergeBase(): Promise<void> {
  const repo = await setupRepo("nomergebase")
  try {
    await repo.commitFile("a.txt", "a\n", "local root")
    // orphan 提交（parent: []），tree 为当前 index {a.txt, z.txt}
    const orphan = await repo.commitFile("z.txt", "z\n", "orphan", {
      ref: "refs/heads/orphan",
      parent: [],
    })
    await writeRef(repo, "refs/remotes/origin/main", orphan)

    const res = await repo.compare()
    assert(res != null, "应返回结果")
    assert(res.mergeBaseOid === null, "无共同祖先时基点应为 null")
    assert(
      res.syncState === "diverged" && res.ahead === 1 && res.behind === 1,
      "无共同祖先各计 1 条"
    )
    assert(
      res.aheadCommits.length === 1 && res.behindCommits.length === 1,
      "无共同祖先时两侧提交都应显示"
    )
    assert(res.localFiles.length === 0 && res.remoteFiles.length === 0, "不计算文件改动")
  } finally {
    await repo.cleanup()
  }
}

/** 无远端跟踪 ref：返回 null（UI 空态） */
async function testNoRemoteRef(): Promise<void> {
  const repo = await setupRepo("noremote")
  try {
    await repo.commitFile("a.txt", "a\n", "c1")
    const res = await repo.compare()
    assert(res === null, "远端无跟踪 ref 应返回 null")
  } finally {
    await repo.cleanup()
  }
}

/** upstream 配置优先于 origin/同名 */
async function testUpstreamConfig(): Promise<void> {
  const repo = await setupRepo("upstream")
  try {
    const base = await repo.commitFile("a.txt", "a\n", "base")
    await repo.git.setConfig({
      fs: repo.fs,
      dir: repo.workdir,
      gitdir: repo.gitdir,
      path: "branch.main.remote",
      value: "upstream",
    })
    await repo.git.setConfig({
      fs: repo.fs,
      dir: repo.workdir,
      gitdir: repo.gitdir,
      path: "branch.main.merge",
      value: "refs/heads/main",
    })
    const local = await repo.commitFile("a.txt", "a2\n", "local")
    await writeRef(repo, "refs/remotes/upstream/main", base)

    const res = await repo.compare()
    assert(res != null, "应返回结果")
    assert(res.track === "upstream/main", "track 应来自 upstream 配置")
    assert(res.localOid === local && res.remoteOid === base, "两端 oid")
    assert(res.syncState === "ahead" && res.ahead === 1, "应领先 1 条")
  } finally {
    await repo.cleanup()
  }
}

async function main(): Promise<void> {
  await testUpToDate()
  await testAheadOnly()
  await testBehindOnly()
  await testDiverged()
  await testNoMergeBase()
  await testNoRemoteRef()
  await testUpstreamConfig()
  console.log("✅ compare tests passed")
}

main()
  .then(() => Script.exit("compare tests passed"))
  .catch((error) => {
    console.error(error)
    throw error
  })
