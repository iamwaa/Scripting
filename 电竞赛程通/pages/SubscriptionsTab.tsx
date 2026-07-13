import { NavigationStack, List, Section, Text, Button, Toolbar, ToolbarItem, Image, VStack } from "scripting"
import type { VirtualNode } from "scripting"
import { MatchRow } from "../components/MatchRow"
import { groupByDate } from "../utils/format"
import type { Match, Subscription } from "../types"

interface SubscriptionsTabProps {
  tabItem: VirtualNode
  tag: number
  matches: Match[]
  subscriptions: Subscription[]
  onToggleSub: (match: Match) => void
  onRefresh: () => void
  onClose: () => void
}

export function SubscriptionsTab(props: SubscriptionsTabProps) {
  const { matches, subscriptions, onToggleSub, onRefresh, onClose } = props

  const subscribedMatches = subscriptions
    .map((sub) => {
      const match = sub.match ?? matches.find((m) => m.id === sub.matchId)
      return match ? { match, sub } : null
    })
    .filter((item): item is { match: Match; sub: Subscription } => item !== null)
    .sort((a, b) => new Date(a.match.scheduled_at).getTime() - new Date(b.match.scheduled_at).getTime())

  // 复用赛程页的分组:进行中优先展示比分,未开始按日期分组
  const runningMatches = subscribedMatches.filter(({ match }) => match.status === "running")
  const upcomingMatches = subscribedMatches.filter(({ match }) => match.status !== "running")
  const dateGroups = groupByDate(upcomingMatches.map(({ match }) => match))

  return (
    <NavigationStack>
      <List
        navigationTitle="订阅"
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
              <Button action={onRefresh}>
                <Image
                  systemName="arrow.clockwise"
                  fontWeight="semibold"
                />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
      >
        {runningMatches.length > 0 && (
          <Section header={<Text>进行中 ({runningMatches.length})</Text>}>
            {runningMatches.map(({ match }) => (
              <MatchRow
                key={String(match.id)}
                match={match}
                subscribed={true}
                onToggle={onToggleSub}
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
                subscribed={true}
                onToggle={onToggleSub}
              />
            ))}
          </Section>
        ))}

        {subscribedMatches.length === 0 && (
          <Section>
            <VStack
              alignment="center"
              spacing={10}
              frame={{ minHeight: 140, maxWidth: "infinity", alignment: "center" }}
            >
              <Image
                systemName="bell.slash.fill"
                resizable
                scaleToFit
                frame={{ width: 40, height: 40 }}
                foregroundStyle="secondaryLabel"
              />
              <Text foregroundStyle="secondaryLabel" font="callout" multilineTextAlignment="center">
                还没有订阅任何比赛，去赛程页开启提醒吧
              </Text>
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
