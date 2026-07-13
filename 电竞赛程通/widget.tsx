import { Widget, VStack, HStack, Text, Image, Divider, Spacer } from "scripting"
import { loadMatchesCache, loadSubscriptions, updateSubscriptionsWithMatches } from "./storage"
import { formatMatchTime } from "./utils/format"
import { getStageDisplayName } from "./utils/stageTerms"
import type { Match, Opponent } from "./types"

function teamName(opponent?: Opponent): string {
  return opponent?.acronym || opponent?.name || "待定"
}

// 赛事阶段标题:优先用 match.name 的阶段描述(如 "Upper bracket final"),
// 比泛阶段词(如 tournament 的 "Playoffs")更清晰;
// name 格式常为 "阶段: 队A vs 队B",取冒号前部分避免与左右队名重复;
// 若 name 无冒号(没有阶段前半段)则回退原逻辑
function eventTitle(match: Match): string {
  const colonIdx = match.name?.indexOf(":") ?? -1
  if (colonIdx > 0) {
    return getStageDisplayName(match.name.slice(0, colonIdx).trim())
  }
  const raw = match.tournament || match.serie || match.name || "赛事"
  return getStageDisplayName(raw)
}

function leagueName(match: Match): string {
  return match.league || "联赛"
}

// 队伍徽标,网络失败时使用盾牌占位
function TeamLogo({ opponent, size = 28 }: { opponent?: Opponent; size?: number }) {
  if (opponent?.imageUrl) {
    return (
      <Image
        imageUrl={opponent.imageUrl}
        resizable
        scaleToFit
        frame={{ width: size, height: size }}
        placeholder={
          <Image
            systemName="shield.fill"
            resizable
            scaleToFit
            frame={{ width: size * 0.8, height: size * 0.8 }}
            foregroundStyle="secondaryLabel"
          />
        }
      />
    )
  }

  return (
    <Image
      systemName="shield.fill"
      resizable
      scaleToFit
      frame={{ width: size * 0.8, height: size * 0.8 }}
      foregroundStyle="secondaryLabel"
    />
  )
}

// 从本地订阅存储读取未结束赛事,缓存仅用于补全最新信息
function getActiveSubscribedMatches(): Match[] {
  const cache = loadMatchesCache()
  const subs = updateSubscriptionsWithMatches(loadSubscriptions(), cache)

  return subs
    .map((sub) => sub.match)
    .filter((match): match is Match => !!match)
    .filter((match) => match.status !== "finished")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
}

