import { Text } from "scripting"
import type { CommitEntry, RepoMeta } from "../types/git"
import { UploadGitHubPage } from "../pages/UploadGitHubPage"
import { CommitDetailPage } from "../pages/CommitDetailPage"
import { ComparePage } from "../pages/ComparePage"
import { RemotesPage } from "../pages/RemotesPage"
import { ConflictsPage } from "../pages/ConflictsPage"
import { GitHubWorkPage } from "../pages/GitHubWorkPage"
import { RollbackPage } from "../pages/RollbackPage"

export function RepoDetailDestination({
  bookmarkName,
  displayName,
  showUpload,
  showRemotes,
  showConflicts,
  showCompare,
  showRollback,
  currentBranch,
  githubFullName,
  selectedCommitOid,
  onUploaded,
  onRemotesChanged,
  onConflictsChanged,
  onRollbackSelect,
}: {
  bookmarkName: string
  displayName: string
  showUpload: boolean
  showRemotes: boolean
  showConflicts: boolean
  showCompare: boolean
  showRollback: boolean
  currentBranch: string | null
  githubFullName: string | null
  selectedCommitOid: string | null
  onUploaded: (repo: RepoMeta) => void
  onRemotesChanged: () => void
  onConflictsChanged: (reason?: "updated" | "completed") => void
  onRollbackSelect: (entry: CommitEntry) => void
}) {
  if (showUpload) {
    return (
      <UploadGitHubPage
        bookmarkName={bookmarkName}
        defaultName={displayName}
        onUploaded={onUploaded}
      />
    )
  }
  if (showRemotes) {
    return (
      <RemotesPage
        bookmarkName={bookmarkName}
        onChanged={onRemotesChanged}
      />
    )
  }
  if (showConflicts) {
    return (
      <ConflictsPage
        bookmarkName={bookmarkName}
        onChanged={onConflictsChanged}
      />
    )
  }
  if (showCompare) return <ComparePage bookmarkName={bookmarkName} />
  if (showRollback) {
    return (
      <RollbackPage
        bookmarkName={bookmarkName}
        currentBranch={currentBranch}
        onSelect={onRollbackSelect}
      />
    )
  }
  if (githubFullName) return <GitHubWorkPage fullName={githubFullName} />
  if (selectedCommitOid) {
    return (
      <CommitDetailPage
        key={selectedCommitOid}
        bookmarkName={bookmarkName}
        oid={selectedCommitOid}
      />
    )
  }
  return <Text>加载中…</Text>
}
