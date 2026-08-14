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
import type { ActionArtifact, ActionJob, ActionRun } from "../types/github"
import {
  getWorkflowRun,
  listWorkflowJobs,
  getJobLog,
  listArtifacts,
  getArtifactDownloadInfo,
} from "../api/githubApi"
import { AvatarView } from "../components/AvatarView"
import { ActionLogViewer } from "../components/ActionLogViewer"
import { relativeTime } from "../utils/format"
import {
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_SECONDARY_LABEL,
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

/** 快速统计日志中的错误与警告行数 */
function countLogLevels(text: string): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const line of text.split("\n")) {
    const lower = line.toLowerCase()
    if (
      /\berror\b/.test(lower) ||
      lower.includes("failed") ||
      lower.includes("exception") ||
      lower.includes("panic") ||
      lower.startsWith("error:") ||
      lower.includes("##[error]")
    ) {
      errors++
    } else if (
      lower.includes("warning:") ||
      lower.includes("##[warning]") ||
      lower.includes("warn:")
    ) {
      warnings++
    }
  }
  return { errors, warnings }
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
  // 当前展开查看日志的 Job ID
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logCounts, setLogCounts] = useState<{ errors: number; warnings: number } | null>(null)
  // 进入富文本日志查看器的 Job（名称用于标题）
  const [viewerJob, setViewerJob] = useState<{ name: string; log: string } | null>(null)
  // 工件列表
  const [artifacts, setArtifacts] = useState<ActionArtifact[]>([])
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
    } catch (e: any) {
      setError(String(e?.message || e))
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
      setLogCounts(null)
      return
    }
    setExpandedJobId(job.id)
    setLogText(null)
    setLogError(null)
    setLogCounts(null)
    setLogLoading(true)
    try {
      const text = await getJobLog(fullName, job.id)
      setLogText(text)
      setLogCounts(countLogLevels(text))
    } catch (e: any) {
      setLogError(String(e?.message || e))
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
    } catch (e: any) {
      setError(String(e?.message || e))
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
      alert={{
        title: "提示",
        message: <Text>{error || ""}</Text>,
        isPresented: error != null,
        onChanged: (presented: boolean) => {
          if (!presented) setError(null)
        },
        actions: <Button title="好" role="cancel" action={() => setError(null)} />,
      }}
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

                    {/* 步骤列表 */}
                    {isExpanded && job.steps.length > 0 ? (
                      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
                        {job.steps.map((step) => {
                          const si = stepIcon(step.status, step.conclusion)
                          return (
                            <HStack key={step.number} alignment="center" spacing={6}>
                              <Image systemName={si.icon} font={11} foregroundStyle={si.color} />
                              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
                                {step.name}
                              </Text>
                            </HStack>
                          )
                        })}
                      </VStack>
                    ) : null}

                    {/* 展开时显示日志摘要与查看入口 */}
                    {isExpanded ? (
                      <VStack alignment="leading" spacing={6}>
                        {logLoading ? (
                          <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>加载日志中…</Text>
                        ) : logError ? (
                          <Text font={12} foregroundStyle={COLOR_RED}>日志加载失败：{logError}</Text>
                        ) : logText ? (
                          <>
                            {/* 日志摘要：错误/警告行数 */}
                            {logCounts && logCounts.errors > 0 ? (
                              <HStack alignment="center" spacing={4}>
                                <Image systemName="xmark.octagon.fill" font={11} foregroundStyle={COLOR_RED} />
                                <Text font={12} foregroundStyle={COLOR_RED}>
                                  {logCounts.errors} 行错误
                                </Text>
                                {logCounts.warnings > 0 ? (
                                  <>
                                    <Image systemName="exclamationmark.triangle.fill" font={11} foregroundStyle={COLOR_ORANGE} />
                                    <Text font={12} foregroundStyle={COLOR_ORANGE}>
                                      {logCounts.warnings} 行警告
                                    </Text>
                                  </>
                                ) : null}
                              </HStack>
                            ) : logCounts && logCounts.warnings > 0 ? (
                              <HStack alignment="center" spacing={4}>
                                <Image systemName="exclamationmark.triangle.fill" font={11} foregroundStyle={COLOR_ORANGE} />
                                <Text font={12} foregroundStyle={COLOR_ORANGE}>
                                  {logCounts.warnings} 行警告
                                </Text>
                              </HStack>
                            ) : (
                              <HStack alignment="center" spacing={4}>
                                <Image systemName="checkmark.circle.fill" font={11} foregroundStyle={COLOR_GREEN} />
                                <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                                  无错误或警告
                                </Text>
                              </HStack>
                            )}

                            {/* 日志预览：前几行 */}
                            <Text
                              font={11}
                              foregroundStyle={COLOR_SECONDARY_LABEL}
                              lineLimit={5}
                              frame={{ maxWidth: "infinity", alignment: "leading" }}
                            >
                              {logText.slice(0, 500)}
                            </Text>

                            {/* 查看完整日志按钮 */}
                            <Button
                              action={() => setViewerJob({ name: job.name, log: logText })}
                              buttonStyle="plain"
                              frame={{ maxWidth: "infinity", alignment: "leading" }}
                            >
                              <HStack alignment="center" spacing={4}>
                                <Image systemName="doc.text.magnifyingglass" font={13} foregroundStyle="systemBlue" />
                                <Text font={13} foregroundStyle="systemBlue">查看完整日志</Text>
                              </HStack>
                            </Button>
                          </>
                        ) : (
                          <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>无日志</Text>
                        )}
                      </VStack>
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