function TeamBlock({
  opponent,
  logoSize = 32,
  minWidth = 48,
  nameFont = "caption",
  stretch = true,
  nameSpacing = 6,
}: {
  opponent?: Opponent
  logoSize?: number
  minWidth?: number
  nameFont?: "caption" | "caption2" | "callout" | "body" | "subheadline"
  stretch?: boolean
  nameSpacing?: number
}) {
  if (!stretch) {
    // 紧凑模式:LOGO 与战队名紧挨显示
    return (
      <VStack alignment="center" spacing={nameSpacing} frame={{ minWidth, alignment: "center" }}>
        <TeamLogo opponent={opponent} size={logoSize} />
        <Text font={nameFont} fontWeight="semibold" lineLimit={1} multilineTextAlignment="center">
          {teamName(opponent)}
        </Text>
      </VStack>
    )
  }
  // 撑高模式:LOGO 顶置,战队名底置,用 Spacer 撑开
  return (
    <VStack alignment="center" spacing={0} frame={{ minWidth, maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
      <TeamLogo opponent={opponent} size={logoSize} />
      <Spacer minLength={2} />
      <Text font={nameFont} fontWeight="semibold" lineLimit={1} multilineTextAlignment="center">
        {teamName(opponent)}
      </Text>
    </VStack>
  )
}

type MatchRowVariant = "small" | "medium" | "large"

// 对阵卡片:不同变体采用不同布局 ——
// 中号/大号使用本函数下半部的 HStack 行(`teamsRow`):顶部联赛,左右为 LOGO+战队名,中间为 赛事/VS/日期时间;
// 小号使用上文早退的垂直堆叠布局,不经过 `teamsRow`。
function MatchVersusRow({ match, variant = "medium" }: { match: Match; variant?: MatchRowVariant }) {
  const isRunning = match.status === "running"
  const isSmall = variant === "small"
  const isMedium = variant === "medium"
  const isLarge = variant === "large"
  const logoSize = isSmall ? 40 : isLarge ? 34 : 48
  const teamMinWidth = isSmall ? 42 : isLarge ? 50 : 64
  const centerWidth = isSmall ? 60 : isLarge ? 96 : 112
  const nameFont = isSmall ? "caption2" : isLarge ? "caption" : "callout"
  const leagueFont = isSmall ? "callout" : isLarge ? "callout" : "title3"
  const vsFont = isSmall ? "headline" : isLarge ? "callout" : "title2"
  const centerTextFont = isSmall ? "caption" : isLarge ? "caption2" : "caption"

  const header = (
    <Text font={leagueFont} fontWeight="bold" lineLimit={1} multilineTextAlignment="center">
      {leagueName(match)}
    </Text>
  )

  const teamsRow = (
    <>
      <TeamBlock
        opponent={match.opponents[0]}
        logoSize={logoSize}
        minWidth={teamMinWidth}
        nameFont={nameFont}
        stretch={!isMedium}
      />
      {isMedium ? (
        // 中号:赛事/VS/时间紧凑居中,不再随 HStack 高度撑开
        <VStack alignment="center" spacing={4} frame={{ width: centerWidth, alignment: "center" }}>
          <Text font={centerTextFont} foregroundStyle="secondaryLabel" lineLimit={1} multilineTextAlignment="center">
            {eventTitle(match)}
          </Text>
          <Text font={vsFont} fontWeight="bold" foregroundStyle="secondaryLabel" lineLimit={1}>
            VS
          </Text>
          <Text
            font={centerTextFont}
            foregroundStyle={isRunning ? "red" : "secondaryLabel"}
            fontWeight={isRunning ? "semibold" : undefined}
            lineLimit={1}
            multilineTextAlignment="center"
          >
            {isRunning ? "进行中" : formatMatchTime(match.scheduled_at)}
          </Text>
        </VStack>
      ) : (
        // 大号:中间赛事/时间紧凑靠近 VS,避免上下顶置底置拉得太散
        <VStack alignment="center" spacing={2} frame={{ width: centerWidth, maxHeight: "infinity", alignment: "center" }}>
          <Spacer minLength={0} />
          <Text font={centerTextFont} foregroundStyle="secondaryLabel" lineLimit={1} multilineTextAlignment="center">
            {eventTitle(match)}
          </Text>
          <Text font={vsFont} fontWeight="bold" foregroundStyle="secondaryLabel" lineLimit={1}>
            VS
          </Text>
          <Text
            font={centerTextFont}
            foregroundStyle={isRunning ? "red" : "secondaryLabel"}
            fontWeight={isRunning ? "semibold" : undefined}
            lineLimit={1}
            multilineTextAlignment="center"
          >
            {isRunning ? "进行中" : formatMatchTime(match.scheduled_at)}
          </Text>
          <Spacer minLength={0} />
        </VStack>
      )}
      <TeamBlock
        opponent={match.opponents[1]}
        logoSize={logoSize}
        minWidth={teamMinWidth}
        nameFont={nameFont}
        stretch={!isMedium}
      />
    </>
  )

  const rowBody = isMedium ? (
    // 中号 HStack 自然高度,由紧凑 TeamBlock 决定,spacing 加大让左右球队外移
    <HStack alignment="center" spacing={30} frame={{ maxWidth: "infinity", alignment: "center" }}>
      {teamsRow}
    </HStack>
  ) : (
    // 大号 HStack 撑满可用高度
    <HStack alignment="center" spacing={isSmall ? 4 : 8} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
      {teamsRow}
    </HStack>
  )

  // 小号:顶部联赛+赛事居中;中部左右贴边(左 logo/名 - VS - 右 logo/名);底部时间居中
  if (isSmall) {
    return (
      <VStack alignment="center" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 14, vertical: 14 }}>
        {/* 顶部:联赛名居中,自适应字号显示完整 */}
        <Text
          font={leagueFont}
          fontWeight="bold"
          lineLimit={1}
          multilineTextAlignment="center"
          minScaleFactor={0.6}
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          {leagueName(match)}
        </Text>
        {/* 赛事名居中 */}
        <Text font={centerTextFont} foregroundStyle="secondaryLabel" lineLimit={1} multilineTextAlignment="center" padding={{ top: 4 }}>
          {eventTitle(match)}
        </Text>
        {/* 中部对阵区:用 Spacer 撑满剩余空间,左 logo/名 贴左 - VS 居中 - 右 logo/名 贴右 */}
        <Spacer minLength={0} />
        <HStack alignment="center" spacing={0} frame={{ maxWidth: "infinity", alignment: "center" }}>
          <TeamBlock
            opponent={match.opponents[0]}
            logoSize={logoSize}
            minWidth={teamMinWidth}
            nameFont={nameFont}
            stretch={false}
            nameSpacing={3}
          />
          <Spacer minLength={4} />
          <Text font={vsFont} fontWeight="bold" foregroundStyle="secondaryLabel" lineLimit={1}>
            VS
          </Text>
          <Spacer minLength={4} />
          <TeamBlock
            opponent={match.opponents[1]}
            logoSize={logoSize}
            minWidth={teamMinWidth}
            nameFont={nameFont}
            stretch={false}
            nameSpacing={3}
          />
        </HStack>
        <Spacer minLength={0} />
        {/* 底部:日期时间/进行中,居中 */}
        <Text
          font={centerTextFont}
          foregroundStyle={isRunning ? "red" : "secondaryLabel"}
          fontWeight={isRunning ? "semibold" : undefined}
          lineLimit={1}
          multilineTextAlignment="center"
        >
          {isRunning ? "进行中" : formatMatchTime(match.scheduled_at)}
        </Text>
      </VStack>
    )
  }

  // 大号固定行高以让 4 个赛事等分
  if (isLarge) {
    return (
      <VStack alignment="center" spacing={3} frame={{ minHeight: 74, maxHeight: 74, maxWidth: "infinity" }}>
        {header}
        {rowBody}
      </VStack>
    )
  }

  if (isMedium) {
    // 中号:内容整体紧凑并垂直居中,由外层 padding 保证四周边距
    // 联赛行与下方对阵内容之间加大间距(14pt)以增强视觉呼吸感
    return (
      <VStack alignment="center" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <Spacer minLength={0} />
        <VStack alignment="center" spacing={14}>
          {header}
          {rowBody}
        </VStack>
        <Spacer minLength={0} />
      </VStack>
    )
  }

  // 兜底:理论上不会走到,小号已在上文单独处理
  return (
    <VStack alignment="center" spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {header}
      {rowBody}
    </VStack>
  )
}

