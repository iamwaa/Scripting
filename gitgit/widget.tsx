import {
  AccessoryWidgetBackground,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
} from "scripting"
import {
  COLOR_ACCENT,
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_ORANGE,
  COLOR_RED,
  COLOR_SECONDARY_BG,
  COLOR_SECONDARY_LABEL,
} from "./constants/colors"
import { readSnapshots } from "./services/repoStore"
import type { RepoSnapshot } from "./types/git"
import {
  buildWidgetSummary,
  formatWidgetUpdatedAt,
  type WidgetSummary,
} from "./utils/widget"

function Header({
  summary,
  showsUpdatedAt = false,
}: {
  summary: WidgetSummary
  showsUpdatedAt?: boolean
}) {
  return (
    <HStack alignment="center" spacing={6}>
      <Image
        systemName="point.topleft.down.to.point.bottomright.curvepath"
        foregroundStyle={COLOR_ACCENT}
        widgetAccentable
      />
      <Text font={15} fontWeight="semibold" foregroundStyle={COLOR_LABEL}>
        {summary.parameter || "gitgit"}
      </Text>
      <Spacer />
      {showsUpdatedAt ? (
        <Text
          font={10}
          foregroundStyle={summary.isStale ? COLOR_ORANGE : COLOR_SECONDARY_LABEL}
          lineLimit={1}
        >
          {formatWidgetUpdatedAt(summary.latestUpdatedAt)}
        </Text>
      ) : summary.isStale ? (
        <Image
          systemName="clock.badge.exclamationmark"
          font={12}
          foregroundStyle={COLOR_ORANGE}
        />
      ) : null}
    </HStack>
  )
}

function Metric({
  icon,
  value,
  label,
  color,
}: {
  icon: string
  value: number
  label: string
  color:
    | typeof COLOR_ORANGE
    | typeof COLOR_GREEN
    | typeof COLOR_RED
    | typeof COLOR_LABEL
}) {
  return (
    <VStack alignment="leading" spacing={2} frame={{ minWidth: 54 }}>
      <HStack alignment="firstTextBaseline" spacing={4}>
        <Image systemName={icon} font={11} foregroundStyle={color} />
        <Text font={20} fontWeight="semibold" foregroundStyle={color}>
          {String(value)}
        </Text>
      </HStack>
      <Text font={11} foregroundStyle={COLOR_SECONDARY_LABEL}>
        {label}
      </Text>
    </VStack>
  )
}

function RepoRow({ snapshot }: { snapshot: RepoSnapshot }) {
  return (
    <HStack alignment="center" spacing={6} frame={{ maxWidth: Infinity }}>
      <Image
        systemName={snapshot.uncommitted > 0 ? "circle.fill" : "checkmark.circle.fill"}
        font={9}
        foregroundStyle={snapshot.uncommitted > 0 ? COLOR_ORANGE : COLOR_GREEN}
      />
      <VStack alignment="leading" spacing={1}>
        <Text font={12} fontWeight="medium" foregroundStyle={COLOR_LABEL} lineLimit={1}>
          {snapshot.name}
        </Text>
        <Text font={10} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={1}>
          {snapshot.branch || "暂无分支"}
        </Text>
      </VStack>
      <Spacer />
      {snapshot.uncommitted > 0 ? (
        <Text font={11} foregroundStyle={COLOR_ORANGE}>
          {String(snapshot.uncommitted)} 改动
        </Text>
      ) : null}
      {snapshot.ahead > 0 ? (
        <Text font={10} foregroundStyle={COLOR_GREEN}>
          {String(snapshot.ahead)} 待推送
        </Text>
      ) : null}
      {snapshot.behind > 0 ? (
        <Text font={10} foregroundStyle={COLOR_RED}>
          {String(snapshot.behind)} 待拉取
        </Text>
      ) : null}
    </HStack>
  )
}

