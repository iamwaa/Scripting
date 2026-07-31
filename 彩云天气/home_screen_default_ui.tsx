/**
 * home_screen_default_ui.tsx — App 首页 Tab 的精简天气首页
 *
 * 与 index.tsx / HomePage 的分工：
 * - index.tsx：Navigation.present(<HomePage />) 全屏弹出，支持多地点跟手翻页；dismiss 后 Script.exit()。
 * - 本文件：占据 App 首页一个常驻 Tab，只读展示「单个地点」的天气概览，复用 WeatherPage 内嵌（home）模式。
 *
 * Home Tab 能力约束（见文档 Home Screen UI）：
 * - 默认导出函数组件；直接 return 视图，不要 Navigation.present。
 * - 不要 Script.exit()：Tab 常驻，退出会让界面卡死需 Reload。
 * - 顶层代码只在 Tab 首次构建时运行一次，状态在切 Tab 间保留。
 *
 * 地点与收藏：
 * - 初始地点取 loadLastPlace() 作缓存兜底；进入 Tab 无条件定位一次并刷新，失败回退 lastPlace / 首个收藏。
 * - 地址切换在导航栏左上：Menu 列出当前位置 + 收藏列表，点选切换并 saveLastPlace；
 *   点「当前位置」等同重新定位刷新。收藏的增删/重命名/排序仍在主 App 搜索页，
 *   星标收藏/取消收藏经 onFavoritesChanged 实时同步到 Menu。
 * - toolbar 经 WeatherPage 可选 prop 透传；本 Tab 独占导航栏，无 HomePage 双份按钮问题。
 */