function MatchPlaceholderRow() {
  return <VStack frame={{ maxHeight: "infinity", maxWidth: "infinity" }} />
}

function WidgetView() {
  const matches = getActiveSubscribedMatches()
  const first = matches[0]
  const family = Widget.family

  if (!first) {
    return (
      <VStack alignment="center" spacing={8} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <Spacer minLength={0} />
        <Image
          systemName="bell.slash"
          resizable
          scaleToFit
          frame={{ width: 36, height: 36 }}
          foregroundStyle="secondaryLabel"
        />
        <Text foregroundStyle="secondaryLabel" font="caption" multilineTextAlignment="center">
          暂无订阅赛事
        </Text>
        <Text foregroundStyle="tertiaryLabel" font="caption2" multilineTextAlignment="center">
          去赛程页开启提醒
        </Text>
        <Spacer minLength={0} />
      </VStack>
    )
  }

  if (family === "systemSmall" || family === "accessoryInline") {
    return <MatchVersusRow match={first} variant="small" />
  }

  if (family === "systemMedium" || family === "accessoryCircular" || family === "accessoryRectangular") {
    // 中号在卡片四周增加内边距,让内容与小组件边缘保持视觉距离
    return (
      <VStack
        alignment="center"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ horizontal: 10, vertical: 10 }}
      >
        <MatchVersusRow match={first} variant="medium" />
      </VStack>
    )
  }

  // 大号(及超大号)组件固定 4 个等分行位,不足时保留空白占位
  const displayMatches = matches.slice(0, 4)
  const rows = Array.from({ length: 4 }, (_, index) => displayMatches[index])
  return (
    <VStack alignment="center" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {rows.map((match, index) => (
        <VStack
          key={match?.id ?? `placeholder-${index}`}
          alignment="center"
          spacing={0}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        >
          <Spacer minLength={0} />
          {match ? <MatchVersusRow match={match} variant="large" /> : <MatchPlaceholderRow />}
          <Spacer minLength={0} />
          {index < rows.length - 1 && <Divider />}
        </VStack>
      ))}
    </VStack>
  )
}

Widget.present(<WidgetView />, {
  reloadPolicy: {
    policy: "after",
    date: new Date(Date.now() + 1000 * 60 * 30),
  },
})
