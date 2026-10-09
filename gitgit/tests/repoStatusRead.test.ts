import { Script } from "scripting"
import { createFS, loadGitEngine } from "../services/gitCore"
import { getChanges, getManagedBranches, getRepoListStatus, removeRepo, stageAll } from "../services/gitService"
import { resolveGitdir } from "../services/git/runtime"
import { readRepos, writeRepos, readSnapshots, writeSnapshots } from "../services/storage"
import { clearScanDiagnostics, getScanDiagnostics } from "../utils/scanDiagnostics"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

async function main() {
  const key = `status-read-test-${Date.now()}`
  const workdir = FileManager.temporaryDirectory + "/" + key
  const previousRepos = readRepos()
  const previousSnapshots = readSnapshots()
  const gitdir = resolveGitdir(key)
  try {
    await FileManager.createDirectory(workdir, true)
    await FileManager.createDirectory(gitdir, true)
    writeRepos([...previousRepos, {
      bookmarkName: key, repoId: key, name: key, workdir, createdAt: Date.now(), source: "local",
    }])
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, workdir)
    const options = { git, fs, dir: workdir, gitdir }
    await git.init({ ...options, defaultBranch: "main" })
    await fs.writeFile("a.txt", "one\n")
    await git.add({ ...options, filepath: "a.txt" })
    await git.commit({ ...options, message: "fixture", author: { name: "Test", email: "test@example.invalid" } })
    clearScanDiagnostics()
    assert((await getRepoListStatus(key, undefined, { source: "列表出现", force: false })).uncommitted === 0, "首轮干净")
    assert(getScanDiagnostics().length === 1, "首轮扫描一次")
    await getRepoListStatus(key, undefined, { source: "列表出现", force: false })
    assert(getScanDiagnostics().length === 1, "30秒内自动刷新复用本仓缓存")

    // 与 HEAD 相比是同秒内的同长度修改；引擎 stat 快路径只比较秒级 mtime 与 size，
    // 改用不同长度内容确保改动必定被实时扫描识别（详见上游 racy 限制）。
    await fs.writeFile("a.txt", "two-lines\n")
    const forced = await getRepoListStatus(key, undefined, { source: "列表下拉", force: true })
    assert(forced.uncommitted === 1 && getScanDiagnostics().length === 2, "强制刷新发现外部改动")
    const changes = await getChanges(key, "详情下拉")
    const afterChanges = getScanDiagnostics().length
    await getRepoListStatus(key, changes.length, { source: "详情摘要" })
    assert(getScanDiagnostics().length === afterChanges, "已知计数摘要不再次扫描")
    await getRepoListStatus(key, undefined, { source: "列表出现", force: false })
    assert(getScanDiagnostics().length === afterChanges, "详情摘要直接成为列表缓存")

    await stageAll(key)
    const afterWrite = getScanDiagnostics().length
    await getRepoListStatus(key, undefined, { source: "列表出现", force: false })
    assert(getScanDiagnostics().length === afterWrite + 1, "写后原缓存失效，重新扫描")
    // 详情改动缓存：stageAll 前的实时读取已写入缓存，写操作必须清空它；
    // 清空后“出现”重新扫描，随后 30 秒内复用，下拉绕过实时
    clearScanDiagnostics()
    const afterMutation = await getChanges(key, "详情出现", { fresh: true })
    assert(getScanDiagnostics().length === 1, "写后改动缓存失效，出现路径重新扫描")
    assert(afterMutation[0]?.staged, "重新扫描读到暂存语义")
    const cachedChanges = await getChanges(key, "详情出现", { fresh: true })
    assert(getScanDiagnostics().length === 1, "30秒内详情出现复用按仓改动缓存")
    assert(
      cachedChanges.length === afterMutation.length &&
        cachedChanges[0]?.filepath === afterMutation[0]?.filepath &&
        cachedChanges[0]?.staged === afterMutation[0]?.staged,
      "复用结果保留文件与暂存语义",
    )
    await getChanges(key, "详情下拉")
    assert(getScanDiagnostics().length === 2, "详情下拉绕过缓存实时扫描")

    await fs.unlink(workdir + "/a.txt")
    await getManagedBranches(key)
    assert(!(await fs.exists(workdir + "/a.txt")), "分支只读查询不擅自恢复删除文件")
    assert((await getChanges(key))[0].unstaged, "空工作区删除被保留并识别")

    await removeRepo(key)
    assert(!(await FileManager.exists(gitdir)), "删除等待状态读取后清理 Git 数据")
    const missing = await getRepoListStatus(key, undefined, { force: false })
    assert(!!missing.error, "删除后不复活缓存")
    assert(!(await FileManager.exists(gitdir)), "迟到查询不重建被删除 gitdir")
  } finally {
    // 仅清理唯一测试条目和目录，并恢复测试前的存储。
    if (readRepos().some((repo) => repo.bookmarkName === key)) await removeRepo(key)
    writeRepos(previousRepos)
    writeSnapshots(previousSnapshots)
    if (await FileManager.exists(workdir)) await FileManager.remove(workdir)
    if (await FileManager.exists(gitdir)) await FileManager.remove(gitdir)
  }
}

main().then(
  () => Script.exit("repo status read tests passed"),
  (error) => {
    console.error(error)
    Script.exit("repo status read tests failed: " + error)
    throw error
  }
)