import {
  Button,
  ContentUnavailableView,
  HStack,
  Image,
  List,
  Menu,
  NavigationStack,
  ProgressView,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import { WeatherBackground } from "./components/WeatherBackground"
import { textColor, weatherListChrome } from "./components/tokens"
import { WeatherPage } from "./pages/WeatherPage"
import { loadFavorites, loadLastPlace, saveLastPlace } from "./services/favoritesService"
import { getCurrentPlace } from "./services/locationService"
import { hasApiToken } from "./services/settingsService"
import type { Place, SkyconCode } from "./types"
import { placeDisplayName } from "./utils/place"

export default function HomeScreenTab() {
  // 初始地点先取最近查看/定位的地点作缓存兜底；进入时会无条件重新定位
  const [place, setPlace] = useState<Place | null>(() => loadLastPlace())
  // 独立记录当前位置：切到收藏后「当前位置」菜单项仍可一键回切（与 HomePage 的 currentPlace 同构）
  const [currentPlace, setCurrentPlace] = useState<Place | null>(() => {
    const last = loadLastPlace()
    return last?.isCurrent ? last : null
  })
  // 无历史地点时一进入就处于定位中，直接显示转圈；有历史地点则先直出再静默定位
  const [locating, setLocating] = useState(() => loadLastPlace() == null)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Place[]>(() => loadFavorites())
  // 当前展示地点的实时 skycon，驱动根层全屏背景
  const [skycon, setSkycon] = useState<SkyconCode | null>(null)

  // WeatherPage 星标收藏/取消收藏后同步菜单列表
  const syncFavorites = () => setFavorites(loadFavorites())

  // 定位到当前位置：成功后写入 lastPlace 并切换；无历史且定位失败时回退首个收藏
  const locate = async () => {
    setLocating(true)
    setLocateError(null)
    try {
      const current = await getCurrentPlace(true)
      setCurrentPlace(current)
      saveLastPlace(current)
      setPlace(current)
    } catch (e: any) {
      setLocateError(e?.message ?? String(e))
      if (!place) {
        const first = loadFavorites()[0]
        if (first) setPlace(first)
      }
    } finally {
      setLocating(false)
    }
  }

  // 点选菜单项：当前位置等同重新定位刷新；收藏地点切换展示并记录为最近查看
  const selectPlace = (target: Place) => {
    if (target.isCurrent) {
      locate()
      return
    }
    saveLastPlace(target)
    setPlace(target)
  }

  // 进入 Tab 无条件定位一次：拿到当前位置即 saveLastPlace 并切换，
  // WeatherPage 随之用新坐标重新拉取天气（60s 缓存兜底，非缓存内即为新数据）。
  useEffect(() => {
    locate()
  }, [])

  // 菜单项列表：当前位置在前，收藏在后，按坐标 id 去重（当前位置被收藏时不重复出现）
  const menuPlaces: Place[] = (() => {
    const list = currentPlace ? [currentPlace, ...favorites] : [...favorites]
    const seen = new Set<string>()
    return list.filter(p => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
  })()

  // 有地点：自绘全屏背景 + WeatherPage 内嵌模式（透明 List），导航栏左上 Menu 切换地址
  if (place) {
    // 导航栏左上地址切换菜单：label 显示当前地点名，项内勾选当前选中项
    const placeMenu = (
      <Menu
        label={
          <HStack spacing={4}>
            <Image
              systemName={place.isCurrent ? "location.fill" : "mappin.and.ellipse"}
              font={13}
              foregroundStyle="systemBlue"
            />
            <Text font={16} fontWeight="semibold" foregroundStyle={textColor.primary} lineLimit={1}>
              {place.isCurrent ? "当前位置" : placeDisplayName(place)}
            </Text>
            <Image
              systemName="chevron.up.chevron.down"
              font={10}
              foregroundStyle={textColor.tertiary}
            />
          </HStack>
        }
      >
        {menuPlaces.map(p => (
          <Button
            key={p.id}
            title={p.isCurrent ? "当前位置" : placeDisplayName(p)}
            systemImage={
              p.id === place.id ? "checkmark" : p.isCurrent ? "location.fill" : ""
            }
            action={() => selectPlace(p)}
          />
        ))}
      </Menu>
    )

    return (
      <NavigationStack>
        {/* toolbar 挂在不带 key 的 ZStack 上：跨地点切换身份稳定，只更新内容；
            若挂进 key={place.id} 的 WeatherPage 子树，切换时旧项清理不掉会叠出双份 */}
        <ZStack
          alignment="top"
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          toolbar={
            <Toolbar>
              <ToolbarItem placement="topBarLeading">{placeMenu}</ToolbarItem>
            </Toolbar>
          }
        >
          <WeatherBackground skycon={skycon} />
          <WeatherPage
            // key 强制按地点重建：切地点时首帧 peek 缓存直出，避免新旧地点数据串帧
            key={place.id}
            place={place}
            toolbarMode="home"
            onSkyconLoaded={setSkycon}
            onFavoritesChanged={syncFavorites}
          />
        </ZStack>
      </NavigationStack>
    )
  }

  // 空态 / 定位中 / 定位失败：自绘时段渐变背景 + 居中提示
  const overlay = locating ? (
    <VStack spacing={12}>
      <ProgressView progressViewStyle="circular" controlSize="large" />
      <Text foregroundStyle="secondaryLabel">正在定位…</Text>
    </VStack>
  ) : (
    <ContentUnavailableView
      label={
        <VStack spacing={8}>
          <Image
            systemName={locateError ? "location.slash" : "location.circle"}
            font={36}
            foregroundStyle="systemOrange"
          />
          <Text font={20} fontWeight="semibold">
            {locateError ? "定位失败" : "暂无地点"}
          </Text>
        </VStack>
      }
      description={
        <Text font={16} foregroundStyle="secondaryLabel" multilineTextAlignment="center">
          {locateError ??
            (hasApiToken()
              ? "点击下方按钮定位到当前位置"
              : "打开彩云天气，在设置中填写 API Token 后再定位")}
        </Text>
      }
      actions={[
        <Button title="定位当前位置" systemImage="location.fill" action={locate} />,
      ]}
    />
  )

  return (
    <NavigationStack>
      <ZStack alignment="top" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <WeatherBackground skycon={null} />
        <List
          {...weatherListChrome}
          navigationTitle="彩云天气"
          navigationBarTitleDisplayMode="inline"
          overlay={overlay}
        />
      </ZStack>
    </NavigationStack>
  )
}
