import {
  List,
  Section,
  Text,
  HStack,
  VStack,
  NavigationLink,
  Image,
  useEffect,
  useState,
} from "scripting"
import type { CommitEntry, RefCompareResult } from "../types/git"
import {
  compareWithUpstream,
  RemoteCancelToken,
  isRemoteOperationCancelled,
} from "../services/gitService"
import type { RemoteProgressInfo } from "../utils/remoteProgress"
import { CommitDetailPage } from "./CommitDetailPage"
import { BusyOverlay } from "../components/BusyOverlay"
import {
  shortOid,
  relativeTime,
  commitTitle,
  commitBody,
} from "../utils/format"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_ACCENT,
  COLOR_GREEN,
  COLOR_ORANGE,
} from "../constants/colors"

function CompareCommitRow({
  entry,
  bookmarkName,
}: {
  entry: CommitEntry
  bookmarkName: string
}) {
  const body = commitBody(entry.message)

  return (
    <NavigationLink
      destination={
        <CommitDetailPage bookmarkName={bookmarkName} oid={entry.oid} />
      }
    >
      <VStack alignment="leading" spacing={2}>
        <Text foregroundStyle={COLOR_LABEL} lineLimit={2}>
          {commitTitle(entry.message) || "(无提交信息)"}
        </Text>
        {body ? (
          <Text
            font="caption"
            foregroundStyle={COLOR_SECONDARY_LABEL}
            lineLimit={2}
          >
            {body}
          </Text>
        ) : null}
        <Text font="caption2" foregroundStyle={COLOR_SECONDARY_LABEL}>
          {entry.author.name || "unknown"} · {relativeTime(entry.date)} ·{" "}
          {shortOid(entry.oid)}
        </Text>
      </VStack>
    </NavigationLink>
  )
}

function CommitListSection({
  title,
  total,
  entries,
  bookmarkName,
  hint,
}: {
  title: string
  total: number
  entries: CommitEntry[]
  bookmarkName: string
  hint: string
}) {
  const truncated = total > entries.length
  return (
    <Section
      header={<Text>{`${title}（${total}）`}</Text>}
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          {hint}
          {truncated ? `\n仅显示最近 ${entries.length} 条` : ""}
        </Text>
      }
    >
      {entries.map((entry) => (
        <CompareCommitRow
          key={entry.oid}
          entry={entry}
          bookmarkName={bookmarkName}
        />
      ))}
    </Section>
  )
}

export function ComparePage({ bookmarkName }: { bookmarkName: string }) {
  const [result, setResult] = useState<RefCompareResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noTrack, setNoTrack] = useState(false)
  const [progress, setProgress] = useState<RemoteProgressInfo | null>(null)
  const [cancelToken, setCancelToken] = useState<RemoteCancelToken | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    setError(null)
    setNoTrack(false)
    setProgress(null)
    setCancelling(false)
    const token = new RemoteCancelToken()
    setCancelToken(token)
    compareWithUpstream(bookmarkName, undefined, {
      cancelToken: token,
      onProgress: async (next) => {
        if (!cancelled) setProgress(next)
      },
    })
      .then((next) => {
        if (cancelled) return
        setResult(next)
        setNoTrack(next == null)
      })
      .catch((e: any) => {
        if (cancelled) return
        if (isRemoteOperationCancelled(e)) {
          setError("对比已取消")
        } else {
          setError(String(e?.message || e))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setCancelToken(null)
        }
      })
    return () => {
      cancelled = true
      token.cancel()
    }
  }, [bookmarkName])

  const stateView = (() => {
    if (!result) return null
    switch (result.syncState) {
      case "upToDate":
        return {
          icon: "checkmark.circle.fill",
          color: COLOR_GREEN,
          text: "两个远端分支无提交差异",
        }
      case "ahead":
        return {
          icon: "arrow.up.circle.fill",
          color: COLOR_ORANGE,
          text: `${result.baseTrack} 领先 ${result.ahead} 条提交`,
        }
      case "behind":
        return {
          icon: "arrow.down.circle.fill",
          color: COLOR_ACCENT,
          text: `${result.baseTrack} 落后 ${result.behind} 条提交`,
        }
      default:
        return {
          icon: "arrow.up.arrow.down",
          color: COLOR_ORANGE,
          text: `已分叉：领先 ${result.ahead} 条 · 落后 ${result.behind} 条`,
        }
    }
  })()

  // 对比进行中用全屏忙态浮层，取消由浮层内按钮触发
  function handleCancelCompare() {
    if (!cancelToken || cancelling) return
    setCancelling(true)
    cancelToken.cancel()
  }

  return (
    <List
      navigationTitle="与远端差异"
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      overlay={
        loading
          ? {
              alignment: "center",
              content: (
                <BusyOverlay
                  title="正在对比"
                  message={
                    cancelling
                      ? "取消中…"
                      : progress?.phase || "准备对比…"
                  }
                  onCancel={cancelToken ? handleCancelCompare : undefined}
                  cancelling={cancelling}
                />
              ),
            }
          : undefined
      }
    >
      {loading ? null : error ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载失败：{error}</Text>
        </Section>
      ) : noTrack || !result ? (
        <Section
          footer={
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              origin 当前分支或设置的目标远端分支尚无本地跟踪记录。
            </Text>
          }
        >
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            缺少对比所需的远端分支快照
          </Text>
        </Section>
      ) : (
        <>
          <Section
            header={<Text>概览</Text>}
            footer={
              <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
                显示两侧独有的领先、落后提交，不计算文件改动历史。
              </Text>
            }
          >
            <HStack alignment="center" spacing={8}>
              <Image
                systemName="arrow.left.arrow.right"
                foregroundStyle={COLOR_ACCENT}
              />
              <Text foregroundStyle={COLOR_LABEL}>
                {result.baseTrack} ↔ {result.targetTrack}
              </Text>
            </HStack>
            {stateView ? (
              <HStack alignment="center" spacing={8}>
                <Image
                  systemName={stateView.icon}
                  foregroundStyle={stateView.color as any}
                />
                <Text foregroundStyle={COLOR_LABEL}>{stateView.text}</Text>
              </HStack>
            ) : null}
            <Text font="caption2" foregroundStyle={COLOR_SECONDARY_LABEL}>
              {shortOid(result.baseOid)} ↔ {shortOid(result.targetOid)}
            </Text>
          </Section>
          {result.ahead > 0 ? (
            <CommitListSection
              title={`${result.baseTrack} 领先的提交`}
              total={result.ahead}
              entries={result.aheadCommits}
              bookmarkName={bookmarkName}
              hint={`${result.baseTrack} 独有、${result.targetTrack} 尚未包含的提交`}
            />
          ) : null}
          {result.behind > 0 ? (
            <CommitListSection
              title={`${result.baseTrack} 落后的提交`}
              total={result.behind}
              entries={result.behindCommits}
              bookmarkName={bookmarkName}
              hint={`${result.targetTrack} 独有、${result.baseTrack} 尚未包含的提交`}
            />
          ) : null}
        </>
      )}
    </List>
  )
}
