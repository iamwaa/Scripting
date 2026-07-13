import type { Subscription, Settings, Match } from "./types"
import { DEFAULT_SETTINGS } from "./types"

const SETTINGS_KEY = "esports_settings"
const SUBSCRIPTIONS_KEY = "esports_subscriptions"
const MATCHES_CACHE_KEY = "esports_matches_cache"

export function loadSettings(): Settings {
  const saved = Storage.get<Settings>(SETTINGS_KEY)
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): void {
  Storage.set(SETTINGS_KEY, settings)
}

export function loadSubscriptions(): Subscription[] {
  return Storage.get<Subscription[]>(SUBSCRIPTIONS_KEY) ?? []
}

export function saveSubscriptions(subs: Subscription[]): void {
  Storage.set(SUBSCRIPTIONS_KEY, subs)
}

export function isSubscribed(subs: Subscription[], matchId: number): boolean {
  return subs.some((s) => s.matchId === matchId)
}

export function toggleSubscription(
  subs: Subscription[],
  match: Match,
  notifyMinutesBefore: number,
): Subscription[] {
  const exists = subs.find((s) => s.matchId === match.id)
  if (exists) {
    return subs.filter((s) => s.matchId !== match.id)
  }
  return [...subs, { matchId: match.id, notifyMinutesBefore, match }]
}

export function updateSubscriptionsWithMatches(
  subs: Subscription[],
  matches: Match[],
): Subscription[] {
  return subs.map((sub) => {
    const match = matches.find((item) => item.id === sub.matchId)
    return match ? { ...sub, match } : sub
  })
}

export function updateSubscriptionsNotifyMinutesBefore(
  subs: Subscription[],
  notifyMinutesBefore: number,
): Subscription[] {
  return subs.map((sub) => ({ ...sub, notifyMinutesBefore }))
}

// 3 小时(毫秒),用于判定“已从接口消失的订阅赛事”是否已结束
const EXPIRED_MISSING_MATCH_THRESHOLD_MS = 3 * 60 * 60 * 1000

export function cleanupExpiredSubscriptions(
  subs: Subscription[],
  matches: Match[],
): Subscription[] {
  const matchMap = new Map(matches.map((m) => [m.id, m]))

  return subs.filter((sub) => {
    const match = matchMap.get(sub.matchId)
    if (match) {
      // 只移除已结束的比赛提醒;进行中仍保留订阅,便于查看实时比分
      return match.status !== "finished"
    }

    // 接口不再返回这场比赛,按最后已知时间给 3 小时缓冲
    const lastScheduled = sub.match?.scheduled_at
      ? new Date(sub.match.scheduled_at).getTime()
      : 0
    return Date.now() - lastScheduled < EXPIRED_MISSING_MATCH_THRESHOLD_MS
  })
}

// 比较两次订阅列表在关键字段上是否有变化(matchId / 提醒时间 / 比赛状态 / 比赛时间 / 实时比分)
export function subscriptionsNeedUpdate(
  prev: Subscription[],
  next: Subscription[],
): boolean {
  if (prev.length !== next.length) return true

  const scoreKey = (match: Match | undefined) => {
    if (!match) return ""
    // 用比分字符串作为数据变化的指纹,保证进行中比赛的分数更新能触发状态刷新
    return (match.results ?? []).map((r) => `${r.teamId}:${r.score}`).sort().join(",")
  }

  const snapshotKey = (sub: Subscription) => {
    const match = sub.match
    return [
      sub.matchId,
      sub.notifyMinutesBefore,
      match?.status ?? "",
      match?.scheduled_at ?? "",
      scoreKey(match),
    ].join("|")
  }

  return prev.some((sub, index) => snapshotKey(sub) !== snapshotKey(next[index]))
}

export function loadMatchesCache(): Match[] {
  return Storage.get<Match[]>(MATCHES_CACHE_KEY) ?? []
}

export function saveMatchesCache(matches: Match[]): void {
  Storage.set(MATCHES_CACHE_KEY, matches)
}
