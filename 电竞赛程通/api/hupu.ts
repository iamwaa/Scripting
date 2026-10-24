import { fetch } from "scripting"
import type {
  HupuComment,
  HupuMatch,
  HupuPeriod,
  HupuScoreBoard,
  HupuScoreCard,
  HupuTeam,
} from "../hupuTypes"
import { infoAt, numOrNull, parseHupuMatch, textOf } from "../utils/hupuParse"

// 虎扑接口实测(2026-10):赛程与评分树均可匿名访问,不需要 Cookie / 签名
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

const SCHEDULE_URL =
  "https://match-api.hupu.com/1/8.2.10/matchallapi/bff/standard/getScheduleListByTagForH5"
const SCORE_BASE = "https://games.mobileapi.hupu.com/1/8.0.99/bplcommentapi/bpl"

export interface HupuGameOption {
  id: string
  label: string
}

// 实测有赛程数据的 businessId;cs2 / pubg 有赛程但虎扑未开放评分
export const HUPU_GAMES: HupuGameOption[] = [
  { id: "lol", label: "英雄联盟" },
  { id: "lpl", label: "LPL" },
  { id: "lck", label: "LCK" },
  { id: "kog", label: "王者荣耀" },
  { id: "val", label: "无畏契约" },
  { id: "pubg", label: "绝地求生" },
  { id: "cs2", label: "CS2" },
]

async function getJson(url: string, referer: string): Promise<any> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Referer: referer },
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }
  return (await response.json()) as any
}

export interface HupuScheduleResult {
  anchorMatchId: string | null
  matches: HupuMatch[]
}

// 拉取某个项目的整段赛程(一次约 100 场,覆盖数月)
export async function fetchHupuMatches(gameId: string): Promise<HupuScheduleResult> {
  const url = new URL(SCHEDULE_URL)
  url.searchParams.set("businessType", "common")
  url.searchParams.set("datasource", "navigation")
  url.searchParams.set("businessId", gameId)

  const data = await getJson(url.toString(), "https://bbs.hupu.com/")
  const result = data?.result ?? {}
  const days: any[] = Array.isArray(result.dayGameData) ? result.dayGameData : []

  const matches: HupuMatch[] = []
  for (const day of days) {
    for (const item of day?.matchData ?? []) {
      const match = parseHupuMatch(item, gameId)
      if (match) matches.push(match)
    }
  }
  matches.sort((a, b) => a.startTime - b.startTime)

  return {
    anchorMatchId: result.anchorMatchId ? String(result.anchorMatchId) : null,
    matches,
  }
}

interface NodeRef {
  bizType: string
  bizNo: string
}

// 取节点自身:返回详情与父节点引用(评分树是 条目 -> 局 -> 比赛)
async function getSelfNode(ref: NodeRef): Promise<{ detail: any; parent: NodeRef | null }> {
  const url = new URL(`${SCORE_BASE}/score_tree/getSelfByBizKey`)
  url.searchParams.set("outBizType", ref.bizType)
  url.searchParams.set("outBizNo", ref.bizNo)

  const data = await getJson(url.toString(), "https://m.hupu.com/")
  const body = data?.data
  if (!body) throw new Error("该比赛暂无评分数据")

  const links: any[] = Array.isArray(body.linkNodes) ? body.linkNodes : []
  const parentKey = links.find((link) => link?.target === "PARENT" && link?.outBizKey)?.outBizKey

  return {
    detail: body.detail ?? {},
    parent: parentKey
      ? { bizType: textOf(parentKey.outBizType), bizNo: textOf(parentKey.outBizNo) }
      : null,
  }
}

async function getChildNodes(ref: NodeRef): Promise<any[]> {
  const url = new URL(`${SCORE_BASE}/score_tree/getCurAndSubNodeByBizKey`)
  url.searchParams.set("outBizType", ref.bizType)
  url.searchParams.set("outBizNo", ref.bizNo)
  url.searchParams.set("relation", "CHILD")
  url.searchParams.set("page", "1")
  url.searchParams.set("pageSize", "50")

  const data = await getJson(url.toString(), "https://m.hupu.com/")
  const rows = data?.data?.pageResult?.data
  return Array.isArray(rows) ? rows : []
}

