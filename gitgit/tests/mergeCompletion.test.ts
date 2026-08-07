/**
 * tests/mergeCompletion.test.ts - 完成冲突合并时提交完整合并结果
 *
 * 走真实链路：git.merge 冲突 → 解决 → completeMergeInternal。
 * 覆盖：冲突解决、自动修改、新增、删除、双亲提交、无关改动隔离、状态清理。
 */
import { Script } from "scripting"
import { createFS, loadGitEngine } from "../services/gitCore"
import {
  completeMergeInternal,
  readMergeStateFile,
  writeMergeStateFile,
} from "../services/git/mergeConflictService"
import { readRepos, writeRepos } from "../services/storage"

const AUTHOR = { name: "gitgit", email: "gitgit@local" }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

async function readBlobText(
  git: any,
  fs: any,
  dir: string,
  gitdir: string,
  oid: string,
  filepath: string
): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, gitdir, oid, filepath })
    return new TextDecoder().decode(blob)
  } catch (_e) {
    return null
  }
}

async function main(): Promise<void> {
  const ts = Date.now()
  const root = FileManager.appGroupDocumentsDirectory + "/gitgit-tests/merge-completion-" + ts
  const workdir = root + "/work"
  const repoId = "mergecomplete" + ts
  const bookmarkName = "merge-complete-" + ts
  const gitdir = FileManager.appGroupDocumentsDirectory + "/git-repos/" + repoId
  await FileManager.createDirectory(workdir, true)
  await FileManager.createDirectory(gitdir, true)
  const previousRepos = readRepos()

  try {
    const { git } = await loadGitEngine()
    const fs = createFS(gitdir, workdir)
    await git.init({ fs, dir: workdir, gitdir, defaultBranch: "main" })

    for (const [path, content] of [
      ["conflict.txt", "base\n"],
      ["auto.txt", "base\n"],
      ["deleted.txt", "delete me\n"],
      ["deleted2.txt", "delete me too\n"],
      ["unrelated.txt", "base unrelated\n"],
      ["local-only.txt", "base local\n"],
    ]) {
      await fs.writeFile(path, content)
    }
    await git.add({ fs, dir: workdir, gitdir, filepath: "." })
    await git.commit({ fs, dir: workdir, gitdir, message: "base", author: AUTHOR })

    // theirs：冲突修改 + 自动修改 + 新增 + 删除
    await git.branch({ fs, dir: workdir, gitdir, ref: "theirs", checkout: true })
    await fs.writeFile("conflict.txt", "theirs\n")
    await fs.writeFile("auto.txt", "theirs auto\n")
    await fs.writeFile("added.txt", "theirs added\n")
    await fs.unlink("deleted.txt")
    await fs.unlink("deleted2.txt")
    for (const path of ["conflict.txt", "auto.txt", "added.txt"]) {
      await git.add({ fs, dir: workdir, gitdir, filepath: path })
    }
    await git.remove({ fs, dir: workdir, gitdir, filepath: "deleted.txt" })
    await git.remove({ fs, dir: workdir, gitdir, filepath: "deleted2.txt" })
    const theirsOid = await git.commit({
      fs, dir: workdir, gitdir, message: "theirs", author: AUTHOR,
    })

    // ours：冲突修改 + 本地单侧修改
    await git.checkout({ fs, dir: workdir, gitdir, ref: "main", force: true })
    await fs.writeFile("conflict.txt", "ours\n")
    await fs.writeFile("local-only.txt", "ours local\n")
    for (const path of ["conflict.txt", "local-only.txt"]) {
      await git.add({ fs, dir: workdir, gitdir, filepath: path })
    }
    const oursOid = await git.commit({
      fs, dir: workdir, gitdir, message: "ours", author: AUTHOR,
    })

    // 真实合并：冲突抛出，非冲突文件应由引擎自动写入工作区
    let mergeErr: any = null
    try {
      await git.merge({
        fs, dir: workdir, gitdir,
        ours: "main", theirs: theirsOid,
        abortOnConflict: false, author: AUTHOR,
      })
    } catch (e: any) {
      mergeErr = e
    }
    assert(mergeErr?.code === "MergeConflictError", "应抛出合并冲突错误")
    assert(
      String(await fs.readFile("auto.txt", "utf8")) === "theirs auto\n",
      "自动合并文件应已写入工作区（否则需改为从 theirs 树取内容）"
    )
    assert(
      String(await fs.readFile("added.txt", "utf8")) === "theirs added\n",
      "合并新增文件应已写入工作区"
    )
    assert(
      await fs.exists("deleted.txt"),
      "记录引擎行为：自动合并的删除不会落到工作区，需完成合并时补齐"
    )

    // 注册临时仓库并写入「已全部解决」的合并状态
    writeRepos([
      ...previousRepos,
      {
        name: "merge-complete-test",
        bookmarkName,
        repoId,
        workdir,
        source: "local",
        createdAt: ts,
      },
    ])
    await writeMergeStateFile(gitdir, {
      oursOid,
      theirsOid,
      oursLabel: "main",
      theirsLabel: "theirs",
      message: "merge theirs",
      conflicts: [],
      startedAt: ts,
    })

    // 用户解决冲突文件；同时制造合并期间的其他工作区编辑
    await fs.writeFile("conflict.txt", "resolved\n")
    await git.add({ fs, dir: workdir, gitdir, filepath: "conflict.txt" })
    await fs.writeFile("unrelated.txt", "later unrelated\n")
    await fs.writeFile("local-only.txt", "later local edit\n")
    // 用户在解决期间重建了对方删除的文件：应按用户版本保留
    await fs.writeFile("deleted2.txt", "recreated\n")

    const mergeOid = await completeMergeInternal(bookmarkName, undefined, AUTHOR)

    const mergeCommit = await git.readCommit({ fs, dir: workdir, gitdir, oid: mergeOid })
    assert(mergeCommit.commit.parent.length === 2, "合并提交必须保留双亲")
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "conflict.txt")) === "resolved\n",
      "合并提交应包含冲突解决内容"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "auto.txt")) === "theirs auto\n",
      "合并提交应包含自动合并内容"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "added.txt")) === "theirs added\n",
      "合并提交应包含新增文件"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "deleted.txt")) == null,
      "合并提交应包含删除结果"
    )
    assert(
      !(await fs.exists("deleted.txt")),
      "完成合并后应补齐删除工作区文件，避免残留未跟踪改动"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "deleted2.txt")) ===
        "recreated\n",
      "用户重建的被删文件应按用户版本进入合并提交"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "unrelated.txt")) ===
        "base unrelated\n",
      "无关工作区改动不应进入合并提交"
    )
    assert(
      (await readBlobText(git, fs, workdir, gitdir, mergeOid, "local-only.txt")) ===
        "ours local\n",
      "本地单侧路径应保持 ours 提交内容"
    )
    assert(
      String(await fs.readFile("unrelated.txt", "utf8")) === "later unrelated\n",
      "无关工作区改动应继续保留"
    )
    assert(
      String(await fs.readFile("local-only.txt", "utf8")) === "later local edit\n",
      "本地单侧路径的后续编辑应继续保留"
    )
    assert((await readMergeStateFile(gitdir)) == null, "完成后应清除合并状态文件")
  } finally {
    writeRepos(previousRepos)
    try {
      if (FileManager.bookmarkExists("gitgit-access-" + repoId)) {
        FileManager.removeFileBookmark("gitgit-access-" + repoId)
      }
      await FileManager.remove(root)
      await FileManager.remove(gitdir)
    } catch (_e) {
      // 测试清理失败不阻断结果
    }
  }

  console.log("✅ merge completion tests passed")
  Script.exit("merge completion tests passed")
}

main().catch((error) => {
  console.error(error)
  throw error
})
