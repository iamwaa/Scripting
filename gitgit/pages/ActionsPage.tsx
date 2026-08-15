/**
 * pages/ActionsPage.tsx - GitHub Actions 工作流运行列表页
 *
 * 展示仓库最近的工作流运行，支持按工作流筛选、分页加载更多。
 * 右上角 toolbar 提供手动触发工作流入口。
 * 点击运行项进入 ActionRunDetailPage 查看 job 与日志。
 */

import {
  Button,
  HStack,
  Image,
  List,
  Menu,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useRef,
  useState,
  type ShapeStyle,
} from "scripting"
import type { ActionRun, ActionWorkflow } from "../types/github"
import { deleteWorkflowRun, dispatchWorkflow, listWorkflows, listWorkflowRuns } from "../api/githubApi"
import { AvatarView } from "../components/AvatarView"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import { ActionRunDetailPage } from "./ActionRunDetailPage"
import { relativeTime } from "../utils/format"
import {
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

const PAGE_SIZE = 30

/** 运行状态对应的图标与颜色 */
function runStatusVisual(run: ActionRun): { icon: string; color: ShapeStyle; label: string } {
  if (run.status === "in_progress") {
    return { icon: "arrow.triangle.2.circlepath", color: COLOR_ORANGE, label: "进行中" }
  }
  if (run.status === "queued") {
    return { icon: "clock", color: COLOR_ORANGE, label: "排队中" }
  }
  // completed
  switch (run.conclusion) {
    case "success":
      return { icon: "checkmark.circle.fill", color: COLOR_GREEN, label: "成功" }
    case "failure":
      return { icon: "xmark.circle.fill", color: COLOR_RED, label: "失败" }
    case "cancelled":
      return { icon: "minus.circle.fill", color: COLOR_SECONDARY_LABEL, label: "已取消" }
    case "skipped":
      return { icon: "forward.circle.fill", color: COLOR_SECONDARY_LABEL, label: "已跳过" }
    case "timed_out":
      return { icon: "exclamationmark.triangle.fill", color: COLOR_RED, label: "超时" }
    default:
      return { icon: "circle.fill", color: COLOR_SECONDARY_LABEL, label: run.conclusion || "完成" }
  }
}

function ActionRunRow({
  run,
  onSelect,
  onDelete,
}: {
  run: ActionRun
  onSelect: () => void
  onDelete: () => void
}) {
  const { icon, color, label } = runStatusVisual(run)
  return (
    <Button
      action={onSelect}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button
            title="删除"
            tint="red"
            action={onDelete}
          />,
        ],
      }}
    >
      <HStack alignment="center" spacing={10} frame={{ maxWidth: "infinity" }}>
        <Image systemName={icon} font={16} foregroundStyle={color} />
        <VStack
          alignment="leading"
          spacing={3}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Text font={15} foregroundStyle={COLOR_LABEL} lineLimit={2}>
            {run.displayTitle || run.name}
          </Text>
          <HStack alignment="center" spacing={6}>
            <Text font={12} foregroundStyle={color}>{label}</Text>
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              {run.workflowName}
            </Text>
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>·</Text>
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              {run.headBranch}
            </Text>
          </HStack>
          <HStack alignment="center" spacing={6}>
            <AvatarView url={run.actorAvatarUrl} size={14} />
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              {run.actorLogin} · {run.event} · {relativeTime(run.updatedAt)}
            </Text>
            {run.headShaShort ? (
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                · {run.headShaShort}
              </Text>
            ) : null}
          </HStack>
        </VStack>
        <Image systemName="chevron.right" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
      </HStack>
    </Button>
  )
}

