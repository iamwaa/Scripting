import { Grid, GridRow, HStack, NavigationLink, Spacer, Text, VStack } from "scripting"
import type { HupuMatch } from "../hupuTypes"
import { HupuAvatar } from "./HupuAvatar"
import { HupuCommentBubble } from "./HupuCommentBubble"
import { HupuScoreBadge } from "./HupuScoreBadge"
import { HupuScorePage } from "../pages/HupuScorePage"

interface HupuMatchRowProps {
  match: HupuMatch
}

// 右栏三行(进程/评分/评分数)的总高度,左栏两行队伍按它平均分配,保证两栏整体等高
const ROW_GAP = 2
const STATUS_ROW_HEIGHT = 26
const SCORE_ROW_HEIGHT = 26
const COUNT_ROW_HEIGHT = 14
const BLOCK_HEIGHT = STATUS_ROW_HEIGHT + SCORE_ROW_HEIGHT + COUNT_ROW_HEIGHT + ROW_GAP * 2
const TEAM_ROW_HEIGHT = (BLOCK_HEIGHT - ROW_GAP) / 2

// 行内容区右侧被 > 号占位挤窄,标题居中时需向左补一段才能落在整行中线上
const TITLE_CENTER_PAD = 18

// 虎扑赛程行:有评分入口才可点击,避免进入空页面
export function HupuMatchRow({ match }: HupuMatchRowProps) {
  const rating = match.rating
  const body = <HupuMatchRowBody match={match} />

  if (!rating) return body

  return (
    <NavigationLink
      destination={
        <HupuScorePage
          bizType={rating.bizType}
          bizNo={rating.bizNo}
          title={`${match.homeName} vs ${match.awayName}`}
        />
      }
    >
      {body}
    </NavigationLink>
  )
}

function HupuMatchRowBody({ match }: HupuMatchRowProps) {
  const rating = match.rating
  const isLive = match.status === "PENDING"
  const statusDesc = match.statusDesc || (match.status === "COMPLETED" ? "已结束" : "未开始")
  const homeResult = resultOf(match, "home")
  const awayResult = resultOf(match, "away")

  // 无评分时右栏只有两行,行高改成与左栏一致,两栏依旧等高且逐行平齐
  const statusHeight = rating ? STATUS_ROW_HEIGHT : TEAM_ROW_HEIGHT
  const scoreHeight = rating ? SCORE_ROW_HEIGHT : TEAM_ROW_HEIGHT

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {/* 赛事 */}
      <HStack frame={{ maxWidth: "infinity" }} padding={{ leading: TITLE_CENTER_PAD }}>
        <Text
          font={13}
          fontWeight="medium"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          {match.intro || "电竞比赛"}
        </Text>
      </HStack>

      <HStack alignment="top" spacing={10} frame={{ maxWidth: "infinity", height: BLOCK_HEIGHT }}>
        {/* 两行队伍:队名列按最长队名自适应,比分紧跟其后 */}
        <Grid alignment="leading" horizontalSpacing={10} verticalSpacing={ROW_GAP}>
          <GridRow>
            <TeamCell name={match.homeName} logo={match.homeLogo} result={homeResult} />
            <ScoreCell score={match.homeScore} result={homeResult} />
          </GridRow>
          <GridRow>
            <TeamCell name={match.awayName} logo={match.awayLogo} result={awayResult} />
            <ScoreCell score={match.awayScore} result={awayResult} />
          </GridRow>
        </Grid>

        <Spacer minLength={8} />

        {/* 右侧:进程 / 评分 / 整场评分数 */}
        <VStack alignment="trailing" spacing={ROW_GAP}>
          <Text
            font={12}
            foregroundStyle={isLive ? "green" : "tertiaryLabel"}
            lineLimit={1}
            frame={{ height: statusHeight, alignment: "trailing" }}
          >
            {statusDesc}
          </Text>
          <HStack frame={{ height: scoreHeight, alignment: "trailing" }}>
            {rating ? (
              <HupuScoreBadge score={rating.score} size={22} />
            ) : (
              <Text font={12} foregroundStyle="tertiaryLabel" lineLimit={1}>
                暂无评分
              </Text>
            )}
          </HStack>
          {/* 评分数直接取自赛程响应,不额外请求,高度固定避免跳动 */}
          {rating ? (
            <Text
              font={11}
              foregroundStyle="tertiaryLabel"
              lineLimit={1}
              frame={{ height: COUNT_ROW_HEIGHT, alignment: "trailing" }}
            >
              {match.scoreCountText || " "}
            </Text>
          ) : null}
        </VStack>
      </HStack>

      {/* 热评 */}
      {rating?.hotComment ? <HupuCommentBubble content={rating.hotComment} /> : null}
    </VStack>
  )
}

// 胜负结果:仅已结束且比分不同时区分,其余(未开始/进行中/平局)按常规显示
type TeamResult = "win" | "lose" | "none"

function resultOf(match: HupuMatch, side: "home" | "away"): TeamResult {
  const { homeScore, awayScore } = match
  if (match.status !== "COMPLETED" || homeScore == null || awayScore == null || homeScore === awayScore) {
    return "none"
  }
  const homeWin = homeScore > awayScore
  return (side === "home") === homeWin ? "win" : "lose"
}

// 胜方用主文字色,负方用浅一级的语义色,自动适配深浅色模式
function resultColor(result: TeamResult) {
  return result === "lose" ? "tertiaryLabel" : "label"
}

interface TeamCellProps {
  name: string
  logo: string
  result: TeamResult
}

// 队标 + 队名:队名只占自身宽度,不拉伸,避免把比分推到行尾
function TeamCell({ name, logo, result }: TeamCellProps) {
  return (
    <HStack spacing={6} frame={{ height: TEAM_ROW_HEIGHT }}>
      <HupuAvatar url={logo} size={22} fallbackSystemName="shield.fill" />
      <Text font={17} fontWeight="semibold" foregroundStyle={resultColor(result)} lineLimit={1}>
        {name || "待定"}
      </Text>
    </HStack>
  )
}

interface ScoreCellProps {
  score: number | null
  result: TeamResult
}

// 比分右对齐成一列,字号比队名更大
function ScoreCell({ score, result }: ScoreCellProps) {
  return (
    <Text
      font={20}
      fontWeight={result === "lose" ? "semibold" : "bold"}
      foregroundStyle={resultColor(result)}
      lineLimit={1}
      frame={{ height: TEAM_ROW_HEIGHT, minWidth: 26, alignment: "trailing" }}
      gridColumnAlignment="trailing"
    >
      {score != null ? score : "-"}
    </Text>
  )
}
