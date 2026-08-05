import { HStack, VStack, ZStack, Text, Button, Image, Spacer } from "scripting"
import type { Match, MatchResult, Opponent } from "../types"
import { formatMatchTime } from "../utils/format"
import { getGameDisplayName } from "../utils/videogameNames"
import { getStageDisplayName } from "../utils/stageTerms"

function gameDisplayName(match: Match): string {
  return getGameDisplayName({
    videogameSlug: match.videogameSlug,
    videogameName: match.videogame,
    titleSlug: match.videogameTitleSlug,
    titleName: match.videogameTitle,
  })
}

interface MatchRowProps {
  match: Match
  subscribed: boolean
  onToggle: (match: Match) => void
  showSubscribe?: boolean
}

// 赛事阶段标题:优先用 match.name 的阶段描述(如 "Upper bracket final"),
// 比泛阶段词(如 tournament 的 "Playoffs")更清晰;
// name 格式常为 "阶段: 队A vs 队B",取冒号前部分避免与左右队名重复;
// 若 name 无冒号(没有阶段前半段)则回退原逻辑
function eventTitle(match: Match): string {
  const colonIdx = match.name?.indexOf(":") ?? -1
  if (colonIdx > 0) {
    const stagePart = match.name.slice(0, colonIdx).trim()
    let label = getStageDisplayName(stagePart)
    // 去掉同阶段多场比赛的序号后缀,如 "胜者组半决赛 1" / "半决赛2" -> "胜者组半决赛" / "半决赛";
    // 只剥离译出后末尾的纯数字,不影响含数字的阶段名("16强赛"/"第1轮"/"第2场" 均不以数字结尾)
    label = label.replace(/\s*\d+\s*$/, "").trim()
    return label
  }
  const raw = match.tournament || match.serie || match.name || "赛事"
  return getStageDisplayName(raw)
}

function compactLeagueTitle(match: Match): string {
  const name = match.league.trim()
  const acronym = name.match(/\b[A-Z0-9]{2,6}\b/)?.[0]

  if (acronym) return acronym
  return name || gameDisplayName(match) || "赛区"
}

// 联赛名:优先取名称中的缩写,否则用游戏名兜底
function leagueTitle(match: Match): string {
  return compactLeagueTitle(match)
}

function teamName(opponent?: Opponent): string {
  return opponent?.acronym || opponent?.name || "待定"
}

