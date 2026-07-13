import { Script, Navigation, TabView, Label, useState, useEffect, Text, Button } from "scripting"
import { fetchUpcomingMatches, fetchRunningMatches, fetchFinishedMatches, setUsageListener } from "./api"
import {
  loadSettings,
  saveSettings,
  loadSubscriptions,
  saveSubscriptions,
  saveMatchesCache,
  toggleSubscription,
  updateSubscriptionsWithMatches,
  updateSubscriptionsNotifyMinutesBefore,
  cleanupExpiredSubscriptions,
  subscriptionsNeedUpdate,
} from "./storage"
import {
  scheduleAdvanceNotification,
  scheduleStartNotification,
  cancelMatchNotification,
  syncMatchNotifications,
} from "./notification"
import { ScheduleTab } from "./pages/ScheduleTab"
import { FinishedTab } from "./pages/FinishedTab"
import { SubscriptionsTab } from "./pages/SubscriptionsTab"
import { SettingsTab } from "./pages/SettingsTab"
import { DEFAULT_FILTERS } from "./utils/filter"
import type { Match, Settings, Subscription, MatchFilters } from "./types"
import type { ApiUsage } from "./api"

function App() {
  const dismissApp = Navigation.useDismiss()
  const [matches, setMatches] = useState<Match[]>([])
  const [optionMatches, setOptionMatches] = useState<Match[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(loadSubscriptions())
  const [settings, setSettings] = useState<Settings>(loadSettings())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS)
  const [finishedMatches, setFinishedMatches] = useState<Match[]>([])
  const [finishedOptionMatches, setFinishedOptionMatches] = useState<Match[]>([])
  const [finishedLoading, setFinishedLoading] = useState(false)
  const [finishedError, setFinishedError] = useState<string | null>(null)
  const [finishedFilters, setFinishedFilters] = useState<MatchFilters>(DEFAULT_FILTERS)
  const [tabIndex, setTabIndex] = useState(0)
  const [pendingCancelMatch, setPendingCancelMatch] = useState<Match | null>(null)
  const [usage, setUsage] = useState<ApiUsage | null>(null)

  const loadMatchesData = async (targetFilters = filters, silent = false) => {
    if (!silent) setError(null)

    if (!settings.apiToken) {
      setMatches([])
      setOptionMatches([])
      setLoading(false)
      return
    }

    // 静默刷新(轮询)不显示顶部加载指示器,避免比分跳动时的闪烁
    if (!silent) setLoading(true)
    try {
      // 首次加载拉两页(200条)获取更全的联赛/赛事
      const baseUpcoming = optionMatches.length === 0
        ? await Promise.all([
            fetchUpcomingMatches(settings.apiToken, 100, undefined, 1),
            fetchUpcomingMatches(settings.apiToken, 100, undefined, 2),
          ]).then(([p1, p2]) => [...p1, ...p2])
        : optionMatches

      // 筛选变化时额外拉一页带筛选的数据,补充选项
      const hasActiveFilter = Object.values(targetFilters).some((v) => v !== "all")
      const filteredOptionReq = hasActiveFilter
        ? fetchUpcomingMatches(settings.apiToken, 100, targetFilters)
        : Promise.resolve([] as Match[])

      // 有订阅时再拉少量已结束比赛,用于判断哪些订阅已经过期
      const recentFinishedReq = subscriptions.length > 0
        ? fetchFinishedMatches(settings.apiToken, 50)
        : Promise.resolve([] as Match[])

      const [runningBase, runningFiltered, upcomingFiltered, filteredOptionData, recentFinished] = await Promise.all([
        fetchRunningMatches(settings.apiToken, 50),
        fetchRunningMatches(settings.apiToken, 50, targetFilters),
        fetchUpcomingMatches(settings.apiToken, 100, targetFilters),
        filteredOptionReq,
        recentFinishedReq,
      ])
      const mergeUnique = (a: Match[], b: Match[]) => {
        const seen = new Set(a.map((m) => m.id))
        return [...a, ...b.filter((m) => !seen.has(m.id))]
      }
      const mergedBase = mergeUnique(runningBase, mergeUnique(baseUpcoming, filteredOptionData))
      const mergedFiltered = mergeUnique(runningFiltered, upcomingFiltered)
      // 供订阅同步使用的全量已知比赛(包含已结束数据,用于判定订阅是否过期)
      const allKnownMatches = mergeUnique(mergeUnique(mergedBase, mergedFiltered), recentFinished)

      // 缓存赛程供小组件读取
      saveMatchesCache(mergedFiltered)

      // 用最新比赛数据刷新订阅信息,并清理已结束订阅
      const refreshedSubscriptions = updateSubscriptionsWithMatches(subscriptions, allKnownMatches)
      const cleanedSubscriptions = cleanupExpiredSubscriptions(refreshedSubscriptions, allKnownMatches)

      if (subscriptionsNeedUpdate(subscriptions, cleanedSubscriptions)) {
        setSubscriptions(cleanedSubscriptions)
        saveSubscriptions(cleanedSubscriptions)
      }

      // 订阅变化后重新同步通知,避免比赛延迟后仍按旧时间推送
      if (cleanedSubscriptions.length > 0) {
        try {
          await syncMatchNotifications(allKnownMatches, cleanedSubscriptions, settings)
        } catch (notifyErr) {
          console.log(`同步通知失败: ${String(notifyErr)}`)
        }
      }

      setOptionMatches(mergedBase)
      setMatches(mergedFiltered)
    } catch (e) {
      const message = `获取赛程失败: ${String(e)}`
      console.log(message)
      setError(message)
      if (!silent) setMatches([])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadMatchesData(filters)
  }, [settings.apiToken, filters.videogame, filters.league, filters.tournament, filters.team])

  useEffect(() => {
    setUsageListener((u) => setUsage(u))
    return () => setUsageListener(null)
  }, [])

  // 订阅列表中有进行中的比赛时,定时静默刷新比分(每 60 秒)
  // Scripting 运行时不提供 setInterval,用递归 setTimeout 实现周期轮询
  useEffect(() => {
    const hasRunningSubscribed = subscriptions.some((sub) => sub.match?.status === "running")
    if (!hasRunningSubscribed) return

    let active = true
    let timerId = 0

    const scheduleNext = () => {
      timerId = setTimeout(async () => {
        if (!active) return
        await loadMatchesData(filters, true)
        if (active) scheduleNext()
      }, 60_000)
    }

    scheduleNext()

    return () => {
      active = false
      clearTimeout(timerId)
    }
  }, [subscriptions])

  const loadFinishedData = async (targetFilters = finishedFilters) => {
    setFinishedError(null)

    if (!settings.apiToken) {
      setFinishedMatches([])
      setFinishedOptionMatches([])
      setFinishedLoading(false)
      return
    }

    setFinishedLoading(true)
    try {
      const baseFinished = finishedOptionMatches.length === 0
        ? await Promise.all([
            fetchFinishedMatches(settings.apiToken, 100, undefined, 1),
            fetchFinishedMatches(settings.apiToken, 100, undefined, 2),
          ]).then(([p1, p2]) => [...p1, ...p2])
        : finishedOptionMatches

      // 筛选变化时额外拉一页带筛选的数据,补充选项
      const hasActiveFinishedFilter = Object.values(targetFilters).some((v) => v !== "all")
      const filteredFinishedOptionReq = hasActiveFinishedFilter
        ? fetchFinishedMatches(settings.apiToken, 100, targetFilters)
        : Promise.resolve([] as Match[])

      const [filteredOptionData, filteredData] = await Promise.all([
        filteredFinishedOptionReq,
        fetchFinishedMatches(settings.apiToken, 100, targetFilters),
      ])

      const mergeUnique = (a: Match[], b: Match[]) => {
        const seen = new Set(a.map((m) => m.id))
        return [...a, ...b.filter((m) => !seen.has(m.id))]
      }
      const mergedOptionData = mergeUnique(baseFinished, filteredOptionData)

      setFinishedOptionMatches(mergedOptionData)
      setFinishedMatches(filteredData)
    } catch (e) {
      const message = `获取已结束比赛失败: ${String(e)}`
      console.log(message)
      setFinishedError(message)
      setFinishedMatches([])
    } finally {
      setFinishedLoading(false)
    }
  }

  useEffect(() => {
    loadFinishedData(finishedFilters)
  }, [settings.apiToken, finishedFilters.videogame, finishedFilters.league, finishedFilters.tournament, finishedFilters.team])

  const doUnsubscribe = async (match: Match) => {
    const next = toggleSubscription(subscriptions, match, settings.defaultNotifyMinutesBefore)
    setSubscriptions(next)
    saveSubscriptions(next)
    await cancelMatchNotification(match.id)
  }

  const handleToggleSub = async (match: Match) => {
    // 已订阅则先弹确认框,避免误触取消
    if (subscriptions.some((s) => s.matchId === match.id)) {
      setPendingCancelMatch(match)
      return
    }

    const next = toggleSubscription(subscriptions, match, settings.defaultNotifyMinutesBefore)
    setSubscriptions(next)
    saveSubscriptions(next)

    // 按设置调度:提前提醒(0 表示关闭)+ 开始提醒(若开启)
    await scheduleAdvanceNotification(match, settings.defaultNotifyMinutesBefore)
    if (settings.notifyAtStart) {
      await scheduleStartNotification(match)
    }
  }

  const handleFiltersChange = (nextFilters: MatchFilters) => {
    setFilters(nextFilters)
  }

  const handleSaveSettings = async (newSettings: Settings) => {
    const notifyMinutesChanged = newSettings.defaultNotifyMinutesBefore !== settings.defaultNotifyMinutesBefore
    const notifyAtStartChanged = newSettings.notifyAtStart !== settings.notifyAtStart
    const nextSubscriptions = notifyMinutesChanged
      ? updateSubscriptionsNotifyMinutesBefore(subscriptions, newSettings.defaultNotifyMinutesBefore)
      : subscriptions

    setOptionMatches([])
    setSettings(newSettings)
    saveSettings(newSettings)

    if (notifyMinutesChanged) {
      setSubscriptions(nextSubscriptions)
      saveSubscriptions(nextSubscriptions)
    }

    if (notifyMinutesChanged || notifyAtStartChanged) {
      const notificationMatches = Array.from(
        new Map([...optionMatches, ...matches].map((match) => [match.id, match])).values(),
      )
      await syncMatchNotifications(notificationMatches, nextSubscriptions, newSettings)
    }
  }

  const openSettingsTab = () => setTabIndex(3)

  return (
    <TabView
      tabIndex={tabIndex}
      onTabIndexChanged={(value: number) => setTabIndex(value)}
      alert={{
        title: "取消订阅",
        message: <Text>确定要取消该比赛的赛前提醒吗？取消后将不再收到通知。</Text>,
        isPresented: pendingCancelMatch !== null,
        onChanged: (presented: boolean) => {
          if (!presented) setPendingCancelMatch(null)
        },
        actions: (
          <>
            <Button title="取消" role="cancel" action={() => setPendingCancelMatch(null)} />
            <Button
              title="确定"
              role="destructive"
              action={() => {
                const match = pendingCancelMatch
                setPendingCancelMatch(null)
                if (match) doUnsubscribe(match)
              }}
            />
          </>
        ),
      }}
    >
      <ScheduleTab
        tabItem={<Label title="赛程" systemImage="calendar" />}
        tag={0}
        matches={matches}
        optionMatches={optionMatches}
        subscriptions={subscriptions}
        loading={loading}
        error={error}
        hasToken={!!settings.apiToken}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onToggleSub={handleToggleSub}
        onRefresh={() => loadMatchesData(filters)}
        onOpenSettings={openSettingsTab}
        onClose={dismissApp}
      />
      <FinishedTab
        tabItem={<Label title="已结束" systemImage="flag.checkered" />}
        tag={1}
        matches={finishedMatches}
        optionMatches={finishedOptionMatches}
        loading={finishedLoading}
        error={finishedError}
        hasToken={!!settings.apiToken}
        filters={finishedFilters}
        onFiltersChange={(nextFilters) => setFinishedFilters(nextFilters)}
        onRefresh={() => loadFinishedData(finishedFilters)}
        onOpenSettings={openSettingsTab}
        onClose={dismissApp}
      />
      <SubscriptionsTab
        tabItem={<Label title="订阅" systemImage="bell.fill" />}
        tag={2}
        matches={matches}
        subscriptions={subscriptions}
        onToggleSub={handleToggleSub}
        onRefresh={() => loadMatchesData(filters)}
        onClose={dismissApp}
      />
      <SettingsTab
        tabItem={<Label title="设置" systemImage="gearshape.fill" />}
        tag={3}
        settings={settings}
        usage={usage}
        onSave={handleSaveSettings}
        onClose={dismissApp}
      />
    </TabView>
  )
}

async function main() {
  await Navigation.present(<App />)
  Script.exit()
}

main()
