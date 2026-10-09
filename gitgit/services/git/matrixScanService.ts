import { StatusCoordinator } from "../../utils/statusCoordinator"
import { createScanDiagnostics } from "../../utils/scanDiagnostics"
import { measureOperation } from "../../utils/performance"
import { findRepo, listRepos, getGitdirPath } from "../repoStore"
import type { GitContext } from "./runtime"

export type StatusMatrix = [string, number, number, number][]
export const statusCoordinator = new StatusCoordinator<StatusMatrix>()
let scanSequence = 0
let mutationSequence = 0

function scanMatrix(key: string, ctx: GitContext, source: string, name: string): Promise<StatusMatrix> {
  return statusCoordinator.scan(key, source, async (run) => {
    const scanId = `scan-${++scanSequence}`
    const diagnostic = createScanDiagnostics({
      scanId, repoId: ctx.gitdir.split("/").pop() || name,
      repoName: name, source, queuedAt: run.queuedAt,
      startedAt: run.startedAt, activeScans: run.activeScans,
    })
    run.sources.forEach((item) => diagnostic.addSource(item))
    run.onSource = (item) => diagnostic.addSource(item)
    let rows = 0
    let failed = true
    try {
      const matrix = await measureOperation<StatusMatrix>(
        "扫描仓库工作区矩阵",
        () => ctx.git.statusMatrix({
          fs: diagnostic.wrapFS(ctx.fs), dir: ctx.dir, gitdir: ctx.gitdir,
        }),
        `${name} · ${scanId}`
      )
      rows = matrix.length
      failed = false
      return matrix
    } finally {
      diagnostic.finish(rows, failed)
    }
  })
}

// 状态读者共用同一仓库正在进行的矩阵，不保存完整矩阵的长期副本。
export function scanStatusMatrix(bookmarkName: string, ctx: GitContext, source: string): Promise<StatusMatrix> {
  return scanMatrix(ctx.gitdir, ctx, source, findRepo(bookmarkName)?.name || bookmarkName)
}

// 内部写流程已持有写屏障，不可再走读入口；安全检查独立扫描，绝不复用先前结果。
export function scanMutationMatrix(ctx: GitContext, source: string): Promise<StatusMatrix> {
  const repo = listRepos().find((item) => getGitdirPath(item) === ctx.gitdir)
  const name = repo?.name || ctx.gitdir.split("/").pop() || "仓库"
  return scanMatrix(`${ctx.gitdir}:mutation:${++mutationSequence}`, ctx, source, name)
}
