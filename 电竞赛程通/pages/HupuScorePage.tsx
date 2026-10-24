import {
  NavigationLink,
  List,
  Section,
  Text,
  VStack,
  HStack,
  Image,
  Spacer,
  Picker,
  ProgressView,
  useState,
  useEffect,
} from "scripting"
import type { HupuScoreBoard, HupuScoreCard, HupuTeam } from "../hupuTypes"
import { fetchHupuScoreBoard, fetchHupuScoreCards } from "../api/hupu"
import { HupuAvatar } from "../components/HupuAvatar"
import { HupuCommentBubble } from "../components/HupuCommentBubble"
import { HupuScoreBadge, formatCount } from "../components/HupuScoreBadge"
import { HupuCommentsPage } from "./HupuCommentsPage"

interface HupuScorePageProps {
  bizType: string
  bizNo: string
  // 赛程页已知的标题,评分树加载完成前先用它兜底
  title?: string
}

// 由虎扑赛程页推入的子页:自身不带 NavigationStack,复用父级导航栈
export function HupuScorePage({ bizType, bizNo, title }: HupuScorePageProps) {
  const [board, setBoard] = useState<HupuScoreBoard | null>(null)
  const [cards, setCards] = useState<HupuScoreCard[]>([])
  const [periodBizNo, setPeriodBizNo] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 首次进入:先取评分树(比赛信息 + 局列表),默认展示第一局
  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const nextBoard = await fetchHupuScoreBoard(bizType, bizNo)
        if (!active) return
        setBoard(nextBoard)
        setPeriodBizNo(nextBoard.defaultPeriodBizNo)
      } catch (e) {
        if (active) setError(String(e))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [bizType, bizNo])

  // 切换对局时单独拉该局的评分条目
  useEffect(() => {
    if (!board || !periodBizNo) return
    const period = board.periods.find((item) => item.bizNo === periodBizNo)
    if (!period) return

    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const nextCards = await fetchHupuScoreCards(period.bizType, period.bizNo)
        if (active) setCards(nextCards)
      } catch (e) {
        if (active) setError(String(e))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [board, periodBizNo])

  const periods = board?.periods ?? []
  const showPeriodPicker = periods.length > 1
  const cardGroups = groupCardsByTeam(cards, board)

  return (
    <List navigationTitle="评分榜" navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden">
      {error ? (
        <Section>
          <Text foregroundStyle="red" font={14}>
            {error}
          </Text>
        </Section>
      ) : null}

      {board ? (
        <Section>
          <VStack alignment="center" spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
            {/* 赛事:赛事类型 · 阶段 */}
            <Text
              font={13}
              foregroundStyle="secondaryLabel"
              lineLimit={2}
              multilineTextAlignment="center"
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              {board.competitionLabel || title || "比赛评分"}
            </Text>
            {/* 比赛日期 */}
            <Text
              font={12}
              foregroundStyle="tertiaryLabel"
              lineLimit={1}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              {formatMatchDate(board.matchTime)}
            </Text>
            {/* 队标 队名 比分 : 比分 队名 队标;两侧队伍块向中间收拢,比分放大居中 */}
            <HStack spacing={10} frame={{ maxWidth: "infinity" }} padding={{ vertical: 4, horizontal: 2 }}>
              {/* 左侧:队标在外、队名贴着比分;整块靠右(向比分收拢) */}
              <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "trailing" }}>
                <HupuAvatar url={board.teams[0]?.logo ?? ""} size={32} fallbackSystemName="shield.fill" />
                <TeamName name={board.teams[0]?.name} result={resultOfTeam(board, board.teams[0])} />
              </HStack>

              {/* 比分列不参与压缩,队伍名过长时先缩字 */}
              <HStack spacing={6} layoutPriority={2}>
                <Text
                  font={28}
                  fontWeight="bold"
                  foregroundStyle={resultColor(resultOfTeam(board, board.teams[0]))}
                  lineLimit={1}
                >
                  {scoreText(board.teams[0]?.score)}
                </Text>
                <Text font={20} fontWeight="semibold" foregroundStyle="tertiaryLabel">
                  :
                </Text>
                <Text
                  font={28}
                  fontWeight="bold"
                  foregroundStyle={resultColor(resultOfTeam(board, board.teams[1]))}
                  lineLimit={1}
                >
                  {scoreText(board.teams[1]?.score)}
                </Text>
              </HStack>

              {/* 右侧:队名贴着比分、队标在外;整块靠左(向比分收拢) */}
              <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <TeamName name={board.teams[1]?.name} result={resultOfTeam(board, board.teams[1])} />
                <HupuAvatar url={board.teams[1]?.logo ?? ""} size={32} fallbackSystemName="shield.fill" />
              </HStack>
            </HStack>
          </VStack>
        </Section>
      ) : null}

      {/* 多局比赛才需要切换;单局直接展示 */}
      {showPeriodPicker ? (
        <Section title="对局">
          <Picker title="当前对局" value={periodBizNo} onChanged={(value: string) => setPeriodBizNo(value)}>
            {periods.map((period) => (
              <Text key={period.bizNo} tag={period.bizNo}>
                {period.name}
              </Text>
            ))}
          </Picker>
        </Section>
      ) : null}

      {loading && cards.length === 0 ? (
        <Section>
          <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={20}>
            <ProgressView />
          </HStack>
        </Section>
      ) : null}

      {cardGroups.map((group) => (
        <Section key={group.key} title={group.label}>
          {group.items.map((card) => (
            <NavigationLink
              key={`${card.bizType}-${card.bizNo}`}
              destination={
                <HupuCommentsPage
                  bizType={card.bizType}
                  bizNo={card.bizNo}
                  name={card.name}
                  avatar={card.avatar}
                  score={card.score}
                  commentCount={card.commentCount}
                />
              }
            >
              <ScoreCardRow card={card} />
            </NavigationLink>
          ))}
        </Section>
      ))}

      {!loading && !error && cards.length === 0 ? (
        <Section>
          <VStack alignment="center" spacing={10} frame={{ minHeight: 140, maxWidth: "infinity", alignment: "center" }}>
            <Image
              systemName="chart.bar.doc.horizontal"
              resizable
              scaleToFit
              frame={{ width: 36, height: 36 }}
              foregroundStyle="secondaryLabel"
            />
            <Text font={14} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              这场比赛还没有评分数据
            </Text>
          </VStack>
        </Section>
      ) : null}
    </List>
  )
}