function TeamLogo({ opponent }: { opponent?: Opponent }) {
  if (opponent?.imageUrl) {
    return (
      <Image
        imageUrl={opponent.imageUrl}
        resizable
        scaleToFit
        frame={{ width: 34, height: 34 }}
        placeholder={
          <Image
            systemName="shield.fill"
            resizable
            scaleToFit
            frame={{ width: 28, height: 28 }}
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
      frame={{ width: 28, height: 28 }}
      foregroundStyle="secondaryLabel"
    />
  )
}

function TeamBlock({ opponent }: { opponent?: Opponent }) {
  return (
    <VStack alignment="center" spacing={6} frame={{ minWidth: 92, maxWidth: "infinity", alignment: "center" }}>
      <TeamLogo opponent={opponent} />
      <Text font="callout" fontWeight="semibold" lineLimit={1} multilineTextAlignment="center">
        {teamName(opponent)}
      </Text>
    </VStack>
  )
}

function isLoser(teamId: number | null, results: MatchResult[], winnerId?: number | null): boolean {
  if (!teamId || results.length < 2) return false
  // 有明确的 winnerId 且不是自己
  if (winnerId != null) return teamId !== winnerId
  // 无 winnerId 时按比分判断
  const myScore = results.find((r) => r.teamId === teamId)?.score ?? 0
  const otherScore = results.find((r) => r.teamId !== teamId)?.score ?? 0
  return myScore < otherScore
}

function CenterBlock({ match }: { match: Match }) {
  const leftTeam = match.opponents[0]
  const rightTeam = match.opponents[1]
  const isRunning = match.status === "running"
  const isFinished = match.status === "finished"
  const hasResults = match.results.length >= 2

  const leftScore = leftTeam?.id != null
    ? match.results.find((r) => r.teamId === leftTeam.id)?.score ?? null
    : null
  const rightScore = rightTeam?.id != null
    ? match.results.find((r) => r.teamId === rightTeam.id)?.score ?? null
    : null
  const hasScore = leftScore != null && rightScore != null

  // 有比分时显示赛况,否则显示 VS 与开赛时间
  if ((isRunning || isFinished) && hasScore && hasResults) {
    const leftLoser = isLoser(leftTeam?.id ?? null, match.results)
    const rightLoser = isLoser(rightTeam?.id ?? null, match.results)

    return (
      <VStack alignment="center" spacing={4} frame={{ width: 112, alignment: "center" }}>
        <Text foregroundStyle="secondaryLabel" font="caption2" lineLimit={1} multilineTextAlignment="center">
          {eventTitle(match)}
        </Text>
        <HStack alignment="center" spacing={8}>
          <Text
            font={isFinished ? "title" : "title2"}
            fontWeight="bold"
            foregroundStyle={leftLoser ? "tertiaryLabel" : undefined}
          >
            {String(leftScore)}
          </Text>
          <Text font={isFinished ? "title" : "title2"} foregroundStyle="secondaryLabel">
            :
          </Text>
          <Text
            font={isFinished ? "title" : "title2"}
            fontWeight="bold"
            foregroundStyle={rightLoser ? "tertiaryLabel" : undefined}
          >
            {String(rightScore)}
          </Text>
        </HStack>
        {isRunning ? (
          <Text foregroundStyle="green" font="caption2" fontWeight="semibold">
            进行中
          </Text>
        ) : null}
      </VStack>
    )
  }

  // 未开始
  return (
    <VStack alignment="center" spacing={6} frame={{ width: 112, alignment: "center" }}>
      <Text foregroundStyle="secondaryLabel" font="caption" lineLimit={2} multilineTextAlignment="center">
        {eventTitle(match)}
      </Text>
      <Text foregroundStyle="secondaryLabel" font="caption" fontWeight="bold">
        VS
      </Text>
      <Text foregroundStyle="secondaryLabel" font="caption" lineLimit={1} multilineTextAlignment="center">
        {formatMatchTime(match.scheduled_at)}
      </Text>
    </VStack>
  )
}

export function MatchRow({ match, subscribed, onToggle, showSubscribe = true }: MatchRowProps) {
  const leftTeam = match.opponents[0]
  const rightTeam = match.opponents[1]
  // 未开始与进行中的比赛可订阅
  const canSubscribe = match.status === "not_started" || match.status === "running"

  return (
    <VStack alignment="leading" spacing={12}>
      {/* 联赛名底层占整行居中,游戏名叠在左上、订阅按钮叠在右上 */}
      <ZStack frame={{ maxWidth: "infinity", alignment: "center" }}>
        {/* 联赛名:整行左右居中,主标题样式 */}
        <Text
          font="headline"
          fontWeight="semibold"
          lineLimit={1}
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          {leagueTitle(match)}
        </Text>
        {/* 上层 HStack:游戏名贴左、与联赛名垂直居中;订阅按钮贴右 */}
        <HStack alignment="center" spacing={6} frame={{ maxWidth: "infinity" }}>
          <Text
            foregroundStyle="secondaryLabel"
            font="caption2"
            fontWeight="medium"
            lineLimit={1}
          >
            {gameDisplayName(match)}
          </Text>
          <Spacer minLength={0} />
          {showSubscribe && canSubscribe ? (
            <Button action={() => onToggle(match)}>
              <Image
                systemName={subscribed ? "bell.fill" : "bell"}
                resizable
                scaleToFit
                frame={{ width: 18, height: 18 }}
                foregroundStyle={subscribed ? "orange" : "secondaryLabel"}
              />
            </Button>
          ) : null}
        </HStack>
      </ZStack>

      <HStack alignment="center" spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
        <TeamBlock opponent={leftTeam} />
        <Spacer minLength={0} />
        <CenterBlock match={match} />
        <Spacer minLength={0} />
        <TeamBlock opponent={rightTeam} />
      </HStack>

    </VStack>
  )
}