function SmallPrimaryMetric({ summary }: { summary: WidgetSummary }) {
  return (
    <HStack alignment="firstTextBaseline" spacing={5}>
      <Image
        systemName="folder.fill"
        font={12}
        foregroundStyle={COLOR_LABEL}
      />
      <Text
        font={24}
        fontWeight="semibold"
        foregroundStyle={COLOR_LABEL}
      >
        {String(summary.dirtyRepoCount)}
      </Text>
      <Text font={11} foregroundStyle={COLOR_SECONDARY_LABEL}>
        改动仓库
      </Text>
    </HStack>
  )
}

function SmallStatusSummary({ summary }: { summary: WidgetSummary }) {
  return (
    <HStack alignment="center" spacing={0} frame={{ maxWidth: Infinity }}>
      <VStack alignment="center" spacing={1}>
        <HStack alignment="firstTextBaseline" spacing={2}>
          <Image
            systemName="pencil.and.list.clipboard"
            font={10}
            foregroundStyle={COLOR_ORANGE}
          />
          <Text font={13} fontWeight="medium" foregroundStyle={COLOR_ORANGE}>
            {String(summary.uncommitted)}
          </Text>
        </HStack>
        <Text font={9} foregroundStyle={COLOR_SECONDARY_LABEL}>未提交</Text>
      </VStack>
      <Spacer />
      <VStack alignment="center" spacing={1}>
        <Text font={13} fontWeight="medium" foregroundStyle={COLOR_GREEN}>
          ↑{String(summary.ahead)}
        </Text>
        <Text font={9} foregroundStyle={COLOR_SECONDARY_LABEL}>待推送</Text>
      </VStack>
      <Spacer />
      <VStack alignment="center" spacing={1}>
        <Text font={13} fontWeight="medium" foregroundStyle={COLOR_RED}>
          ↓{String(summary.behind)}
        </Text>
        <Text font={9} foregroundStyle={COLOR_SECONDARY_LABEL}>待拉取</Text>
      </VStack>
    </HStack>
  )
}

function CenteredUpdatedAt({ summary }: { summary: WidgetSummary }) {
  return (
    <HStack alignment="center" spacing={0} frame={{ maxWidth: Infinity }}>
      <Spacer />
      <Text
        font={10}
        foregroundStyle={summary.isStale ? COLOR_ORANGE : COLOR_SECONDARY_LABEL}
        lineLimit={1}
      >
        {formatWidgetUpdatedAt(summary.latestUpdatedAt)}
      </Text>
      <Spacer />
    </HStack>
  )
}

function WidgetEdgeInset({ height }: { height: number }) {
  return <VStack frame={{ height }} />
}

function EmptyState({ summary }: { summary: WidgetSummary }) {
  const missing = summary.parameter && !summary.parameterMatched
  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: Infinity }}>
      <Image
        systemName={missing ? "questionmark.folder" : "tray"}
        font={24}
        foregroundStyle={COLOR_SECONDARY_LABEL}
      />
      <Text font={14} fontWeight="medium" foregroundStyle={COLOR_LABEL}>
        {missing ? "未找到仓库" : "还没有仓库"}
      </Text>
      <Text font={11} foregroundStyle={COLOR_SECONDARY_LABEL} lineLimit={2}>
        {missing ? "请检查小组件参数中的仓库名" : "在 gitgit 中添加仓库后即可查看状态"}
      </Text>
    </VStack>
  )
}

