import {
  ForEach,
  List,
  NavigationLink,
  Path,
  Section,
  Text,
  Toolbar,
  ToolbarItem,
  useObservable,
} from "scripting"
import { ProjectHistory, Snapshot } from "../types"
import { DeleteSwipeButton, IconButton } from "../components/buttons"
import { EmptyState, SnapshotRow } from "../components/rows"
import { useToast } from "../hooks/useToast"
import { removeExistingPath } from "../utils/fs"
import { refreshProjectHistory } from "../services/history"
import { createProjectBackup } from "../services/backup"
import { SnapshotDetailPage } from "./SnapshotDetailPage"

export function HistoryPage({
  project,
  onProjectChange,
}: {
  project: ProjectHistory
  onProjectChange?: () => void
}) {
  const currentProject = useObservable<ProjectHistory>(() => refreshProjectHistory(project))
  const snapshots = useObservable<Snapshot[]>(() => currentProject.value.snapshots)
  const { showToast, toastProps } = useToast()

  function refreshSnapshots() {
    const nextProject = refreshProjectHistory(currentProject.value)
    currentProject.setValue(nextProject)
    snapshots.setValue(nextProject.snapshots)
  }

  async function deleteSnapshot(snapshot: Snapshot) {
    const index = await Dialog.actionSheet({
      title: "删除确认",
      message: `确定删除快照「${snapshot.description}」？此操作不可恢复。`,
      actions: [{ label: "取消" }, { label: "删除", destructive: true }],
      cancelButton: false,
    })

    if (index !== 1) {
      return
    }

    try {
      removeExistingPath(snapshot.path)
      showToast("已删除")
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true)
    }
    refreshSnapshots()
    onProjectChange?.()
  }

  // 主动备份当前项目
  async function createBackup() {
    try {
      const description = await Dialog.prompt({
        title: "备份描述",
        message: `为项目「${currentProject.value.name}」创建备份`,
        defaultValue: "主动备份",
        placeholder: "例如：发布前备份",
        cancelLabel: "取消",
        confirmLabel: "开始备份",
      })
      if (description == null) {
        showToast("已取消备份")
        return
      }

      // 用当前备份目录的父目录作为备份根，保证新快照与已有快照存放在一起
      const backupRoot = Path.dirname(currentProject.value.path)
      createProjectBackup(currentProject.value.projectPath, backupRoot, description)
      showToast("备份已创建")
      refreshSnapshots()
      onProjectChange?.()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true)
    }
  }

  return (
    <List
      navigationTitle={currentProject.value.name}
      navigationBarTitleDisplayMode="inline"
      toast={toastProps}
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <IconButton systemName="plus" action={createBackup} />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <Section
        header={<Text>{`历史记录（${snapshots.value.length}）`}</Text>}
        footer={<Text>描述表示创建该备份时将要进行的修改，备份内容是修改前的项目状态。</Text>}
      >
        {snapshots.value.length === 0 ? (
          <EmptyState message="当前项目没有历史记录" />
        ) : (
          <ForEach
            data={snapshots}
            builder={(snapshot) => (
              <NavigationLink
                key={snapshot.id}
                destination={
                  <SnapshotDetailPage
                    project={currentProject.value}
                    snapshot={snapshot}
                    onRestoreComplete={() => {
                      refreshSnapshots()
                      showToast("已还原，如未生效请手动构建项目")
                    }}
                  />
                }
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [<DeleteSwipeButton action={() => deleteSnapshot(snapshot)} />],
                }}
              >
                <SnapshotRow snapshot={snapshot} />
              </NavigationLink>
            )}
          />
        )}
      </Section>
    </List>
  )
}
