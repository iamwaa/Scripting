/**
 * pages/RollbackPage.tsx - 回滚目标提交选择页
 *
 * 只负责展示当前分支历史并回传选中的提交与目标分支；确认与实际回滚由详情页统一处理。
 * 支持按提交信息/作者/OID 搜索目标提交（复用 getLogPage 查询参数与 HistorySearchBar）。
 * 当前分支以服务层读取为准（详情页传入的属性可能在页面打开时尚未就绪），
 * 无法确定命名分支时就地提示，不离开本页也不触发确认弹窗。
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
  useRef,
  useState,
} from "scripting"
import type { CommitEntry } from "../types/git"
import { getCurrentBranchName, getLogPage } from "../services/gitService"
import { HistorySearchBar } from "../components/HistorySearchBar"
import { toastContent } from "../components/Toast"
import { useToast } from "../hooks/useToast"
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
  onSelect: (entry: CommitEntry, branch: string) => void
}) {
  const [entries, setEntries] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 当前生效的搜索词；空串表示未筛选
  const [query, setQuery] = useState("")
  // 首屏/搜索/刷新进行中：禁用搜索栏清空与「加载更多」，避免中途被重置
  const [searching, setSearching] = useState(false)
  const [totalMatches, setTotalMatches] = useState<number | null>(null)
  const [limited, setLimited] = useState(false)
  // 当前分支：以服务层读取为准，详情页传入的属性仅作初值
  const [branch, setBranch] = useState<string | null>(currentBranch)
  const [selecting, setSelecting] = useState(false)
  const { toastState, showToast, handleToastChanged, toastPresented } = useToast()
  const requestRef = useRef(0)

  // 独立读取当前分支；失败时保留已有值，点击时还有一次实时读取兜底
  async function loadBranch() {
    try {
      setBranch(await getCurrentBranchName(bookmarkName))
    } catch (_e) {
      /* 保留详情页传入或上次解析到的分支名 */
    }
  }

  // 从第 0 条按指定搜索词加载；首屏、搜索、下拉刷新共用
  async function loadInitial(nextQuery: string) {
    const request = ++requestRef.current
    setLoading(true)
    setError(null)
    setSearching(true)
    try {
      const page = await getLogPage(
        bookmarkName,
        0,
        ROLLBACK_PAGE_SIZE,
        nextQuery
      )
      if (request !== requestRef.current) return
      setEntries(page.entries)
      setHasMore(page.hasMore)
      setTotalMatches(page.totalMatches)
      setLimited(!!page.limited)
      setQuery(nextQuery)
    } catch (e: any) {
      if (request === requestRef.current) setError(String(e?.message || e))
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setSearching(false)
      }
    }
  }

  useEffect(() => {
    loadInitial("")
    loadBranch()
    return () => {
      requestRef.current++
    }
  }, [bookmarkName])

  async function loadMore() {
    if (loadingMore || searching || !hasMore) return
    // 快照请求序号：搜索或刷新接管列表后丢弃过期结果，避免覆盖新数据
    const request = requestRef.current
    setLoadingMore(true)
    try {
      const page = await getLogPage(
        bookmarkName,
        entries.length,
        ROLLBACK_PAGE_SIZE,
        query
      )
      if (request !== requestRef.current) return
      const seen = new Set(entries.map((item) => item.oid))
      setEntries(
        entries.concat(page.entries.filter((item) => !seen.has(item.oid)))
      )
      setHasMore(page.hasMore)
      setTotalMatches(page.totalMatches)
      setLimited(!!page.limited)
    } catch (e: any) {
      if (request === requestRef.current) setError(String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  // 点击行：以服务层为准重新解析当前分支，避免详情页传入的属性可能过期
  async function handleSelect(entry: CommitEntry) {
    if (selecting) return
    setSelecting(true)
    let target = branch
    let readError: string | null = null
    try {
      target = await getCurrentBranchName(bookmarkName)
      setBranch(target)
    } catch (e: any) {
      readError = String(e?.message || e)
    }
    setSelecting(false)
    if (!target) {
      // 提示留在本页：详情页的 toast 会被本页遮住，只能回退后才看得到
      showToast(
        readError ? "无法读取当前分支：" + readError : "当前不在命名分支上，无法回滚",
        "error",
        readError ? 4 : 3
      )
      return
    }
    onSelect(entry, target)
  }

  const headOid = entries.find((entry) => entry.isHead)?.oid ?? null

  return (
    <List
      navigationTitle="回滚并强推"
      navigationBarTitleDisplayMode="inline"
      refreshable={() => {
        // 下拉同时刷新当前分支，避免上页传入或上次解析的值长期停留
        loadBranch()
        return loadInitial(query)
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
      <Section
        footer={
          <Text font="footnote" foregroundStyle={COLOR_RED}>
            选择目标提交后，{branch || currentBranch || "当前分支"} 会被重置到该提交，并强制覆盖
            origin 上的同名分支。该提交之后的提交将从远端历史中移除，操作不可撤销。
          </Text>
        }
      >
        <Text font={14} foregroundStyle={COLOR_SECONDARY_LABEL}>
          回滚前请确认工作区没有未提交改动。
        </Text>
      </Section>

      <Section
        header={
          <HistorySearchBar
            title="选择目标提交"
            searching={searching}
            onSearch={loadInitial}
          />
        }
        footer={
          <VStack alignment="leading" spacing={8}>
            {totalMatches != null ? (
              <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
                找到 {totalMatches} 条匹配记录
              </Text>
            ) : null}
            {limited ? (
              <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
                仅扫描最近 5,000 条提交
              </Text>
            ) : null}
            {hasMore ? (
              <HStack frame={{ maxWidth: "infinity" }}>
                <Spacer />
                <Button action={loadMore} disabled={loadingMore || searching}>
                  <HStack spacing={4}>
                    <Image
                      systemName={loadingMore ? "hourglass" : "chevron.down"}
                      font={14}
                    />
                    <Text font={14}>
                      {loadingMore ? "加载中…" : "加载更多"}
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
          <HStack alignment="center" spacing={8}>
            <ProgressView />
            <Text foregroundStyle={COLOR_SECONDARY_LABEL}>正在加载历史…</Text>
          </HStack>
        ) : error ? (
          <Text foregroundStyle={COLOR_RED}>{error}</Text>
        ) : entries.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            {query.trim().length > 0
              ? limited && totalMatches == null
                ? "最近 5,000 条中没有匹配记录"
                : hasMore && totalMatches == null
                  ? "当前批次没有匹配记录，可继续加载"
                  : "没有匹配的提交"
              : "没有可回滚的提交"}
          </Text>
        ) : (
          entries.map((entry) => (
            <RollbackCommitRow
              key={entry.oid}
              entry={entry}
              isHead={headOid != null && entry.oid === headOid}
              onSelect={handleSelect}
            />
          ))
        )}
      </Section>
    </List>
  )
}
