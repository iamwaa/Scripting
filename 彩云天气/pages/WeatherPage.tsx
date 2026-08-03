/**
 * WeatherPage — 单个地点的完整天气页
 * 接收一个 Place，独立发起天气请求并渲染天气卡片列表。
 * 样式与 SearchPage 同构：ZStack > 背景(ignoresSafeArea) + List(navigationTitle/toolbar)
 */
import {
  Button,
  ContentUnavailableView,
  Image,
  List,
  ProgressView,
  Section,
  Text,
  VStack,
  ZStack,
  useEffect,
  useRef,
  useState,
  type VirtualNode,
} from "scripting"
import { fetchWeather, peekCachedWeather } from "../api/weather"
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
import {
  textColor,
  weatherCardProps,
  weatherListChrome,
} from "../components/tokens"
import {
  isFavorite,
  loadFavorites,
  toggleFavorite as toggleFav,
} from "../services/favoritesService"
import type { Place, SkyconCode, WeatherResult } from "../types"
import { placeDisplayName } from "../utils/place"

export function WeatherPage({
  place,
  onFavoritesChanged,
  onBack,
  onLocate,
  onSkyconLoaded,
  toolbarMode = "home",
  bottomAccessory,
  refreshToken = 0,
}: {
  place: Place
  onFavoritesChanged?: () => void
  onBack?: () => void
  onLocate?: () => void
  // 天气加载后上报 skycon，供根层绘制当前 tab 的全屏背景
  onSkyconLoaded?: (skycon: SkyconCode | null) => void
  toolbarMode?: "home" | "detail"
  // 首页内嵌模式：挂在 List 底部 safeAreaInset 的分页条（内容自动避开）
  bottomAccessory?: VirtualNode
  // 外部刷新信号：数值变化时强制跳过缓存重新拉取（右上角刷新按钮）
  refreshToken?: number
}) {
  // 首帧直出缓存：单实例分页下切回已看过的地点不闪 loading
  const [initialWeather] = useState(
    () => peekCachedWeather({ longitude: place.longitude, latitude: place.latitude })?.result ?? null
  )
  const [weather, setWeather] = useState<WeatherResult | null>(initialWeather)
  const [loading, setLoading] = useState(initialWeather == null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadWeather = async (force = false) => {
    setLoading(true)
    setRefreshing(true)
    setError(null)
    try {
      const response = await fetchWeather({
        longitude: place.longitude,
        latitude: place.latitude,
        force,
      })
      setWeather(response.result)
      onSkyconLoaded?.(response.result.realtime?.skycon ?? null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      onSkyconLoaded?.(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // 外部刷新信号：仅在数值真正变化时强制刷新；挂载/重建（含翻页切换地点）时不误触发
  const prevRefreshTokenRef = useRef(refreshToken)
  useEffect(() => {
    if (refreshToken !== prevRefreshTokenRef.current) {
      prevRefreshTokenRef.current = refreshToken
      if (refreshToken > 0) void loadWeather(true)
    }
  }, [refreshToken])

  // 地点切换时重新加载；缓存首帧先上报 skycon，背景同步不闪回退渐变
  useEffect(() => {
    if (initialWeather) {
      onSkyconLoaded?.(initialWeather.realtime?.skycon ?? null)
    }
    loadWeather()
  }, [place.id])

  // 当前位置标题直接显示"当前位置"，与收藏地点区分
  const title = place.isCurrent ? "当前位置" : placeDisplayName(place)
  const favorites = loadFavorites()
  const favorited = isFavorite(favorites, place)

  // 收藏切换
  const onToggleFavorite = async () => {
    if (isFavorite(favorites, place)) {
      const ok = await Dialog.confirm({
        title: "取消收藏",
        message: `确定取消收藏「${placeDisplayName(place)}」吗？`,
      })
      if (ok !== true) return
    }
    // 直接写 Storage 并通知父组件刷新
    toggleFav(favorites, place)
    onFavoritesChanged?.()
  }

  const overlay =
    loading && !weather ? (
      <VStack
        spacing={12}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
      >
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
            <Text font={20} fontWeight="semibold">
              加载失败
            </Text>
          </VStack>
        }
        description={
          <Text font={16} foregroundStyle={textColor.secondary} multilineTextAlignment="center">
            {error}
          </Text>
        }
        actions={[<Button title="重试" action={() => loadWeather()} />]}
      />
    ) : undefined

  const content = weather ? (
    <>
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
            <Text font={13} foregroundStyle={textColor.secondary}>
              {error}
            </Text>
          </VStack>
        </Section>
      ) : null}

      <Section>
        <RealtimeCard
          place={place}
          realtime={weather.realtime}
          daily={weather.daily}
          refreshing={refreshing}
          favorited={favorited}
          onToggleFavorite={onToggleFavorite}
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
  ) : null

  // 首页内嵌模式：背景与工具栏/标题由根层统一负责，这里只画透明 List，
  // 避免相邻分页各自向同一系统导航栏挂 toolbar，造成滑动时工具栏错乱（双份按钮）。
  // 天气列表不开下拉刷新：进入与切换地点时自动加载，60s 缓存避免重复请求
  if (toolbarMode !== "detail") {
    return (
      <List
        {...weatherListChrome}
        overlay={overlay}
        safeAreaInset={
          bottomAccessory
            ? { bottom: { alignment: "center" as const, content: bottomAccessory } }
            : undefined
        }
      >
        {content}
      </List>
    )
  }

  // 搜索详情模式：自绘全屏背景 + 右上角仅"当前位置"按钮
  return (
    <ZStack alignment="top" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <WeatherBackground skycon={weather?.realtime?.skycon} />
      <List
        {...weatherListChrome}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        navigationBarBackButtonHidden={onBack != null}
        overlay={overlay}
        toolbar={{
          topBarLeading: onBack ? (
            <Button title="返回" systemImage="chevron.left" action={onBack} />
          ) : undefined,
          topBarTrailing: onLocate ? (
            <Button title="当前位置" systemImage="location.fill" action={onLocate} />
          ) : undefined,
        }}
      >
        {content}
      </List>
    </ZStack>
  )
}
