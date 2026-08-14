import {
  Button,
  HStack,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import type {
  GitHubIssueFilter,
  GitHubIssueItem,
} from "../types/github"
import { createIssue, listIssuesOrPulls } from "../api/githubApi"
import { CreateIssueSheet } from "../components/CreateIssueSheet"
import { AvatarView } from "../components/AvatarView"
import { GitHubItemDetailPage } from "./GitHubItemDetailPage"
import { relativeTime } from "../utils/format"
import {
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_PURPLE,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

type ItemKind = 0 | 1 | 2

type FilterTab = 0 | 1 | 2
const FILTER_VALUES: Record<FilterTab, GitHubIssueFilter> = {
  0: "open",
  1: "closed",
  2: "all",
}
const PAGE_SIZE = 30

function GitHubItemRow({
  item,
  onSelect,
}: {
  item: GitHubIssueItem
  onSelect: () => void
}) {
  const statusColor = item.merged
    ? COLOR_PURPLE
    : item.state === "open"
      ? COLOR_GREEN
      : COLOR_SECONDARY_LABEL
  const statusIcon = item.merged
    ? "arrow.triangle.merge"
    : item.state === "open"
      ? "circle.circle"
      : "checkmark.circle.fill"

  return (
    <Button
      action={onSelect}
      buttonStyle="plain"
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <HStack alignment="center" spacing={10} frame={{ maxWidth: "infinity" }}>
        <Image systemName={statusIcon} font={16} foregroundStyle={statusColor} />
        <VStack
          alignment="leading"
          spacing={3}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <Text font={15} foregroundStyle={COLOR_LABEL} lineLimit={2}>{item.title}</Text>
          <HStack alignment="center" spacing={6}>
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              #{item.number} ·
            </Text>
            <AvatarView url={item.author.avatarUrl} size={16} />
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              {item.author.login} · {relativeTime(item.updatedAt)}
            </Text>
            {item.comments > 0 ? (
              <HStack spacing={2}>
                <Image systemName="bubble.left" font={11} foregroundStyle={COLOR_SECONDARY_LABEL} />
                <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>{item.comments}</Text>
              </HStack>
            ) : null}
          </HStack>
          {item.labels.length > 0 ? (
            <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
              {item.labels.map((label) => label.name).join(" · ")}
            </Text>
          ) : null}
        </VStack>
        <Image systemName="chevron.right" font={12} foregroundStyle={COLOR_SECONDARY_LABEL} />
      </HStack>
    </Button>
  )
}

export function GitHubWorkPage({
  fullName,
  initialKind = 0,
}: {
  fullName: string
  initialKind?: number
}) {
  const [kind, setKind] = useState<ItemKind>(initialKind as ItemKind)
  const [filter, setFilter] = useState<FilterTab>(0)
  const [items, setItems] = useState<GitHubIssueItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  // 新建 Issue 后 GitHub Search 索引有延迟，先乐观保留，避免回列表看不到
  const pendingCreatedRef = useRef<GitHubIssueItem[]>([])

  // 将本地乐观新建的 Issue 合入列表（仅开放/全部的 Issue 视图）
  function mergePending(list: GitHubIssueItem[], targetKind: ItemKind, targetFilter: FilterTab): GitHubIssueItem[] {
    // 乐观项均为新建 Issue，仅在 Issue 视图且非「已关闭」时处理
    if (pendingCreatedRef.current.length === 0 || targetKind !== 0 || targetFilter === 1) {
      return list
    }
    // 已进入真实列表的乐观项从缓存移除，避免无限增长
    pendingCreatedRef.current = pendingCreatedRef.current.filter(
      (p) => !list.some((it) => it.number === p.number)
    )
    const extras = pendingCreatedRef.current
    return extras.length > 0 ? [...extras, ...list] : list
  }

  async function load(
    reset = true,
    targetFilter: FilterTab = filter,
    targetKind: ItemKind = kind
  ) {
    const request = ++requestRef.current
    const nextPage = reset ? 1 : page + 1
    reset ? setLoading(true) : setLoadingMore(true)
    setError(null)
    try {
      const result = await listIssuesOrPulls(
        fullName,
        targetKind === 1 ? "pr" : "issue",
        FILTER_VALUES[targetFilter],
        nextPage,
        PAGE_SIZE
      )
      if (request !== requestRef.current) return
      setItems((current) =>
        reset
          ? mergePending(result.items, targetKind, targetFilter)
          : [...current, ...result.items]
      )
      setPage(nextPage)
      setHasMore(result.hasMore)
    } catch (e: any) {
      if (request === requestRef.current) setError(String(e?.message || e))
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    setItems([])
    load(true)
  }, [fullName, filter, kind])

  async function handleCreate(title: string, body: string) {
    if (creating) return
    setCreating(true)
    try {
      const created = await createIssue(fullName, { title, body })
      pendingCreatedRef.current = [created, ...pendingCreatedRef.current]
      setShowCreate(false)
      setFilter(0)
      await load(true, 0, 0)
      setSelectedNumber(created.number)
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setCreating(false)
    }
  }

  const visibleItems = items
  const sectionTitle = kind === 1 ? "Pull Requests" : "Issues"

  return (
    <List
      navigationTitle={fullName}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toolbar={{
        topBarTrailing: kind === 0 ? (
          <Button
            title="新建 Issue"
            systemImage="plus"
            action={() => setShowCreate(true)}
            disabled={creating}
          />
        ) : undefined,
      }}
      navigationDestination={{
        isPresented: selectedNumber != null,
        onChanged: (presented: boolean) => {
          if (!presented) setSelectedNumber(null)
        },
        content: selectedNumber != null ? (
          <GitHubItemDetailPage
            key={`${fullName}-${selectedNumber}`}
            fullName={fullName}
            number={selectedNumber}
          />
        ) : <Text>加载中…</Text>,
      }}
      sheet={{
        isPresented: showCreate,
        onChanged: (presented: boolean) => setShowCreate(presented),
        content: (
          <CreateIssueSheet
            busy={creating}
            onCancel={() => setShowCreate(false)}
            onConfirm={handleCreate}
          />
        ),
      }}
      alert={{
        title: "GitHub 请求失败",
        message: <Text>{error || ""}</Text>,
        isPresented: error != null,
        onChanged: (presented: boolean) => {
          if (!presented) setError(null)
        },
        actions: <Button title="好" role="cancel" action={() => setError(null)} />,
      }}
    >
      <Section>
        <Picker
          title="状态"
          value={filter}
          onChanged={(value: number) => setFilter(value as FilterTab)}
        >
          <Text tag={0}>开放</Text>
          <Text tag={1}>已关闭</Text>
          <Text tag={2}>全部</Text>
        </Picker>
      </Section>

      <Section
        header={<Text>{sectionTitle}（{visibleItems.length}）</Text>}
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
        ) : visibleItems.length === 0 ? (
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
            当前筛选下没有 {sectionTitle}
          </Text>
        ) : visibleItems.map((item) => (
          <GitHubItemRow
            key={item.number}
            item={item}
            onSelect={() => setSelectedNumber(item.number)}
          />
        ))}
      </Section>
    </List>
  )
}

export default GitHubWorkPage
