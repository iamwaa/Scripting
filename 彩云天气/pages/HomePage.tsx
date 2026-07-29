import {
  Navigation,
  NavigationStack,
  ProgressView,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { WeatherBackground } from "../components/WeatherBackground"
import { createWeatherToolbar } from "../components/WeatherToolbar"
import { textColor } from "../components/tokens"
import { loadFavorites } from "../services/favoritesService"
import { getCurrentPlace } from "../services/locationService"
import type { Place, SkyconCode } from "../types"
import { placeDisplayName } from "../utils/place"
import { SearchPage } from "./SearchPage"
import { SettingsPage } from "./SettingsPage"
import { WeatherPage } from "./WeatherPage"

function WeatherTabs({
  places,
  selection,
  onFavoritesChanged,
  onSkyconLoaded,
}: {
  places: Place[]
  selection: ReturnType<typeof useObservable<number>>
  onFavoritesChanged: () => void
  onSkyconLoaded: (placeId: string, skycon: SkyconCode | null) => void
}) {
  return (
    <TabView
      tabViewStyle="pageAutomaticDisplayIndex"
      selection={selection}
      ignoresSafeArea={{ edges: ["bottom"] }}
    >
      {places.map((place, index) => (
        <WeatherPage
          key={place.id}
          tag={index}
          place={place}
          onFavoritesChanged={onFavoritesChanged}
          onSkyconLoaded={skycon => onSkyconLoaded(place.id, skycon)}
        />
      ))}
    </TabView>
  )
}

export function HomePage() {
  const dismiss = Navigation.useDismiss()
  const [currentPlace, setCurrentPlace] = useState<Place | null>(null)
  const [favorites, setFavorites] = useState<Place[]>(() => loadFavorites())
  const [tabsVersion, setTabsVersion] = useState(0)
  const [searchPresented, setSearchPresented] = useState(false)
  const pageSelection = useObservable(0)
  const returnToCurrentRef = useRef(false)
  // 各 tab 上报的实时 skycon（按地点 id 记录），供根层绘制当前 tab 的全屏背景
  const [skyconMap, setSkyconMap] = useState<Record<string, SkyconCode | null>>({})

  const handleSkyconLoaded = (placeId: string, skycon: SkyconCode | null) => {
    setSkyconMap(prev => (prev[placeId] === skycon ? prev : { ...prev, [placeId]: skycon }))
  }

  const places: Place[] = (() => {
    const list = currentPlace ? [currentPlace, ...favorites] : [...favorites]
    const seen = new Set<string>()
    return list.filter(place => {
      if (seen.has(place.id)) return false
      seen.add(place.id)
      return true
    })
  })()

  const syncFavorites = () => {
    setFavorites(loadFavorites())
  }

  useEffect(() => {
    ;(async () => {
      try {
        setCurrentPlace(await getCurrentPlace(false))
      } catch {
        // 定位失败时仍可通过搜索和设置继续使用。
      }
    })()
  }, [])

  const handleLocate = async () => {
    pageSelection.setValue(0)
    setTabsVersion(version => version + 1)
    if (currentPlace) return
    try {
      setCurrentPlace(await getCurrentPlace(true))
    } catch {
      // 定位失败时保留当前页面。
    }
  }

  const tabsKey = `${places.map(place => place.id).join("|")}__${tabsVersion}`
  // 根层统一绘制全屏背景与工具栏/标题，跟随当前选中 tab
  const selectedIndex = Math.max(0, Math.min(pageSelection.value, places.length - 1))
  const selectedPlace = places.length > 0 ? places[selectedIndex] : null
  const selectedSkycon = selectedPlace ? skyconMap[selectedPlace.id] ?? null : null
  const selectedTitle = selectedPlace
    ? selectedPlace.isCurrent
      ? "当前位置"
      : placeDisplayName(selectedPlace)
    : ""
  const toolbar = createWeatherToolbar({
    onDismiss: dismiss,
    onLocate: handleLocate,
    onSearch: () => setSearchPresented(true),
    settingsDestination: <SettingsPage onTokenSaved={() => {}} />,
  })

  return (
    <NavigationStack>
      <ZStack
        alignment="top"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        // 背景 Rectangle 自带 ignoresSafeArea 铺满全屏（含状态栏/导航栏区域）；
        // ZStack 本身遵守安全区，List 内容才会正常内缩到导航栏下方，不顶进导航栏
        navigationTitle={selectedTitle}
        navigationBarTitleDisplayMode="inline"
        toolbar={toolbar}
        navigationDestination={{
          isPresented: searchPresented,
          onChanged: isPresented => {
            setSearchPresented(isPresented)
            if (!isPresented) {
              syncFavorites()
              if (returnToCurrentRef.current) {
                returnToCurrentRef.current = false
                handleLocate()
              }
            }
          },
          content: (
            <SearchPage
              onReturnToCurrent={() => {
                returnToCurrentRef.current = true
                setSearchPresented(false)
              }}
            />
          ),
        }}
      >
        {/* 根层唯一全屏背景：Rectangle 自带 ignoresSafeArea 铺满全屏，跟随当前选中 tab 的 skycon
            渲染动态天气效果。各内嵌分页页透明、不再自绘背景，从根本上消除顶部接缝与色差空隙 */}
        <WeatherBackground key={selectedSkycon ?? "fallback"} skycon={selectedSkycon} />
        {places.length > 0 ? (
          <WeatherTabs
            key={tabsKey}
            places={places}
            selection={pageSelection}
            onFavoritesChanged={syncFavorites}
            onSkyconLoaded={handleSkyconLoaded}
          />
        ) : (
          <VStack
            spacing={12}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          >
            <ProgressView progressViewStyle="circular" controlSize="large" />
            <Text foregroundStyle={textColor.secondary}>正在获取位置…</Text>
          </VStack>
        )}
      </ZStack>
    </NavigationStack>
  )
}