export function ActionsPage({ fullName }: { fullName: string }) {
  const [runs, setRuns] = useState<ActionRun[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const requestRef = useRef(0)

  // 工作流筛选
  const [workflows, setWorkflows] = useState<ActionWorkflow[]>([])
  // null = 全部工作流；否则为工作流 ID
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null)
  const [dispatching, setDispatching] = useState(false)

  async function load(reset = true) {
    const request = ++requestRef.current
    const nextPage = reset ? 1 : page + 1
    reset ? setLoading(true) : setLoadingMore(true)
    try {
      const result = await listWorkflowRuns(fullName, nextPage, PAGE_SIZE, selectedWorkflowId || undefined)
      if (request !== requestRef.current) return
      setRuns((current) => (reset ? result.runs : [...current, ...result.runs]))
      setPage(nextPage)
      setHasMore(result.hasMore)
    } catch (e: any) {
      if (request === requestRef.current) showToast("加载失败：" + String(e?.message || e), "error")
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  async function loadWorkflows() {
    try {
      const list = await listWorkflows(fullName)
      setWorkflows(list)
    } catch (_e) {
      // 工作流列表加载失败不阻塞运行列表
    }
  }

  useEffect(() => {
    setRuns([])
    load(true)
  }, [fullName, selectedWorkflowId])

  useEffect(() => {
    loadWorkflows()
  }, [fullName])

  // 手动触发工作流
  async function handleDispatch(workflow: ActionWorkflow) {
    if (dispatching) return
    const result = await Dialog.prompt({
      title: `触发 ${workflow.displayName}`,
      message: "输入目标分支名（默认 main）",
      defaultValue: "main",
      placeholder: "分支名",
    })
    if (result == null) return
    const ref = result.trim() || "main"
    setDispatching(true)
    try {
      await dispatchWorkflow(fullName, workflow.id, { ref })
      showToast("已触发 " + workflow.displayName + "（" + ref + "）", "success")
      // 触发后延迟刷新列表
      setTimeout(() => load(true), 2000)
    } catch (e: any) {
      showToast("触发失败：" + String(e?.message || e), "error")
    } finally {
      setDispatching(false)
    }
  }

  // 左滑删除工作流运行
  async function handleDeleteRun(run: ActionRun) {
    const result = await Dialog.actionSheet({
      title: "删除工作流运行",
      message: `确认删除运行 #${run.id}（${run.displayTitle || run.name}）？\n此操作不可恢复，会删除全部记录、日志与工件。`,
      cancelButton: false,
      actions: [
        { label: "取消" },
        { label: "删除", destructive: true },
      ],
    })
    // actions 索引：0=取消，1=删除；取消返回 null
    if (result !== 1) return
    try {
      await deleteWorkflowRun(fullName, run.id)
      // 从列表中移除已删除的运行
      setRuns((current) => current.filter((r) => r.id !== run.id))
      showToast("已删除运行 #" + run.id, "success")
    } catch (e: any) {
      showToast("删除失败：" + String(e?.message || e), "error")
    }
  }

  return (
    <List
      navigationTitle={fullName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      navigationDestination={{
        isPresented: selectedRunId != null,
        onChanged: (presented: boolean) => {
          if (!presented) setSelectedRunId(null)
        },
        content: selectedRunId != null ? (
          <ActionRunDetailPage
            key={`${fullName}-${selectedRunId}`}
            fullName={fullName}
            runId={selectedRunId}
          />
        ) : (
          <Text>加载中…</Text>
        ),
      }}
      toolbar={{
        topBarTrailing: (
          <Menu
            title="触发"
            systemImage={dispatching ? "hourglass" : "play.circle"}
          >
            {workflows.length === 0 ? (
              <Button title="无可触发工作流" action={() => {}} disabled />
            ) : (
              workflows.map((wf) => (
                <Button
                  key={wf.id}
                  title={wf.state === "active" ? wf.displayName : `${wf.displayName}（已禁用）`}
                  systemImage={wf.state === "active" ? "bolt.fill" : "slash.circle"}
                  action={() => handleDispatch(wf)}
                  disabled={dispatching || wf.state !== "active"}
                />
              ))
            )}
          </Menu>
        ),
      }}
      toast={
        toastState
          ? {
              isPresented: toastPresented,
              onChanged: handleToastChanged,
              content: toastContent(toastState.message, toastState.type),
              duration: toastState.duration,
              position: "top",
            }
          : undefined
      }
    >
      {/* 工作流筛选 */}
      {workflows.length > 0 ? (
        <Section>
          <Picker
            title="工作流"
            value={selectedWorkflowId != null ? String(selectedWorkflowId) : ""}
            onChanged={(value: string) => setSelectedWorkflowId(value ? Number(value) : null)}
          >
            <Text tag="">全部工作流</Text>
            {workflows.map((wf) => (
              <Text key={wf.id} tag={String(wf.id)}>{wf.displayName}</Text>
            ))}
          </Picker>
        </Section>
      ) : null}

      <Section
        header={<Text>工作流运行（{runs.length}）</Text>}
        footer={hasMore ? (
          <HStack frame={{ maxWidth: "infinity" }}>
            <Spacer />
            <Button action={() => load(false)} disabled={loadingMore}>
              <HStack spacing={4}>
                <Image systemName={loadingMore ? "hourglass" : "chevron.down"} font={14} />
                <Text font={14}>{loadingMore ? "加载中…" : "加载更多"}</Text>
              </HStack>
            </Button>
            <Spacer />
          </HStack>
        ) : undefined}
      >
        {loading ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        ) : runs.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有工作流运行</Text>
        ) : runs.map((run) => (
          <ActionRunRow
            key={run.id}
            run={run}
            onSelect={() => setSelectedRunId(run.id)}
            onDelete={() => handleDeleteRun(run)}
          />
        ))}
      </Section>
    </List>
  )
}

export default ActionsPage
