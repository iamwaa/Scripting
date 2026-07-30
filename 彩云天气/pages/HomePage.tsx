import {
  DragGesture,
  Navigation,
  NavigationStack,
  ProgressView,
  Text,
  VStack,
  ZStack,
  useCallback,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
} from "scripting"
import { PageIndicatorBar } from "../components/PageIndicatorBar"
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

export function HomePage({
  showsDismissButton = true,
}: {
  showsDismissButton?: boolean
}) {
  const dismiss = Navigation.useDismiss()
  const [currentPlace, setCurrentPlace] = useState<Place | null>(null)
  const [favorites, setFavorites] = useState<Place[]>(() => loadFavorites())
  const [tabsVersion, setTabsVersion] = useState(0)
  const [searchPresented, setSearchPresented] = useState(false)
  const [searchSession, setSearchSession] = useState(0)
  const pageSelection = useObservable(0)
  const returnToCurrentRef = useRef(false)
  // 各页面上报的实时 skycon（按地点 id 记录），供根层绘制当前页的全屏背景
  const [skyconMap, setSkyconMap] = useState<Record<string, SkyconCode | null>>({})

  const places: Place[] = (() => {
    const list = currentPlace ? [currentPlace, ...favorites] : [...favorites]
    const seen = new Set<string>()
    return list.filter(place => {
      if (seen.has(place.id)) return false
      seen.add(place.id)
      return true
    })
  })()

  // useCallback 固定引用：拖动跟手期间高频重渲染时不击穿下方 useMemo 的 WeatherPage 子树缓存
  const syncFavorites = useCallback(() => {
    setFavorites(loadFavorites())
  }, [])

  useEffect(() => {
    ; (async () => {
      try {
        setCurrentPlace(await getCurrentPlace(false))
      } catch {
        // 定位失败时仍可通过搜索和设置继续使用。
      }
    })()
  }, [])

  const handleLocate = async () => {
    // 直接换页不经过 animateToPage，需清掉可能残留的跟手偏移，避免新页卡在屏外
    dragOffsetRef.current = 0
    setDragOffsetX(0)
    pageSelection.setValue(0)
    setTabsVersion(version => version + 1)
    if (currentPlace) return
    try {
      setCurrentPlace(await getCurrentPlace(true))
    } catch {
      // 定位失败时保留当前页面。
    }
  }

  // 根层统一绘制全屏背景与工具栏/标题，跟随当前选中页
  const selectedIndex = Math.max(0, Math.min(pageSelection.value, places.length - 1))
  const selectedPlace = places.length > 0 ? places[selectedIndex] : null
  const selectedSkycon = selectedPlace ? skyconMap[selectedPlace.id] ?? null : null
  const selectedTitle = selectedPlace
    ? selectedPlace.isCurrent
      ? "当前位置"
      : placeDisplayName(selectedPlace)
    : ""
  const selectedPlaceId = selectedPlace?.id
  const handleCurrentSkyconLoaded = useCallback(
    (skycon: SkyconCode | null) => {
      if (!selectedPlaceId) return
      setSkyconMap(prev =>
        prev[selectedPlaceId] === skycon ? prev : { ...prev, [selectedPlaceId]: skycon }
      )
    },
    [selectedPlaceId]
  )
  const toolbar = createWeatherToolbar({
    onDismiss: showsDismissButton ? dismiss : undefined,
    onLocate: handleLocate,
    onSearch: () => setSearchPresented(true),
    settingsDestination: <SettingsPage onTokenSaved={() => { }} />,
  })

  // 翻页只使用 keyed view 的原生过渡，避免手动串行淡出/重建/淡入产生空档
  const [pageDirection, setPageDirection] = useState<1 | -1>(1)
  const animatingRef = useRef(false)
  const pageTransition = Transition.asymmetric(
    Transition.offset({ x: pageDirection * 40, y: 0 }).combined(Transition.opacity()),
    Transition.offset({ x: -pageDirection * 40, y: 0 }).combined(Transition.opacity())
  )
  // 跟手拖动期间页面容器的水平偏移；松手后飞出屏外或弹回归零。
  // ref 同步镜像最新值：手势闭包里的 state 可能是旧渲染快照，判断一律走 ref
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const dragOffsetRef = useRef(0)
  const updateDragOffset = (x: number) => {
    dragOffsetRef.current = x
    setDragOffsetX(x)
  }

  const animateToPage = async (index: number) => {
    if (animatingRef.current) return
    if (index < 0 || index >= places.length || index === selectedIndex) return
    animatingRef.current = true
    const direction: 1 | -1 = index > selectedIndex ? 1 : -1
    try {
      // 先提交方向，当前页保持不动；下一事件循环再同时插入新页、移除旧页
      setPageDirection(direction)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      if (dragOffsetRef.current !== 0) {
        // 跟手飞出：当前页沿手势方向滑出屏幕，衔接翻页过渡
        await withAnimation(Animation.easeOut(0.18), () => {
          updateDragOffset(-direction * Device.screen.width)
        })
      }
      // 偏移归零与换页同事务提交：旧页停在屏外播放移除过渡，新页从偏移 0 处插入
      await withAnimation(Animation.smooth({ duration: 0.24 }), "removed", () => {
        updateDragOffset(0)
        pageSelection.setValue(index)
      })
    } finally {
      animatingRef.current = false
    }
  }

  // 通过 ref 调用最新的 animateToPage，保持 selectPage 引用稳定（供下方 useMemo 缓存）
  const animateToPageRef = useRef(animateToPage)
  animateToPageRef.current = animateToPage
  const selectPage = useCallback((index: number) => {
    void animateToPageRef.current(index)
  }, [])

  // 页面未达标或手势转纵向时弹回居中
  const snapBackPage = () => {
    dragOffsetRef.current = 0
    void withAnimation(
      Animation.interactiveSpring({ response: 0.3, dampingFraction: 0.82 }),
      () => setDragOffsetX(0)
    )
  }

  // 横向滑动翻页：只有位移方向保持在 ±10° 内才锁定；锁定后页面跟手横移（只施加 x 偏移，
  // y 恒为 0），避免 simultaneousGesture 与 List 滚动叠加后产生可上下左右拖动的感觉
  const maxSwipeSlope = 0.1763
  const swipeLockRef = useRef<"none" | "horizontal" | "vertical">("none")
  // 锁定瞬间的 dx 作为跟手零点，避免锁定瞬间页面瞬移
  const swipeStartDxRef = useRef(0)
  const swipePager = DragGesture({ minDistance: 12, coordinateSpace: "global" })
    .onChanged(details => {
      if (animatingRef.current) return
      const dx = details.translation.width
      const dy = details.translation.height
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)
      if (swipeLockRef.current === "vertical") return
      if (swipeLockRef.current === "none") {
        // 位移还太小，等方向明确再锁（门槛 20pt，按住微动不误锁）
        if (Math.max(adx, ady) < 20) return
        if (ady <= adx * maxSwipeSlope) {
          swipeLockRef.current = "horizontal"
          swipeStartDxRef.current = dx
        } else {
          // 非正水平（含模糊带）一律视为滚动，本次手势不再干预
          swipeLockRef.current = "vertical"
          return
        }
      }
      // 锁定后允许少量方向抖动，明显偏离水平才交还给 List
      if (ady > 16 && ady > adx * 0.35) {
        swipeLockRef.current = "vertical"
        if (dragOffsetRef.current !== 0) snapBackPage()
        return
      }
      // 跟手横移；拖向无相邻页的一侧时加边缘阻尼
      const follow = dx - swipeStartDxRef.current
      const blocked =
        (follow < 0 && selectedIndex >= places.length - 1) ||
        (follow > 0 && selectedIndex <= 0)
      updateDragOffset(blocked ? follow * 0.35 : follow)
    })
    .onEnded(details => {
      const wasHorizontal = swipeLockRef.current === "horizontal"
      swipeLockRef.current = "none"
      if (!wasHorizontal) {
        // 动画进行中不干预，避免把正在飞出的页面拉回
        if (!animatingRef.current && dragOffsetRef.current !== 0) snapBackPage()
        return
      }
      if (animatingRef.current) return
      const predictedDx = details.predictedEndTranslation.width
      const actualDx = details.translation.width
      const actualDy = details.translation.height
      // 松手时再次按 ±10° 校验，避免先水平后斜向的手势误翻页
      const remainsHorizontal = Math.abs(actualDy) <= Math.abs(actualDx) * maxSwipeSlope
      const next = selectedIndex + (predictedDx < 0 ? 1 : -1)
      if (
        remainsHorizontal &&
        Math.abs(predictedDx) >= 72 &&
        next >= 0 &&
        next < places.length
      ) {
        void animateToPage(next)
      } else if (dragOffsetRef.current !== 0) {
        snapBackPage()
      }
    })

  // 缓存分页条与 WeatherPage 元素：跟手拖动每帧只重建容器并更新 offset，
  // 元素引用不变时子树跳过重渲染
  const pageIndicator = useMemo(
    () => (
      <PageIndicatorBar count={places.length} index={selectedIndex} onSelect={selectPage} />
    ),
    [places.length, selectedIndex, selectPage]
  )
  const weatherPageElement = useMemo(() => {
    if (!selectedPlace) return null
    return (
      <WeatherPage
        key={`${selectedPlace.id}__${tabsVersion}`}
        place={selectedPlace}
        onFavoritesChanged={syncFavorites}
        onSkyconLoaded={handleCurrentSkyconLoaded}
        bottomAccessory={pageIndicator}
      />
    )
  }, [selectedPlace, tabsVersion, syncFavorites, handleCurrentSkyconLoaded, pageIndicator])
  // 背景（含天气效果层）同样缓存，拖动期间不随偏移状态重渲染
  const backgroundElement = useMemo(
    () => <WeatherBackground skycon={selectedSkycon} />,
    [selectedSkycon]
  )

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
        simultaneousGesture={places.length > 1 ? swipePager : undefined}
        navigationDestination={{
          isPresented: searchPresented,
          onChanged: isPresented => {
            setSearchPresented(isPresented)
            if (!isPresented) {
              // 销毁本次搜索页状态；下次进入时关键词、结果、错误与详情预览均重新初始化
              setSearchSession(session => session + 1)
              syncFavorites()
              if (returnToCurrentRef.current) {
                returnToCurrentRef.current = false
                handleLocate()
              }
            }
          },
          content: (
            <SearchPage
              key={`search-${searchSession}`}
              onReturnToCurrent={() => {
                returnToCurrentRef.current = true
                setSearchPresented(false)
              }}
            />
          ),
        }}
      >
        {/* 背景根 Rectangle 保持同一实例，随翻页事务平滑更新渐变；天气效果层自行按类别重建 */}
        {backgroundElement}
        {weatherPageElement && selectedPlace ? (
          // keyed 容器在一次原生 Transition 中同时移除旧页、插入新页，避免串行动画空档；
          // offset 提供跟手横移，拖动期间 WeatherPage 子树凭元素引用缓存跳过重渲染
          <ZStack
            key={`${selectedPlace.id}__${tabsVersion}`}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            transition={pageTransition}
            offset={{ x: dragOffsetX, y: 0 }}
          >
            {weatherPageElement}
          </ZStack>
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
