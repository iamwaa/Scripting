import type { HupuMatch, HupuRatingEntry } from "../hupuTypes"

// 虎扑响应里同一字段可能是字符串/数字/数组,统一取值工具放这里

export function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function numOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.trim() === "" || value === "-") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// 评分树里 infoJson 的值一律是「字符串数组」,统一取第一个
export function infoAt(info: any, key: string): string {
  const value = info?.[key]
  return Array.isArray(value) && value.length > 0 ? textOf(value[0]) : ""
}

// 把赛程接口的一场赛事解析成内部结构
export function parseHupuMatch(item: any, gameId: string): HupuMatch | null {
  if (!item?.matchId) return null

  const against = item.againstInfo ?? {}
  const members: any[] = Array.isArray(against.memberInfos) ? against.memberInfos : []
  const home = members[0] ?? {}
  const away = members[1] ?? {}
  const scoreItem = item.scoreItemInfo

  // scoreItemInfo 是「当场最热评分条目」的入口(按评分人数最多选,不一定是最高分);没有它说明这场没有评分数据
  const rating: HupuRatingEntry | null =
    scoreItem && scoreItem.scoreOutBizType && scoreItem.scoreOutBizNo
      ? {
          bizType: textOf(scoreItem.scoreOutBizType),
          bizNo: textOf(scoreItem.scoreOutBizNo),
          name: textOf(scoreItem.name),
          score: numOrNull(scoreItem.scoreNum),
          countText: textOf(scoreItem.scoreCountText),
          hotComment: textOf(scoreItem.hotComment),
        }
      : null

  return {
    matchId: String(item.matchId),
    gameId,
    status: textOf(item.matchStatus),
    statusDesc: textOf(item.matchStatusDesc),
    startTime: Number(item.matchStartTimeStamp) || 0,
    intro: textOf(item.matchIntroduction) || textOf(item.matchName),
    homeName: textOf(home.memberName),
    awayName: textOf(away.memberName),
    homeScore: numOrNull(home.memberBaseScore),
    awayScore: numOrNull(away.memberBaseScore),
    homeLogo: textOf(home.memberLogo),
    awayLogo: textOf(away.memberLogo),
    // 比赛级评分人数文案(scoreItemInfo 里的是该热门条目的)
    scoreCountText: textOf(item.scoreCountText),
    rating,
  }
}