function SystemWidget({ summary }: { summary: WidgetSummary }) {
  const family = Widget.family
  const isSmall = family === "systemSmall"
  const isMedium = family === "systemMedium"
  const maxRows =
    family === "systemExtraLarge"
      ? 8
      : family === "systemLarge"
        ? 6
        : 2

  return (
    <VStack
      alignment="leading"
      spacing={isSmall ? 0 : isMedium ? 7 : 12}
      padding={
        isSmall
          ? { horizontal: 18 }
          : isMedium
            ? { horizontal: 18, vertical: 16 }
            : 18
      }
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" }}
      widgetBackground={COLOR_SECONDARY_BG}
    >
      {isSmall ? <WidgetEdgeInset height={12} /> : null}
      <Header summary={summary} showsUpdatedAt={!isSmall} />
      {summary.repoCount === 0 ? (
        <>
          <Spacer />
          <EmptyState summary={summary} />
          <Spacer />
        </>
      ) : (
        <>
          {isSmall ? (
            <>
              <Spacer />
              <SmallPrimaryMetric summary={summary} />
              <Spacer />
              <SmallStatusSummary summary={summary} />
              <Spacer />
              <CenteredUpdatedAt summary={summary} />
            </>
          ) : (
            <>
              <HStack alignment="center" spacing={16}>
                <Metric
                  icon="folder.fill"
                  value={summary.dirtyRepoCount}
                  label="改动仓库"
                  color={COLOR_LABEL}
                />
                <Metric
                  icon="pencil.and.list.clipboard"
                  value={summary.uncommitted}
                  label="未提交改动"
                  color={COLOR_ORANGE}
                />
                <Metric icon="arrow.up" value={summary.ahead} label="待推送" color={COLOR_GREEN} />
                <Metric icon="arrow.down" value={summary.behind} label="待拉取" color={COLOR_RED} />
              </HStack>
              {summary.snapshots.slice(0, maxRows).map((snapshot) => (
                <RepoRow key={snapshot.name} snapshot={snapshot} />
              ))}
            </>
          )}
        </>
      )}
      {isSmall ? <WidgetEdgeInset height={12} /> : null}
    </VStack>
  )
}

function AccessoryMetric({ value, label }: { value: number; label: string }) {
  return (
    <HStack alignment="firstTextBaseline" spacing={3}>
      <Text font={13} fontWeight="semibold">{String(value)}</Text>
      <Text font={11}>{label}</Text>
    </HStack>
  )
}

function AccessoryWidget({ summary }: { summary: WidgetSummary }) {
  const family = Widget.family
  const title = summary.parameter || "gitgit"

  // 单行：与系统组件相同的“改动 / 待推送 / 待拉取”文案
  if (family === "accessoryInline") {
    return (
      <Text>
{String(summary.uncommitted)} 改动 · {String(summary.ahead)} 待推送 · {String(summary.behind)} 待拉取
      </Text>
    )
  }

  // 圆形：背景 + 未提交主指标
  if (family === "accessoryCircular") {
    return (
      <VStack alignment="center" spacing={0}>
        <AccessoryWidgetBackground />
        <Image
          systemName="point.topleft.down.to.point.bottomright.curvepath"
          font={11}
        />
        <Text font={18} fontWeight="semibold">
          {String(summary.uncommitted)}
        </Text>
      </VStack>
    )
  }

  // 矩形：对齐中号结构——标题行 + 三项文字状态
  return (
    <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "topLeading" }}>
      <HStack alignment="center" spacing={4}>
        <Image
          systemName="point.topleft.down.to.point.bottomright.curvepath"
          font={12}
          widgetAccentable
        />
        <Text font={13} fontWeight="semibold" lineLimit={1}>
          {title}
        </Text>
        <Spacer />
        {summary.isStale ? (
          <Image systemName="clock.badge.exclamationmark" font={11} />
        ) : null}
      </HStack>
      {summary.repoCount === 0 ? (
        <Text font={11}>还没有仓库</Text>
      ) : (
        <HStack alignment="center" spacing={10}>
          <AccessoryMetric value={summary.uncommitted} label="改动" />
          <AccessoryMetric value={summary.ahead} label="待推送" />
          <AccessoryMetric value={summary.behind} label="待拉取" />
        </HStack>
      )}
    </VStack>
  )
}

function WidgetView({ snapshots }: { snapshots: RepoSnapshot[] }) {
  const summary = buildWidgetSummary(snapshots, Widget.parameter)
  const isAccessory = Widget.family.startsWith("accessory")
  return isAccessory ? (
    <AccessoryWidget summary={summary} />
  ) : (
    <SystemWidget summary={summary} />
  )
}

readSnapshots()
  .then((snapshots) => {
    Widget.present(<WidgetView snapshots={Object.values(snapshots)} />, {
      policy: "after",
      date: new Date(Date.now() + 30 * 60 * 1000),
    })
  })
  .catch(() => {
    Widget.present(<WidgetView snapshots={[]} />, {
      policy: "after",
      date: new Date(Date.now() + 30 * 60 * 1000),
    })
  })
