import { NavigationStack, List, Section, Button, Text, Toolbar, ToolbarItem, Image, VStack, ProgressView } from "scripting"
import type { VirtualNode } from "scripting"
import { MatchRow } from "../components/MatchRow"
import { FilterSection } from "../components/FilterSection"
import { filterMatches, normalizeFilters } from "../utils/filter"
import type { Match, Subscription, MatchFilters } from "../types"
import { isSubscribed } from "../storage"
import { groupByDate } from "../utils/format"

interface ScheduleTabProps {
  tabItem: VirtualNode
  tag: number
  matches: Match[]
  optionMatches: Match[]
  subscriptions: Subscription[]
  loading: boolean
  error: string | null
  hasToken: boolean
  filters: MatchFilters
  onFiltersChange: (filters: MatchFilters) => void
  onToggleSub: (match: Match) => void
  onRefresh: () => void
  onOpenSettings: () => void
  onClose: () => void
}

export function ScheduleTab(props: ScheduleTabProps) {
  const {
    matches,
    optionMatches,
    subscriptions,
    loading,
    error,
    hasToken,
    filters,
    onFiltersChange,
    onRefresh,
    onClose,
  } = props

  const optionSource = optionMatches.length > 0 ? optionMatches : matches
  const normalizedFilters = normalizeFilters(optionSource, filters)
  const filtered = filterMatches(matches, normalizedFilters)
  const runningMatches = filtered.filter((m) => m.status === "running")
  const upcomingMatches = filtered.filter((m) => m.status !== "running")
  const dateGroups = groupByDate(upcomingMatches)

  return (
    <NavigationStack>
      <List
        navigationTitle="赛程"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button action={onClose}>
                <Image
                  systemName="xmark"
                  fontWeight="semibold"
                  foregroundStyle="red"
                />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              {loading ? (
                <ProgressView />
              ) : (
                <Button action={onRefresh}>
                  <Image
                    systemName="arrow.clockwise"
                    fontWeight="semibold"
                  />
                </Button>
              )}
            </ToolbarItem>
          </Toolbar>
        }
      >
        {!hasToken && (
          <Section 
            header={<Text>未配置 API Token</Text>}
            footer={<Text>需要 PandaScore API Token 才能获取赛程。点击「设置」填写</Text>}>
            <Button title="设置" action={props.onOpenSettings} />
          </Section>
        )}

        {error ? (
          <Section title="错误">
            <Text foregroundStyle="red">{error}</Text>
          </Section>
        ) : null}

        <FilterSection
          optionSource={optionSource}
          filters={normalizedFilters}
          onFiltersChange={onFiltersChange}
        />

        {runningMatches.length > 0 && (
          <Section title={`进行中 (${runningMatches.length})`}>
            {runningMatches.map((match) => (
              <MatchRow
                key={String(match.id)}
                match={match}
                subscribed={isSubscribed(subscriptions, match.id)}
                onToggle={props.onToggleSub}
              />
            ))}
          </Section>
        )}

        {dateGroups.map((group) => (
          <Section key={group.key} title={`${group.label} (${group.items.length})`}>
            {group.items.map((match) => (
              <MatchRow
                key={String(match.id)}
                match={match}
                subscribed={isSubscribed(subscriptions, match.id)}
                onToggle={props.onToggleSub}
              />
            ))}
          </Section>
        ))}
        {filtered.length === 0 && !loading && (
          <VStack
            alignment="center"
            spacing={10}
            frame={{ minHeight: 140, maxWidth: "infinity", alignment: "center" }}
          >
            <Image
              systemName={hasToken ? "calendar.badge.exclamationmark" : "key.fill"}
              resizable
              scaleToFit
              frame={{ width: 40, height: 40 }}
              foregroundStyle="secondaryLabel"
            />
            <Text foregroundStyle="secondaryLabel" font="callout" multilineTextAlignment="center">
              {hasToken ? "暂无符合条件的比赛数据" : "请先配置 API Token"}
            </Text>
          </VStack>
        )}
      </List>
    </NavigationStack>
  )
}