function sameNode(a: NodeRef | null, b: NodeRef | null): boolean {
  return !!a && !!b && a.bizType === b.bizType && a.bizNo === b.bizNo
}

// 从任意评分条目上溯到比赛节点,并整理出可切换的「局」列表;默认停在第一局
export async function fetchHupuScoreBoard(bizType: string, bizNo: string): Promise<HupuScoreBoard> {
  const visited: NodeRef[] = []
  let current: NodeRef | null = { bizType, bizNo }
  let topDetail: any = {}

  while (current) {
    if (visited.some((node) => sameNode(node, current))) break
    visited.push(current)
    const self = await getSelfNode(current)
    if (!self.parent) {
      topDetail = self.detail
      break
    }
    current = self.parent
  }

  const topRef = visited[visited.length - 1]
  if (!topRef) throw new Error("该比赛暂无评分数据")

  const children = await getChildNodes(topRef)
  const topInfo = topDetail.infoJson ?? {}

  // 子节点类型与入口条目不同,说明比赛下挂的是分「局」;相同说明直接挂选手
  const childType = textOf(children[0]?.node?.bizType)
  const isGrouping = children.length > 0 && childType !== bizType

  const periods: HupuPeriod[] = isGrouping
    ? children
        .map((row) => row?.node)
        .filter(Boolean)
        .map((node: any) => ({
          bizType: textOf(node.bizType),
          bizNo: textOf(node.bizId),
          name: textOf(node.name) || "本局",
          order: Number(infoAt(node.infoJson, "boNum")) || 0,
        }))
    : [{ bizType: topRef.bizType, bizNo: topRef.bizNo, name: "", order: 1 }]

  // 按局号升序;缺失 boNum(order=0)的节点沉到最后,保证 periods[0] 真是第一局
  periods.sort((a, b) => (a.order || 999) - (b.order || 999))

  const teams: HupuTeam[] = []
  const homeId = infoAt(topInfo, "homeTeamId")
  const awayId = infoAt(topInfo, "awayTeamId")
  if (homeId) {
    teams.push({
      id: homeId,
      name: infoAt(topInfo, "homeTeamName"),
      logo: infoAt(topInfo, "homeTeamLogo"),
      score: numOrNull(infoAt(topInfo, "homeTeamScore")),
    })
  }
  if (awayId) {
    teams.push({
      id: awayId,
      name: infoAt(topInfo, "awayTeamName"),
      logo: infoAt(topInfo, "awayTeamLogo"),
      score: numOrNull(infoAt(topInfo, "awayTeamScore")),
    })
  }

  const defaultPeriod = periods[0]

  // 只有已结束的比赛才用 winTeamId 区分胜负,避免未开赛/进行中误标
  const winTeamId = infoAt(topInfo, "winTeamId")
  const matchStatus = infoAt(topInfo, "matchStatus")

  return {
    competitionLabel: [infoAt(topInfo, "competitionTypeCn"), infoAt(topInfo, "competitionStageTypeCn")]
      .filter(Boolean)
      .join(" · "),
    // infoJson 里的 matchTime 是秒级时间戳
    matchTime: (numOrNull(infoAt(topInfo, "matchTime")) ?? 0) * 1000,
    teams,
    winnerTeamId: matchStatus === "COMPLETED" ? winTeamId : "",
    periods,
    defaultPeriodBizNo: defaultPeriod?.bizNo ?? "",
  }
}

