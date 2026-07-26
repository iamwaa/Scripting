import {
  Button,
  ContentUnavailableView,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import { fetchWeather } from "../api/weather"
import {
  AlertsSection,
  DailySection,
  HourlySection,
  RainProbabilitySection,
  RealtimeCard,
  shouldShowRainProbability,
} from "../components/WeatherCards"
import { LifeIndexSection } from "../components/LifeIndexSection"
import { WeatherBackground } from "../components/WeatherBackground"
import { GlassBadge } from "../components/glass"
import { textColor, weatherCardProps, weatherListChrome } from "../components/tokens"
import {
  isFavorite,
  loadFavorites,
  loadLastPlace,
  mergeFavoriteMeta,
  saveLastPlace,
  toggleFavorite,
  updateFavoriteDisplayName,
} from "../services/favoritesService"
import { getCurrentPlace } from "../services/locationService"
import type { Place, WeatherResult } from "../types"
import { withDisplayName } from "../utils/place"
import { SearchPage } from "./SearchPage"
import { SettingsPage } from "./SettingsPage"

export function HomePage() {
  const dismiss = Navigation.useDismiss()
  const [place, setPlace] = useState<Place | null>(null)
  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [favorites, setFavorites] = useState<Place[]>(() => loadFavorites())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 始终指向最新地点，避免 present 回调闭包读到旧值
  const placeRef = useRef<Place | null>(null)

  const applyPlace = (next: Place) => {
    // 进入展示前合并收藏中的自定义显示名
    const merged = mergeFavoriteMeta(loadFavorites(), next)
    placeRef.current = merged
    setPlace(merged)
    saveLastPlace(merged)
    return merged
  }

  // asCurrent=true 仅用于定位；搜索/收藏选点必须 isCurrent=false
  const loadForPlace = async (
    next: Place,
    opts?: { silent?: boolean; asCurrent?: boolean }
  ) => {
    const target: Place = opts?.asCurrent
      ? { ...next, isCurrent: true }
      : { ...next, isCurrent: false }

    if (!opts?.silent) setLoading(true)
    setRefreshing(true)
    setError(null)
    // 先切换地点标题，避免仍显示旧「当前位置」
    applyPlace(target)
    try {
      const response = await fetchWeather({
        longitude: target.longitude,
        latitude: target.latitude,
      })
      // 请求返回后再次确认地点（防止并发请求写回旧地点）
      applyPlace(target)
      setWeather(response.result)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const loadCurrent = async (forceRequest = false) => {
    if (!forceRequest) setLoading(true)
    setRefreshing(true)
    setError(null)
    try {
      const current = await getCurrentPlace(forceRequest)
      await loadForPlace(current, { silent: true, asCurrent: true })
    } catch (e: any) {
      // 定位失败时回退上次地点
      const last = loadLastPlace()
      if (last) {
        try {
          await loadForPlace(last, {
            silent: true,
            asCurrent: Boolean(last.isCurrent),
          })
          setError(`定位失败，已显示上次地点：${e?.message ?? String(e)}`)
          return
        } catch {
          // ignore
        }
      }
      setError(e?.message ?? String(e))
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadCurrent(false)
  }, [])

  const openSearch = async () => {
    await Navigation.present({
      element: (
        <SearchPage
          onSelect={selected => {
            // 搜索/收藏点选：明确非当前位置
            loadForPlace(selected, { asCurrent: false })
          }}
        />
      ),
    })
    // 关闭后只同步收藏；基于 placeRef 合并显示名，绝不回写旧当前位置
    const latest = loadFavorites()
    setFavorites(latest)
    if (placeRef.current) {
      applyPlace(placeRef.current)
    }
  }

  const openSettings = async () => {
    await Navigation.present({
      element: (
        <SettingsPage
          onTokenSaved={() => {
            const current = placeRef.current
            if (current) {
              loadForPlace(current, {
                silent: true,
                asCurrent: Boolean(current.isCurrent),
              })
            }
          }}
        />
      ),
    })
  }

  const favorited = place ? isFavorite(favorites, place) : false

  const onToggleFavorite = () => {
    if (!place) return
    setFavorites(toggleFavorite(favorites, place))
  }

  // 仅收藏地点可改显示名；当前位置不支持
  const onEditDisplayName = async () => {
    if (!place || place.isCurrent || !isFavorite(favorites, place)) return
    const result = await Dialog.prompt({
      title: "设置显示名称",
      message: "仅对收藏地点生效，留空恢复原始地名",
      defaultValue: place.displayName ?? place.name,
      placeholder: place.name,
    })
    if (result == null) return

    const updated = withDisplayName(place, result)
    setPlace(updated)
    saveLastPlace(updated)
    setFavorites(updateFavoriteDisplayName(favorites, place, result))
  }

  return (
    <NavigationStack>
      {/* 与 SearchPage 相同：背景可扩到安全区外，List 仍走系统安全区 */}
      <ZStack alignment="top" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <WeatherBackground skycon={weather?.realtime?.skycon} />
        <List
          {...weatherListChrome}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          navigationTitle="彩云天气"
          navigationBarTitleDisplayMode="inline"
          refreshable={async () => {
            if (place?.isCurrent || !place) {
              await loadCurrent(true)
            } else if (place) {
              await loadForPlace(place, { silent: true })
            }
          }}
          toolbar={{
            topBarLeading: (
              <Button title="" systemImage="xmark" action={dismiss} />
            ),
            topBarTrailing: (
              <HStack spacing={14}>
                <Button
                  title=""
                  systemImage="location.fill"
                  action={() => loadCurrent(true)}
                />
                {place ? (
                  <Button
                    title=""
                    systemImage={favorited ? "star.fill" : "star"}
                    action={onToggleFavorite}
                  />
                ) : null}
                <Button title="" systemImage="magnifyingglass" action={openSearch} />
                <Button title="" systemImage="gearshape" action={openSettings} />
              </HStack>
            ),
          }}
          overlay={
            loading && !weather ? (
              <VStack spacing={12}>
                <ProgressView progressViewStyle="circular" controlSize="large" />
                <Text foregroundStyle={textColor.secondary}>正在获取天气…</Text>
              </VStack>
            ) : !loading && !weather && error ? (
              <ContentUnavailableView
                label={
                  <VStack spacing={8}>
                    <Image
                      systemName="exclamationmark.triangle"
                      font={36}
                      foregroundStyle="systemOrange"
                    />
                    <Text font="title3" fontWeight="semibold">
                      加载失败
                    </Text>
                  </VStack>
                }
                description={
                  <Text font="callout" foregroundStyle={textColor.secondary} multilineTextAlignment="center">
                    {error}
                  </Text>
                }
                actions={[
                  <Button title="重试" action={() => loadCurrent(true)} />,
                  <Button title="设置 Token" action={openSettings} />,
                ]}
              />
            ) : undefined
          }
        >
          {place && weather ? (
            <>
              {/* 提醒放最上方 */}
              {(weather.alert?.content?.length || weather.minutely?.description) ? (
                <Section>
                  <AlertsSection result={weather} />
                </Section>
              ) : null}

              {error ? (
                <Section>
                  <VStack alignment="leading" spacing={6} {...weatherCardProps}>
                    <GlassBadge style="warning">
                      <Text font={11} fontWeight="medium">
                        提示
                      </Text>
                    </GlassBadge>
                    <Text font="caption" foregroundStyle={textColor.secondary}>
                      {error}
                    </Text>
                  </VStack>
                </Section>
              ) : null}

              {/* 地点并入天气框；仅收藏地点显示铅笔改名 */}
              <Section>
                <RealtimeCard
                  place={place}
                  realtime={weather.realtime}
                  daily={weather.daily}
                  refreshing={refreshing}
                  onEditName={
                    !place.isCurrent && favorited ? onEditDisplayName : undefined
                  }
                />
              </Section>

              {shouldShowRainProbability(weather.realtime, weather.minutely) ? (
                <Section>
                  <RainProbabilitySection
                    realtime={weather.realtime}
                    minutely={weather.minutely}
                  />
                </Section>
              ) : null}

              {weather.hourly?.temperature?.length ? (
                <Section>
                  <HourlySection hourly={weather.hourly} />
                </Section>
              ) : null}

              {weather.daily?.temperature?.length ? (
                <Section>
                  <DailySection daily={weather.daily} />
                </Section>
              ) : null}

              {(weather.daily?.life_index || weather.realtime?.life_index) ? (
                <Section>
                  <LifeIndexSection realtime={weather.realtime} daily={weather.daily} />
                </Section>
              ) : null}
            </>
          ) : null}
        </List>
      </ZStack>
    </NavigationStack>
  )
}
