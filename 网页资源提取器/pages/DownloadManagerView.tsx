import {
  Navigation,
  NavigationStack,
  List,
  Section,
  Text,
  Button,
  HStack,
  VStack,
  Image,
  ProgressView,
  Spacer,
  Rectangle,
} from "scripting"
import {
  downloadTasks,
  exportDownloadTask,
  removeDownloadTask,
  cancelDownloadTask,
  pauseDownloadTask,
  resumeDownloadTask,
  retryDownloadTask,
  clearFinishedDownloadTasks,
  getActiveDownloadCount,
  type DownloadTaskItem,
} from "../state/downloadManager"
import { toastMessage, toastVisible, showToast } from "../state/appState"
import { getTypeInfo } from "../functions/resourceInfo"

declare const Dialog: any

function statusText(status: string): string {
  if (status === "downloading") return "下载中"
  if (status === "paused") return "已暂停"
  if (status === "completed") return "已完成"
  if (status === "failed") return "失败"
  if (status === "cancelled") return "已取消"
  if (status === "saving") return "导出中"
  return status
}

function formatFileSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "未知大小"

  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  const text = value >= 10 || unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1)
  return `${text}${units[unitIndex]}`
}

function savedText(task: DownloadTaskItem): string {
  if (task.savedTo === "photos") return "已保存相册"
  if (task.savedTo === "file") return "已保存文件"
  return "未保存"
}

async function confirmDestructiveAction(title: string, message: string): Promise<boolean> {
  const index = await Dialog.actionSheet({
    title,
    message,
    actions: [
      { label: "取消" },
      { label: "删除", destructive: true },
    ],
    cancelButton: false,
  })
  return index === 1
}

function deleteAction(task: DownloadTaskItem) {
  return (
    <Button
      title="删除"
      systemImage="trash"
      tint="#FF3B30"
      action={async () => {
        const confirmed = await confirmDestructiveAction(
          "删除下载任务",
          `确定要删除「${task.resource.name}」吗？相关下载文件也会被删除。`
        )
        if (confirmed) removeDownloadTask(task.id)
      }}
    />
  )
}

function swipeActions(task: DownloadTaskItem) {
  if (task.status === "completed") {
    return [
      <Button
        title="导出"
        systemImage="square.and.arrow.up"
        tint="accentColor"
        action={async () => {
          await exportDownloadTask(task.id)
          showToast("导出操作已完成")
        }}
      />,
      deleteAction(task),
    ]
  }

  if (task.status === "failed" || task.status === "cancelled") {
    return [
      <Button
        title="重试"
        systemImage="arrow.clockwise"
        tint="accentColor"
        action={() => retryDownloadTask(task.id)}
      />,
      deleteAction(task),
    ]
  }

  return []
}

export function DownloadManagerView() {
  const dismiss = Navigation.useDismiss()
  const tasks = downloadTasks.value
  const activeCount = getActiveDownloadCount()
  const hasFinishedTasks = tasks.some((item: DownloadTaskItem) =>
    item.status === "completed" || item.status === "failed" || item.status === "cancelled"
  )

  return (
    <NavigationStack>
      <List
        navigationTitle="下载管理器"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button action={dismiss}>
              <Image systemName="chevron.left" foregroundStyle="accentColor" fontWeight="semibold" />
            </Button>
          ),
          primaryAction: (
            <Button
              disabled={!hasFinishedTasks}
              action={async () => {
                if (!hasFinishedTasks) return
                const confirmed = await confirmDestructiveAction(
                  "清理下载任务",
                  "确定要清理所有已完成、失败和已取消的下载任务吗？相关下载文件也会被删除。"
                )
                if (confirmed) clearFinishedDownloadTasks()
              }}
            >
              <Text foregroundStyle="red" fontWeight="semibold">清理</Text>
            </Button>
          ),
        }}
        toast={{
          message: toastMessage.value,
          position: "top",
          isPresented: toastVisible,
          duration: 2,
        }}
      >
        <Section title="概览">
          <HStack>
            <Text>任务总数</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{tasks.length}</Text>
          </HStack>
          <HStack>
            <Text>正在下载</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{activeCount}</Text>
          </HStack>
        </Section>

        {tasks.length === 0 ? (
          <VStack
            alignment="center"
            spacing={10}
            frame={{ maxWidth: "infinity", minHeight: 420, alignment: "center" }}
            listRowBackground={<Rectangle fill="clear" />}
            listRowSeparator="hidden"
            listRowInsets={0}
          >
            <Image systemName="tray" font={34} foregroundStyle="secondaryLabel" />
            <Text foregroundStyle="secondaryLabel">暂无下载任务</Text>
          </VStack>
        ) : (
          <Section title="下载任务">
            {tasks.map((task: DownloadTaskItem) => {
              const info = getTypeInfo(task.resource.type)
              return (
                <VStack
                  key={task.id}
                  alignment="leading"
                  spacing={8}
                  padding={{ vertical: 6 }}
                  trailingSwipeActions={{ allowsFullSwipe: false, actions: swipeActions(task) }}
                >
                  <HStack spacing={12}>
                    <Image systemName={info.icon} foregroundStyle={info.color} font={22} frame={{ width: 34 }} />
                    <VStack alignment="leading" spacing={3}>
                      <Text font={15} lineLimit={1}>{task.resource.name}</Text>
                      <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
                        {formatFileSize(task.fileSize)}·{statusText(task.status)}·{savedText(task)}
                      </Text>
                    </VStack>
                    <Spacer />
                    {task.status === "downloading" && task.pause ? (
                      <Button action={() => pauseDownloadTask(task.id)} buttonStyle="borderless">
                        <Image systemName="pause.circle.fill" foregroundStyle="#FF9500" font={20} />
                      </Button>
                    ) : null}
                    {task.status === "paused" && task.resume ? (
                      <Button action={() => resumeDownloadTask(task.id)} buttonStyle="borderless">
                        <Image systemName="play.circle.fill" foregroundStyle="#34C759" font={20} />
                      </Button>
                    ) : null}
                    {task.status === "downloading" || task.status === "paused" ? (
                      <Button action={() => cancelDownloadTask(task.id)} buttonStyle="borderless">
                        <Image systemName="xmark.circle.fill" foregroundStyle="#FF3B30" font={20} />
                      </Button>
                    ) : null}
                  </HStack>

                  {task.status === "downloading" || task.status === "paused" || task.status === "saving" ? (
                    <VStack alignment="leading" spacing={4}>
                      <ProgressView value={task.progress / 100} progressViewStyle="linear" />
                      <HStack>
                        <Text font={11} foregroundStyle="secondaryLabel">{task.speed || task.label || " "}</Text>
                        <Spacer />
                        <Text font={11} foregroundStyle="secondaryLabel">{task.progress}%</Text>
                      </HStack>
                    </VStack>
                  ) : null}

                  {task.error ? (
                    <Text font={11} foregroundStyle="#FF3B30" lineLimit={2}>{task.error}</Text>
                  ) : null}
                </VStack>
              )
            })}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
