/**
 * pages/RollbackPage.tsx - 回滚目标提交选择页
 *
 * 只负责展示当前分支历史并回传选中的提交；确认与实际回滚由详情页统一处理。
 */

import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import type { CommitEntry } from "../types/git"
import { getLogPage } from "../services/gitService"
import {
  commitBody,
  commitTitle,
  relativeTime,
  shortOid,
} from "../utils/format"
import {
  COLOR_LABEL,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

const ROLLBACK_PAGE_SIZE = 50

function RollbackCommitRow({
  entry,
  isHead,
  onSelect,
}: {
  entry: CommitEntry
  isHead: boolean
  onSelect: (entry: CommitEntry) => void
}) {
  const body = commitBody(entry.message)
  return (
    <Button action={() => onSelect(entry)} buttonStyle="plain">
      <HStack alignment="center" spacing={10}>
        <VStack alignment="leading" spacing={2}>
          <Text foregroundStyle={COLOR_LABEL} lineLimit={2}>
            {commitTitle(entry.message) || "(无提交信息)"}
          </Text>
          {body ? (
            <Text
              font={12}
              foregroundStyle={COLOR_SECONDARY_LABEL}
              lineLimit={2}
            >
              {body}
            </Text>
          ) : null}
          <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
            {entry.author.name || "unknown"} · {relativeTime(entry.date)} ·{" "}
            {shortOid(entry.oid)}
            {isHead ? " · 当前 HEAD" : ""}
          </Text>
        </VStack>
        <Spacer />
        <Image
          systemName="arrow.uturn.backward.circle"
          font={16}
          foregroundStyle={isHead ? COLOR_SECONDARY_LABEL : COLOR_ORANGE}
        />
      </HStack>
    </Button>
  )
}

export function RollbackPage({
  bookmarkName,
  currentBranch,
  onSelect,
}: {
  bookmarkName: string
  currentBranch: string | null
  onSelect: (entry: CommitEntry) => void
}) {
  const [entries, setEntries] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getLogPage(bookmarkName, 0, ROLLBACK_PAGE_SIZE)
      .then((page) => {
        if (cancelled) return
        setEntries(page.entries)
        setHasMore(page.hasMore)
      })
      .catch((e: any) => {
        if (!cancelled) setError(String(e?.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookmarkName])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await getLogPage(
        bookmarkName,
        entries.length,
        ROLLBACK_PAGE_SIZE
      )
      const seen = new Set(entries.map((item) => item.oid))
      setEntries(
        entries.concat(page.entries.filter((item) => !seen.has(item.oid)))
      )
      setHasMore(page.hasMore)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  const headOid = entries.find((entry) => entry.isHead)?.oid ?? null

  return (
    <List
      navigationTitle="回滚并强推"
      navigationBarTitleDisplayMode="inline"
    >
      <Section
        footer={
          <Text font="footnote" foregroundStyle={COLOR_RED}>
            选择目标提交后，{currentBranch || "当前分支"} 会被重置到该提交，并强制覆盖
            origin 上的同名分支。该提交之后的提交将从远端历史中移除，操作不可撤销。
          </Text>
        }
      >
        <Text font={14} foregroundStyle={COLOR_SECONDARY_LABEL}>
          回滚前请确认工作区没有未提交改动。
        </Text>
      </Section>

      {loading ? (
        <Section>
          <HStack alignment="center" spacing={8}>
            <ProgressView />
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>正在加载历史…</Text>
          </HStack>
        </Section>
      ) : error ? (
        <Section>
          <Text foregroundStyle={COLOR_RED}>{error}</Text>
        </Section>
      ) : entries.length === 0 ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有可回滚的提交</Text>
        </Section>
      ) : (
        <Section header={<Text>选择目标提交</Text>}>
          {entries.map((entry) => (
            <RollbackCommitRow
              key={entry.oid}
              entry={entry}
              isHead={headOid != null && entry.oid === headOid}
              onSelect={onSelect}
            />
          ))}
          {hasMore ? (
            <Button action={loadMore} disabled={loadingMore}>
              <Text>{loadingMore ? "加载中…" : "加载更多"}</Text>
            </Button>
          ) : null}
        </Section>
      )}
    </List>
  )
}
