/**
 * pages/ActionRunDetailPage.tsx - 工作流运行详情页
 *
 * 展示单个运行的概要信息、Job 列表与步骤状态。
 * 点击 Job 展开步骤与日志摘要，提供「查看完整日志」入口进入富文本查看器。
 */

import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
  type ShapeStyle,
} from "scripting"
import type { ActionAnnotation, ActionArtifact, ActionJob, ActionRun, ActionStep } from "../types/github"
import {
  getWorkflowRun,
  listWorkflowJobs,
  getJobLog,
  getJobAnnotations,
  listArtifacts,
  getArtifactDownloadInfo,
} from "../api/githubApi"
import { AvatarView } from "../components/AvatarView"
import { ActionLogViewer } from "../components/ActionLogViewer"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
import { relativeTime } from "../utils/format"
import { formatStepDuration } from "../utils/actionsLog"
import {
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_ACCENT,
  COLOR_SECONDARY_LABEL,
  COLOR_TERTIARY_LABEL,
} from "../constants/colors"

/** 运行/Job 状态对应的图标与颜色（与 ActionsPage 一致） */
function statusVisual(
  status: string,
  conclusion: string | null
): { icon: string; color: ShapeStyle; label: string } {
  if (status === "in_progress") {
    return { icon: "arrow.triangle.2.circlepath", color: COLOR_ORANGE, label: "进行中" }
  }
  if (status === "queued") {
    return { icon: "clock", color: COLOR_ORANGE, label: "排队中" }
  }
  switch (conclusion) {
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
      return { icon: "circle.fill", color: COLOR_SECONDARY_LABEL, label: conclusion || "完成" }
  }
}

/** 步骤状态图标 */
function stepIcon(
  status: string,
  conclusion: string | null
): { icon: string; color: ShapeStyle } {
  if (status === "in_progress") {
    return { icon: "arrow.triangle.2.circlepath", color: COLOR_ORANGE }
  }
  if (status === "queued") {
    return { icon: "clock", color: COLOR_ORANGE }
  }
  const v = statusVisual(status, conclusion)
  return { icon: v.icon, color: v.color }
}