function ScoreCardRow({ card }: { card: HupuScoreCard }) {
  return (
    <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
        <HupuAvatar url={card.avatar} size={40} fallbackSystemName="person.crop.circle" />
        {/* frame 不带 alignment 时内容默认居中,必须显式 leading 才能靠左 */}
        <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <Text font={16} fontWeight="medium" lineLimit={1}>
            {card.name}
          </Text>
          {card.desc || card.heroPic ? (
            <HStack spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {/* 本局使用的英雄头像紧贴 KDA 左侧;教练/解说等无该图 */}
              {card.heroPic ? (
                <HupuAvatar url={card.heroPic} size={20} shape="rounded" fallbackSystemName="shield.fill" />
              ) : null}
              {card.desc ? (
                <Text font={14} foregroundStyle="secondaryLabel" lineLimit={1}>
                  {card.desc}
                </Text>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
        <Spacer minLength={4} />
        <VStack alignment="trailing" spacing={3}>
          <HupuScoreBadge score={card.score} count={card.scoreCount} size={19} />
          {card.commentCount > 0 ? (
            <Text font={11} foregroundStyle="tertiaryLabel">
              {formatCount(card.commentCount)} 评论
            </Text>
          ) : null}
        </VStack>
      </HStack>

      {/* 热评气泡:带评论用户头像与昵称,昵称缺失时回退为火苗图标 */}
      {card.hotComment ? (
        <HupuCommentBubble content={card.hotComment} user={card.hotCommentUser} avatar={card.hotCommentAvatar} />
      ) : null}
    </VStack>
  )
}

// 比分为空时用占位符,避免头部左右错位
function scoreText(score: number | null | undefined): string {
  return score == null ? "-" : String(score)
}

interface TeamNameProps {
  name: string | undefined
  result: SideResult
}

// 队名自适应:只占自身内容宽度(不拉伸),过长时单行自动缩字(最6成),不折行也不截断
// 不能给它 maxWidth:infinity —— 那会把队名撑满半个区,短队名的队标被推到最外侧
function TeamName({ name, result }: TeamNameProps) {
  return (
    <Text
      font={17}
      fontWeight="semibold"
      foregroundStyle={resultColor(result)}
      lineLimit={1}
      minScaleFactor={0.6}
    >
      {name || "待定"}
    </Text>
  )
}

// 胜负:仅已结束、接口给出胜方且比分不同时区分,其余按常规显示
type SideResult = "win" | "lose" | "none"

function resultOfTeam(board: HupuScoreBoard, team: HupuTeam | undefined): SideResult {
  if (!team || !board.winnerTeamId) return "none"
  const [home, away] = board.teams
  if (home?.score != null && away?.score != null && home.score === away.score) return "none"
  return team.id === board.winnerTeamId ? "win" : "lose"
}

// 胜方用主文字色,负方降一级,自动适配深浅色模式
function resultColor(result: SideResult) {
  return result === "lose" ? "tertiaryLabel" : "label"
}

// 比赛日期:2026年8月19日 周三 19:00;时间未知时只显日期
function formatMatchDate(timestamp: number): string {
  if (!timestamp) return "比赛时间待定"
  const date = new Date(timestamp)
  const week = "日一二三四五六"[date.getDay()]
  const day = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${week}`
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  // 虎扑的 matchTime 常为整点占位,00:00 视为未公布具体开赛时间
  return hh === "00" && mm === "00" ? day : `${day} ${hh}:${mm}`
}

interface CardGroup {
  key: string
  label: string
  items: HupuScoreCard[]
}

// 按 teamId 把条目归到主客队;解说等无队伍的条目单独一组
function groupCardsByTeam(cards: HupuScoreCard[], board: HupuScoreBoard | null): CardGroup[] {
  if (!board || board.teams.length === 0) {
    return cards.length > 0 ? [{ key: "all", label: "选手评分", items: cards }] : []
  }

  const groups: CardGroup[] = board.teams.map((team) => ({
    key: team.id,
    label: team.name || "队伍",
    items: [],
  }))
  const others: HupuScoreCard[] = []

  for (const card of cards) {
    const group = card.teamId ? groups.find((item) => item.key === card.teamId) : undefined
    if (group) group.items.push(card)
    else others.push(card)
  }

  const result = groups.filter((group) => group.items.length > 0)
  if (others.length > 0) result.push({ key: "others", label: "解说 / 其他", items: others })
  return result
}