// 拉取某一局(或整场)下的全部评分条目
export async function fetchHupuScoreCards(bizType: string, bizNo: string): Promise<HupuScoreCard[]> {
  const rows = await getChildNodes({ bizType, bizNo })
  const cards: HupuScoreCard[] = []

  for (const row of rows) {
    const node = row?.node
    if (!node) continue
    const info = node.infoJson ?? {}
    const type = infoAt(info, "type")
    // 禁选英雄不是人物条目,跳过
    if (type === "bpHero") continue

    const hot = Array.isArray(node.hotCommentModels) ? node.hotCommentModels[0] : null
    cards.push({
      bizType: textOf(node.bizType),
      bizNo: textOf(node.bizId),
      name: textOf(node.name) || "未知",
      avatar: Array.isArray(node.image) ? textOf(node.image[0]) : "",
      // 本局使用英雄的头像;教练/解说/无畏契约等为字串
      heroPic: infoAt(info, "auxiliaryPic"),
      score: numOrNull(node.scoreAvg),
      scoreCount: Number(node.scorePersonCount ?? 0),
      commentCount: Number(node.commentCount ?? 0),
      desc: infoAt(info, "desc"),
      teamId: infoAt(info, "teamId"),
      hotComment: hot ? textOf(hot.commentContent) : "",
      hotCommentUser: hot ? textOf(hot.commentUserName) : "",
      hotCommentAvatar: hot ? textOf(hot.commentUserHeadImg) : "",
    })
  }

  // 高分在前;无评分沉底
  cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  return cards
}

// 评论排序:最新/最早走 comment/list 的 order 方向;热门是独立接口
// 实测(2026-10-24) order 只接受 asc / desc,传 hot、like 等一律返回空数组,
// 服务端不提供热度排序的分页列表,只能用 comment/hottest
export type HupuCommentSort = "latest" | "earliest" | "hot"

export const HUPU_COMMENT_SORTS: { value: HupuCommentSort; label: string }[] = [
  { value: "latest", label: "最新" },
  { value: "earliest", label: "最早" },
  { value: "hot", label: "热门" },
]

function mapComment(item: any): HupuComment {
  return {
    id: textOf(item.commentId),
    user: textOf(item.commentUserName) || "虎扑用户",
    avatar: textOf(item.commentUserHeadImg),
    content: textOf(item.commentContent) || (Array.isArray(item.commentContentImages) ? "[图片]" : ""),
    date: textOf(item.commentDate),
    ip: textOf(item.ipLocation),
    score: numOrNull(item.score) ?? 0,
    lightCount: Number(item.lightCount ?? 0),
    replyTo: textOf(item.parentCommentUserName),
  }
}

// 评论按时间游标翻页:倒序首屏传当前时间戳,正序首屏传 0,之后都传上一页的 nextCursor
// 热门接口一次返回服务端算好的热评列表,没有游标翻页(total 固定返回 0,由调用方沿用已知总数)
export async function fetchHupuComments(
  bizType: string,
  bizNo: string,
  sort: HupuCommentSort,
  cursor: number | null,
): Promise<{ comments: HupuComment[]; nextCursor: number | null; total: number }> {
  if (sort === "hot") {
    const hotUrl = new URL(`${SCORE_BASE}/comment/hottest`)
    hotUrl.searchParams.set("outBizType", bizType)
    hotUrl.searchParams.set("outBizNo", bizNo)

    const hotData = await getJson(hotUrl.toString(), "https://m.hupu.com/")
    const hotList: any[] = Array.isArray(hotData?.data) ? hotData.data : []
    return { comments: hotList.map(mapComment), nextCursor: null, total: 0 }
  }

  const asc = sort === "earliest"
  const url = new URL(`${SCORE_BASE}/comment/list`)
  url.searchParams.set("outBizType", bizType)
  url.searchParams.set("outBizNo", bizNo)
  url.searchParams.set("order", asc ? "asc" : "desc")
  url.searchParams.set("publishTime", String(cursor ?? (asc ? 0 : Date.now())))

  const data = await getJson(url.toString(), "https://m.hupu.com/")
  const body = data?.data ?? {}
  const rawList: any[] = Array.isArray(body.comments) ? body.comments : []

  const comments: HupuComment[] = rawList.map(mapComment)

  const next = Number(body.cursor?.publishTime ?? 0)
  const hasMore = comments.length > 0 && next > 0 && next !== cursor

  return {
    comments,
    nextCursor: hasMore ? next : null,
    total: Number(body.commentCount ?? 0),
  }
}