export function ActionRunDetailPage({
  fullName,
  runId,
}: {
  fullName: string
  runId: number
}) {
  const [run, setRun] = useState<ActionRun | null>(null)
  const [jobs, setJobs] = useState<ActionJob[]>([])
  const [error, setError] = useState<string | null>(null)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()
  // 当前展开查看日志的 Job ID
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  // 进入富文本日志查看器的 Job（名称用于标题、步骤列表与预选步骤）
  const [viewerJob, setViewerJob] = useState<{
    name: string
    log: string
    steps?: ActionStep[]
    initialStepNumber?: number
  } | null>(null)
  // 工件列表
  const [artifacts, setArtifacts] = useState<ActionArtifact[]>([])
  // 注解列表（所有 Job 的注解合并）
  const [annotations, setAnnotations] = useState<ActionAnnotation[]>([])
  const [annotationsLoading, setAnnotationsLoading] = useState(false)
  // 工件下载
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)

  async function load() {
    setError(null)
    try {
      const [runData, jobsData, artifactsData] = await Promise.all([
        getWorkflowRun(fullName, runId),
        listWorkflowJobs(fullName, runId),
        listArtifacts(fullName, runId),
      ])
      setRun(runData)
      setJobs(jobsData)
      setArtifacts(artifactsData)
      // 后台获取注解（不阻塞首屏渲染）
      loadAnnotations(jobsData)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  /** 获取所有 Job 的注解并合并 */
  async function loadAnnotations(jobsData: ActionJob[]) {
    const checkRunIds = jobsData
      .map((j) => j.checkRunId)
      .filter((id): id is number => id != null)
    if (checkRunIds.length === 0) return
    setAnnotationsLoading(true)
    try {
      const results = await Promise.all(
        checkRunIds.map((id) => getJobAnnotations(fullName, id))
      )
      const merged = results.flat()
      setAnnotations(merged)
    } catch {
      // 注解加载失败不阻塞页面
      setAnnotations([])
    } finally {
      setAnnotationsLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [fullName, runId])

  async function toggleJobLog(job: ActionJob) {
    // 再次点击同一 Job 则折叠
    if (expandedJobId === job.id) {
      setExpandedJobId(null)
      setLogText(null)
      setLogError(null)
      return
    }
    setExpandedJobId(job.id)
    setLogText(null)
    setLogError(null)
    setLogLoading(true)
    try {
      const text = await getJobLog(fullName, job.id)
      setLogText(text)
    } catch (e: any) {
      setLogError(String(e?.message || e))
    } finally {
      setLogLoading(false)
    }
  }

  /** 点击步骤：确保日志已加载后打开查看器并预选该步骤 */
  async function handleStepClick(job: ActionJob, step: ActionStep) {
    // 日志已在当前展开 Job 中加载过
    if (expandedJobId === job.id && logText) {
      setViewerJob({
        name: job.name,
        log: logText,
        steps: job.steps,
        initialStepNumber: step.number,
      })
      return
    }
    // 日志未加载：先展开 Job 并加载日志
    setExpandedJobId(job.id)
    setLogText(null)
    setLogError(null)
    setLogLoading(true)
    try {
      const text = await getJobLog(fullName, job.id)
      setLogText(text)
      // 加载成功后直接打开查看器
      setViewerJob({
        name: job.name,
        log: text,
        steps: job.steps,
        initialStepNumber: step.number,
      })
    } catch (e: any) {
      setLogError(String(e?.message || e))
      showToast("日志加载失败：" + String(e?.message || e), "error")
    } finally {
      setLogLoading(false)
    }
  }

  /** 格式化文件大小 */
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleDownload(artifact: ActionArtifact) {
    if (downloadingId != null) return
    setDownloadingId(artifact.id)
    setDownloadProgress(0)
    const tmpDir = FileManager.temporaryDirectory
    const safeName = artifact.name.replace(/[^A-Za-z0-9._-]/g, "_")
    const filepath = `${tmpDir}/${safeName}.zip`
    try {
      const { url, headers } = getArtifactDownloadInfo(fullName, artifact.id)
      // 使用 BackgroundURLSession 下载，支持进度回调
      const task = BackgroundURLSession.startDownload({
        url,
        destination: filepath,
        headers,
      })
      task.onProgress = (details) => {
        if (details.totalBytesExpectedToWrite > 0) {
          setDownloadProgress(details.totalBytesWritten / details.totalBytesExpectedToWrite)
        } else {
          setDownloadProgress(details.progress)
        }
      }
      await new Promise<void>((resolve, reject) => {
        task.onFinishDownload = (error, _details) => {
          if (error) reject(error)
          else resolve()
        }
        task.resume()
      })
      // 弹出分享面板供用户保存
      await ShareSheet.present([filepath])
      showToast("工件已下载", "success")
    } catch (e: any) {
      showToast("下载失败：" + String(e?.message || e), "error")
    } finally {
      // 无论成功、失败或取消，都清理临时文件
      try {
        if (FileManager.existsSync(filepath)) {
          FileManager.removeSync(filepath)
        }
      } catch (_e) {
        // 清理失败不影响主流程
      }
      setDownloadingId(null)
      setDownloadProgress(0)
    }
  }


  const runVisual = run
    ? statusVisual(run.status, run.conclusion)
    : null

  return (
    <List
      navigationTitle={run ? `#${run.id}` : "加载中…"}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      navigationDestination={{
        isPresented: viewerJob != null,
        onChanged: (presented: boolean) => {
          if (!presented) setViewerJob(null)
        },
        content: viewerJob != null ? (
          <ActionLogViewer
            key={viewerJob.name}
            logText={viewerJob.log}
            jobName={viewerJob.name}
            steps={viewerJob.steps}
            initialStepNumber={viewerJob.initialStepNumber}
          />
        ) : (
          <Text>加载中…</Text>
        ),
      }}
      toolbar={{
        topBarTrailing: run ? (
          <Button
            title="在 GitHub 打开"
            systemImage="safari"
            action={() => Safari.present(run.htmlUrl)}
          />
        ) : undefined,
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
      {error ? (
        <Section footer={<Text>{error}</Text>}>
          <Button title="重试" systemImage="arrow.clockwise" action={load} />
        </Section>
      ) : !run ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        </Section>
      ) : (
        <>
          {/* 运行概要 */}
          <Section header={<Text>运行概要</Text>}>
            <Text font={16} foregroundStyle={COLOR_LABEL} lineLimit={3}>
              {run.displayTitle || run.name}
            </Text>
            <HStack alignment="center" spacing={8}>
              <Image
                systemName={runVisual!.icon}
                font={14}
                foregroundStyle={runVisual!.color}
              />
              <Text font={13} foregroundStyle={runVisual!.color}>{runVisual!.label}</Text>
              <AvatarView url={run.actorAvatarUrl} size={16} />
              <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
                {run.actorLogin} · {relativeTime(run.createdAt)}
              </Text>
            </HStack>
            <HStack alignment="center" spacing={6}>
              <Image systemName="flowchart.fill" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                {run.workflowName}
              </Text>
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>·</Text>
              <Image systemName="arrow.triangle.branch" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>{run.headBranch}</Text>
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>·</Text>
              <Image systemName="bolt.fill" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>{run.event}</Text>
            </HStack>
            {run.headShaShort ? (
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                提交：{run.headShaShort}
              </Text>
            ) : null}
          </Section>

          {/* 注解（类似 GitHub 网页 Annotations） */}
          {annotationsLoading ? (
            <Section header={<Text>注解</Text>}>
              <HStack alignment="center" spacing={6}>
                <Image systemName="arrow.triangle.2.circlepath" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
                <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>加载注解中…</Text>
              </HStack>
            </Section>
          ) : annotations.length > 0 ? (
            <Section header={<Text>注解（{annotations.length}）</Text>}>
              {annotations.map((ann, idx) => {
                const isFailure = ann.level === "failure"
                const isWarning = ann.level === "warning"
                const icon = isFailure ? "xmark.octagon.fill" : isWarning ? "exclamationmark.triangle.fill" : "info.circle.fill"
                const color = isFailure ? COLOR_RED : isWarning ? COLOR_ORANGE : COLOR_ACCENT
                return (
                  <VStack key={idx} alignment="leading" spacing={4}>
                    {/* 图标与文本紧贴：图标自然尺寸 + 零间距，消除 SF Symbol 内边距造成的视觉空隙 */}
                    <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity" }}>
                      <Image systemName={icon} font={17} foregroundStyle={color} />
                      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }} padding={{ leading: 6 }}>
                        {ann.title ? (
                          <Text font={13} foregroundStyle={COLOR_LABEL} lineLimit={2}>
                            {ann.title}
                          </Text>
                        ) : null}
                        <Text font={12} foregroundStyle={isFailure ? COLOR_RED : COLOR_SECONDARY_LABEL} lineLimit={4}>
                          {ann.message}
                        </Text>
                        {ann.path ? (
                          <HStack alignment="center" spacing={4}>
                            <Image systemName="doc.text" font={10} foregroundStyle={COLOR_TERTIARY_LABEL} />
                            <Text font={11} foregroundStyle={COLOR_TERTIARY_LABEL} lineLimit={1}>
                              {ann.path}{ann.startLine ? `:${ann.startLine}` : ""}
                            </Text>
                          </HStack>
                        ) : null}
                      </VStack>
                    </HStack>
                  </VStack>
                )
              })}
            </Section>
          ) : null}

          {/* Jobs */}
          <Section header={<Text>Jobs（{jobs.length}）</Text>}>
            {jobs.length === 0 ? (
              <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有 Job</Text>
            ) : (
              jobs.map((job) => {
                const v = statusVisual(job.status, job.conclusion)
                const isExpanded = expandedJobId === job.id
                return (
                  <VStack key={job.id} alignment="leading" spacing={8}>
                    <Button
                      action={() => toggleJobLog(job)}
                      buttonStyle="plain"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                        <Image systemName={v.icon} font={14} foregroundStyle={v.color} />
                        <Text font={14} foregroundStyle={COLOR_LABEL} lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                          {job.name}
                        </Text>
                        <Text font={12} foregroundStyle={v.color}>{v.label}</Text>
                        <Image
                          systemName={isExpanded ? "chevron.down" : "chevron.right"}
                          font={12}
                          foregroundStyle={COLOR_SECONDARY_LABEL}
                        />
                      </HStack>
                    </Button>

                    {/* 步骤列表（可点击查看对应步骤日志） */}
                    {isExpanded && job.steps.length > 0 ? (
                      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
                        {job.steps.map((step) => {
                          const si = stepIcon(step.status, step.conclusion)
                          const duration = formatStepDuration(step.startedAt, step.completedAt)
                          return (
                            <Button
                              key={step.number}
                              action={() => handleStepClick(job, step)}
                              buttonStyle="plain"
                              disabled={logLoading}
                              frame={{ maxWidth: "infinity", alignment: "leading" }}
                            >
                              <HStack alignment="center" spacing={6}>
                                <Image systemName={si.icon} font={11} foregroundStyle={si.color} />
                                <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                                  {step.name}
                                </Text>
                                {duration ? (
                                  <Text font={11} foregroundStyle={COLOR_TERTIARY_LABEL}>
                                    {duration}
                                  </Text>
                                ) : null}
                                {logLoading ? (
                                  <Image systemName="arrow.triangle.2.circlepath" font={10} foregroundStyle={COLOR_TERTIARY_LABEL} />
                                ) : (
                                  <Image systemName="chevron.right" font={10} foregroundStyle={COLOR_TERTIARY_LABEL} />
                                )}
                              </HStack>
                            </Button>
                          )
                        })}
                      </VStack>
                    ) : null}

                    {/* 步骤加载中提示 */}
                    {isExpanded && logLoading ? (
                      <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>加载日志中…</Text>
                    ) : null}
                    {isExpanded && logError ? (
                      <Text font={12} foregroundStyle={COLOR_RED}>日志加载失败：{logError}</Text>
                    ) : null}
                  </VStack>
                )
              })
            )}
          </Section>

          {/* 工件 */}
          {artifacts.length > 0 ? (
            <Section header={<Text>工件（{artifacts.length}）</Text>}>
              {artifacts.map((artifact) => (
                <VStack key={artifact.id} alignment="leading" spacing={4}>
                  <HStack alignment="center" spacing={8} frame={{ maxWidth: "infinity" }}>
                    <Image
                      systemName={artifact.expired ? "tray.fill" : "tray"}
                      font={14}
                      foregroundStyle={artifact.expired ? COLOR_RED : COLOR_SECONDARY_LABEL}
                    />
                    <Text font={14} foregroundStyle={COLOR_LABEL} lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      {artifact.name}
                    </Text>
                    {!artifact.expired ? (
                      downloadingId === artifact.id ? (
                        <Text font={14} foregroundStyle={COLOR_SECONDARY_LABEL}>
                          {Math.round(downloadProgress * 100)}%
                        </Text>
                      ) : (
                        <HStack alignment="center">
                          <Button
                            action={() => handleDownload(artifact)}
                            disabled={downloadingId != null}
                          >
                            <Image systemName="square.and.arrow.down" font={16} />
                          </Button>
                        </HStack>
                      )
                    ) : (
                      <Text font={14} foregroundStyle={COLOR_RED}>已过期</Text>
                    )}
                  </HStack>
                  <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                    {formatBytes(artifact.sizeInBytes)}
                    {artifact.expired ? " · 已过期" : " · 有效"}
                    · 创建于 {relativeTime(artifact.createdAt)}
                  </Text>
                  {/* 下载进度条 */}
                  {downloadingId === artifact.id && !artifact.expired ? (
                    <ProgressView value={downloadProgress} />
                  ) : null}
                </VStack>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </List>
  )
}

export default ActionRunDetailPage
