import { Button, HStack, Image, List, Navigation, Section, Text, useMemo, useState } from "scripting"
import { ProjectHistory, Snapshot } from "../types"
import { Metric } from "../components/rows"
import { useToast } from "../hooks/useToast"
import { collectFiles, pathExists } from "../utils/fs"
import { formatBytes } from "../utils/format"
import { isSelfProject } from "../services/history"
import { restoreSnapshot } from "../services/backup"

export function SnapshotDetailPage({
  project,
  snapshot,
  onRestoreComplete,
}: {
  project: ProjectHistory
  snapshot: Snapshot
  onRestoreComplete?: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const { showToast, toastProps } = useToast()
  const [isRestoring, setIsRestoring] = useState(false)
  const files = useMemo(() => collectFiles(snapshot.path), [snapshot.path])
  const canRestore = !isSelfProject(project) && pathExists(project.projectPath)

  function handleRestore() {
    if (isRestoring) {
      return
    }

    setIsRestoring(true)
    restoreSnapshot(project, snapshot)
      .then((restored) => {
        if (!restored) {
          return
        }

        dismiss()
        onRestoreComplete?.()
      })
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), true))
      .finally(() => setIsRestoring(false))
  }

  return (
    <List navigationTitle="快照详情" navigationBarTitleDisplayMode="inline" toast={toastProps}>
      <Section>
        <Metric title="项目" value={project.name} />
        <Metric title="描述" value={snapshot.description} />
        <Metric title="时间" value={snapshot.timestampLabel} />
        <Metric title="文件" value={`${snapshot.fileCount} 个 · ${formatBytes(snapshot.byteSize)}`} />
      </Section>
      <Section title="操作">
        {canRestore ? (
          <Button
            title={isRestoring ? "正在还原" : "还原到此快照"}
            systemImage="arrow.uturn.backward.circle"
            role="destructive"
            action={handleRestore}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">当前项目不可还原</Text>
        )}
      </Section>
      <Section title={`文件预览（${snapshot.fileCount}）`}>
        {files.map((file) => (
          <HStack key={file} spacing={10}>
            <Image systemName="doc" foregroundStyle="secondaryLabel" />
            <Text font={13}>{file}</Text>
          </HStack>
        ))}
        {snapshot.fileCount > files.length ? (
          <Text foregroundStyle="secondaryLabel">还有 {snapshot.fileCount - files.length} 个文件未显示</Text>
        ) : null}
      </Section>
    </List>
  )
}
