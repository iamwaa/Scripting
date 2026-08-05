/**
 * pages/HistoryTab.tsx - 历史 Tab
 *
 * - 详情由父页受控导航，避免 NavigationLink 标签复用导致空白行
 * - 左滑仅 HEAD：重编 / 回退 / 撤销
 */

import {
  Section,
  Text,
  HStack,
  Button,
  Image,
  VStack,
  Spacer,
} from "scripting"
import type { CommitEntry } from "../types/git"
import { HistorySearchBar } from "../components/HistorySearchBar"
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
  COLOR_ORANGE,
  COLOR_GREEN,
} from "../constants/colors"

/** 单行独立组件：props 固定本行数据，降低 List 复用时闭包串行风险 */
function HistoryRow({
  entry,
  onCopy,
  onSelectOid,
  onRevert,
  onSoftReset,
  onAmend,
}: {
  entry: CommitEntry
  onCopy: (entry: CommitEntry) => void
  /** 只回传 oid，避免 action 闭包持有错误 entry 引用 */
  onSelectOid: (oid: string) => void
  onRevert: (entry: CommitEntry) => void
  onSoftReset: (entry: CommitEntry) => void
  onAmend: (entry: CommitEntry) => void
}) {
  const oid = entry.oid
  const body = commitBody(entry.message)
  const canRewrite =
    !!entry.isHead &&
    (entry.syncStatus === "unpushed" || entry.syncStatus === "local")
  const canRevert = !!entry.isHead

  const swipeActions: any[] = []
  if (canRewrite) {
    swipeActions.push(
      <Button
        title="重编"
        systemImage="pencil"
        action={() => onAmend(entry)}
      />,
      <Button
        title="回退"
        systemImage="arrow.uturn.backward"
        tint="systemRed"
        action={() => onSoftReset(entry)}
      />
    )
  }
  if (canRevert) {
    swipeActions.push(
      <Button
        title="撤销"
        systemImage="arrow.counterclockwise"
        tint="systemRed"
        action={() => onRevert(entry)}
      />
    )
  }

  let badge: { text: string; color: string } | null = null
  if (entry.syncStatus === "unpushed") {
    badge = { text: "待推送", color: COLOR_ORANGE }
  } else if (entry.syncStatus === "remote") {
    badge = { text: "远端", color: COLOR_GREEN }
  } else if (entry.syncStatus === "local") {
    badge = { text: "本地", color: COLOR_SECONDARY_LABEL }
  }

  return (
    <HStack
      alignment="center"
      trailingSwipeActions={
        swipeActions.length > 0
          ? {
            allowsFullSwipe: false,
            actions: swipeActions,
          }
          : undefined
      }
    >
      <VStack alignment="leading" spacing={2}>
        <HStack alignment="center" spacing={6}>
          <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {shortOid(oid)}
          </Text>
          <Button buttonStyle="plain" action={() => onCopy(entry)}>
            <Image
              systemName="doc.on.doc"
              font="caption2"
              foregroundStyle={COLOR_ACCENT}
            />
          </Button>
          {entry.isHead ? (
            <Text font="caption2" foregroundStyle={COLOR_ACCENT}>
              HEAD
            </Text>
          ) : null}
          <Spacer />
          {badge ? (
            <Text font="caption2" foregroundStyle={badge.color as any}>
              {badge.text}
            </Text>
          ) : null}
        </HStack>
        <Button buttonStyle="plain" action={() => onSelectOid(oid)}>
          <VStack alignment="leading" spacing={2}>
            <Text font="body" foregroundStyle={COLOR_LABEL} lineLimit={2}>
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
              {entry.author.name || "unknown"} · {relativeTime(entry.date)}
            </Text>
          </VStack>
        </Button>
      </VStack>
      <Image
        systemName="chevron.right"
        font="caption"
        foregroundStyle={COLOR_SECONDARY_LABEL}
      />
    </HStack>
  )
}

export function HistoryTab({
  log,
  loading,
  onCopy,
  onSelect,
  onRevert,
  onSoftReset,
  onAmend,
  onSearch,
  onLoadMore,
  hasMore,
  searchBusy,
  totalMatches,
}: {
  log: CommitEntry[]
  loading: boolean
  onCopy: (entry: CommitEntry) => void
  onSelect: (entry: CommitEntry) => void
  onRevert: (entry: CommitEntry) => void
  onSoftReset: (entry: CommitEntry) => void
  onAmend: (entry: CommitEntry) => void
  onSearch: (query: string) => void
  onLoadMore: () => void
  hasMore: boolean
  searchBusy: boolean
  totalMatches: number | null
}) {
  function handleSelectOid(oid: string) {
    const entry = log.find((item) => item.oid === oid)
    // 详情页只依赖 oid；找不到条目时仍用 oid 打开，避免点击无响应
    if (entry) {
      onSelect(entry)
      return
    }
    onSelect({
      oid,
      message: "",
      author: { name: "", email: "" },
      date: "",
    })
  }

  return (
    <Section
      header={
        <HistorySearchBar searching={searchBusy} onSearch={onSearch} />
      }
      footer={
        <VStack alignment="leading" spacing={8}>
          {totalMatches != null ? (
            <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
              找到 {totalMatches} 条匹配记录
            </Text>
          ) : null}
          {hasMore ? (
            <HStack frame={{ maxWidth: "infinity" }}>
              <Spacer />
              <Button action={onLoadMore} disabled={searchBusy}>
                <HStack spacing={4}>
                  <Image
                    systemName={searchBusy ? "hourglass" : "chevron.down"}
                    font={14}
                  />
                  <Text font={14}>
                    {searchBusy ? "加载中…" : "加载更多"}
                  </Text>
                </HStack>
              </Button>
              <Spacer />
            </HStack>
          ) : null}
        </VStack>
      }
    >
      {loading ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
      ) : log.length === 0 ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
          {totalMatches === 0 ? "没有匹配的提交" : "还没有提交记录"}
        </Text>
      ) : (
        log.map((entry) => (
          <HistoryRow
            key={entry.oid}
            entry={entry}
            onCopy={onCopy}
            onSelectOid={handleSelectOid}
            onRevert={onRevert}
            onSoftReset={onSoftReset}
            onAmend={onAmend}
          />
        ))
      )}
    </Section>
  )
}
