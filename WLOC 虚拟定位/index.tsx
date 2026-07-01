// WLOC 虚拟定位控制面板 — 入口
// 在地图上选取坐标，通过设备代理模块写入虚拟定位。
//
// 坐标显示和操作按钮在 App 层渲染（与 Map 平级），避免 Map 的 SwiftUI 渲染隔离。

import {
  Script,
  Navigation,
  useObservable,
  useState,
  useEffect,
  ZStack,
  VStack,
  HStack,
  Text,
  Spacer,
  RoundedRectangle,
  Image,
  Button,
  type VirtualNode,
  type Color,
} from "scripting"
import type { AppSettings, Coordinate, FavoriteLocation, ActiveLocation, MapLayerId } from "./types"
import {
  loadFavorites,
  addFavorite,
  removeFavorite,
  clearFavorites,
  loadSettings,
  saveSettings,
} from "./utils/storage"
import { MapPage } from "./pages/MapPage"
import { SettingsPage } from "./pages/SettingsPage"
import { FavoritesPage } from "./pages/FavoritesPage"
import { parseAndConvert } from "./utils/coords"

declare const Dialog: any

type SheetKind = "settings" | "favorites" | null

function App() {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [favorites, setFavorites] = useState<FavoriteLocation[]>(() => loadFavorites())

  // 当前选点（来自搜索/链接解析/收藏），供 MapPage 监听并跳转
  const pendingCoord = useObservable<Coordinate | null>(null)

  // ====== 坐标状态（App 层管理） ======
  const coordLat = useObservable(0)
  const coordLng = useObservable(0)
  const coordReady = useObservable(false)
  const activeLoc = useObservable<ActiveLocation | null>(null)

  // ====== 图层状态（App 层管理） ======
  const layer = useObservable<MapLayerId>(settings.defaultLayer)

  const sheetKind = useObservable<SheetKind>(null)
  const showSheet = useObservable(false)

  const toastMsg = useObservable("")
  const showToast = useObservable(false)

  const errorMsg = useObservable("")
  const showError = useObservable(false)

  // POI 搜索结果（使用 MapKit 搜索）
  const poiResults = useObservable<{ id: string; name: string; coordinate: Coordinate }[]>([])

  // 启动提示
  useEffect(() => {
    const t = setTimeout(() => {
      fireToast("放置标点后点击「搜索标点附近 POI」；国外直接点击地图标注点选点")
    }, 1200)
    return () => clearTimeout(t)
  }, [])

  function fireToast(msg: string) {
    toastMsg.setValue(msg)
    showToast.setValue(true)
  }

  function showErrorAlert(msg: string) {
    errorMsg.setValue(msg)
    showError.setValue(true)
  }

  function openSheet(kind: SheetKind) {
    sheetKind.setValue(kind)
    showSheet.setValue(true)
  }

  function closeSheet() {
    showSheet.setValue(false)
    setTimeout(() => sheetKind.setValue(null), 200)
  }

  function handleCloseApp() {
    dismiss()
  }

  function cycleLayer() {
    const layers: MapLayerId[] = ["standard", "imagery", "hybrid"]
    const idx = layers.indexOf(layer.value)
    layer.setValue(layers[(idx + 1) % layers.length])
  }

  function layerIcon(id: MapLayerId): string {
    switch (id) {
      case "imagery": return "globe.europe.africa.fill"
      case "hybrid": return "map.fill"
      case "standard":
      default: return "map"
    }
  }

  // 选点：用户事件处理器内直接更新坐标 observable → 保证 UI 刷新
  function handlePick(coord: Coordinate) {
    coordLat.setValue(coord.latitude)
    coordLng.setValue(coord.longitude)
    coordReady.setValue(true)
    pendingCoord.setValue(coord)
    closeSheet()
    fireToast("已定位到该坐标")
  }

  // 手势平移后 MapPage 通过此回调上报坐标变化
  function handleCoordChange(lat: number, lng: number) {
    coordLat.setValue(lat)
    coordLng.setValue(lng)
    coordReady.setValue(true)
  }

  // MapPage 启动后上报设备生效坐标
  function handleActiveLocChange(loc: ActiveLocation | null) {
    activeLoc.setValue(loc)
  }

  async function handleAddFavorite(coord: Coordinate) {
    const name = await Dialog.prompt({
      title: "收藏此位置",
      message: `经度 ${coord.longitude.toFixed(6)}  纬度 ${coord.latitude.toFixed(6)}`,
      defaultValue: "我的收藏",
      placeholder: "备注名称（如：公司、家）",
      selectAll: true,
      confirmLabel: "保存",
      cancelLabel: "取消",
    })
    if (name == null) return
    const trimmed = name.trim()
    if (trimmed) {
      const list = addFavorite(trimmed, coord.latitude, coord.longitude)
      setFavorites(list)
      fireToast(`已收藏：${trimmed}`)
    }
  }

  async function handleLinkParse() {
    const rawUrl = await Dialog.prompt({
      title: "解析地图链接或坐标",
      message: "支持 苹果/Google/高德/百度 地图链接或经纬度文本。高德坐标会自动转为 WGS-84。",
      placeholder: "在此粘贴地图链接或经纬度",
      selectAll: true,
      confirmLabel: "解析并定位",
      cancelLabel: "取消",
    })
    if (rawUrl == null) return
    const trimmed = rawUrl.trim()
    if (!trimmed) return
    try {
      const result = await parseAndConvert(trimmed)
      handlePick({ latitude: result.latitude, longitude: result.longitude })
      fireToast(result.name ? `已定位到：${result.name}` : "已成功定位")
    } catch (e) {
      await Dialog.alert({
        title: "解析失败",
        message: e instanceof Error ? e.message : String(e),
        buttonLabel: "好",
      })
    }
  }

  async function handlePickFromMap() {
    try {
      const picked = await Location.pickFromMap()
      if (picked) {
        handlePick({ latitude: picked.latitude, longitude: picked.longitude })
      }
    } catch (e) {
      showErrorAlert(`选点失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleCurrentLocation() {
    try {
      const gps = await Location.requestCurrent({ forceRequest: true })
      if (gps) {
        handlePick({ latitude: gps.latitude, longitude: gps.longitude })
        fireToast("已定位到当前位置")
      }
    } catch (e) {
      showErrorAlert(`定位失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 搜索标点附近 POI（仅中国大陆区域，国外直接点击地图 POI）
  async function handleSearchNearPin() {
    // 使用标点坐标作为搜索中心
    const center: Coordinate = { latitude: coordLat.value, longitude: coordLng.value }

    // 坐标未就绪时提示
    if (center.latitude === 0 && center.longitude === 0) {
      fireToast("请先在地图上放置标点")
      return
    }

    // 国外区域：提示直接点击地图上的 POI
    const isChina = center.longitude >= 72.004 && center.longitude <= 137.8347 && center.latitude >= 0.8293 && center.latitude <= 55.8271
    if (!isChina) {
      fireToast("国外区域请直接点击地图上的 POI 标注点选点")
      return
    }

    try {
      fireToast("正在搜索标点附近 POI...")

      const region = {
        center: { latitude: center.latitude, longitude: center.longitude },
        span: { latitudeDelta: 0.01, longitudeDelta: 0.01 }
      }

      // 多关键词并发搜索，覆盖更多 POI
      const keywords = ["餐厅", "超市", "酒店", "加油站", "银行", "医院"]
      const searchPromises = keywords.map((query) =>
        MapSearch.locate({ query, region, resultTypes: ["pointOfInterest"] }).catch(() => [] as any[])
      )
      const allResults = await Promise.all(searchPromises)

      // 合并去重（基于名称+坐标接近度）
      const seen = new Set<string>()
      const uniqueItems: any[] = []
      for (const items of allResults) {
        for (const item of items) {
          const key = `${item.name}_${Math.round(item.coordinate.latitude * 1000)}_${Math.round(item.coordinate.longitude * 1000)}`
          if (!seen.has(key)) {
            seen.add(key)
            uniqueItems.push(item)
          }
        }
      }

      // 转换为统一格式
      const results = uniqueItems.map((item, index) => ({
        id: `poi-${index}`,
        name: item.name || "未知地点",
        coordinate: {
          latitude: item.coordinate.latitude,
          longitude: item.coordinate.longitude
        }
      }))

      if (results.length === 0) {
        fireToast("标点附近未找到 POI，请尝试移动标点")
        return
      }

      poiResults.setValue(results)
      fireToast(`找到 ${results.length} 个 POI 点位`)
    } catch (e) {
      console.error("搜索失败:", e)
      fireToast("搜索失败，请稍后重试")
    }
  }

  // 清空 POI 搜索结果
  function handleClearPoi() {
    poiResults.setValue([])
  }

  function handleSaveSettings(next: AppSettings) {
    setSettings(next)
    saveSettings(next)
    closeSheet()
    fireToast("设置已保存")
  }

  function handleSettingsChange(next: AppSettings) {
    setSettings(next)
    saveSettings(next)
  }

  function handleDeleteFav(id: string) {
    const list = removeFavorite(id)
    setFavorites(list)
    fireToast("已删除")
  }

  function handleClearAllFav() {
    clearFavorites()
    setFavorites([])
    fireToast("已清空收藏")
  }

  function isCurrentCoordFavorited(): boolean {
    if (!coordReady.value) return false
    return favorites.some(
      (f) =>
        Math.abs(f.latitude - coordLat.value) < 1e-6 &&
        Math.abs(f.longitude - coordLng.value) < 1e-6
    )
  }

  async function handleRemoveCurrentFavorite() {
    const fav = favorites.find(
      (f) =>
        Math.abs(f.latitude - coordLat.value) < 1e-6 &&
        Math.abs(f.longitude - coordLng.value) < 1e-6
    )
    if (!fav) return

    const index = await Dialog.actionSheet({
      title: "取消收藏",
      message: `确定取消收藏「${fav.name}」？`,
      actions: [
        { label: "取消" },
        { label: "确定取消", destructive: true },
      ],
      cancelButton: false,
    })
    if (index === 1) {
      handleDeleteFav(fav.id)
    }
  }

  async function handleSave() {
    try {
      const { saveToDevice } = await import("./api/deviceApi")
      const loc = await saveToDevice(settings.saveApi, coordLat.value, coordLng.value, settings.accuracy)
      activeLoc.setValue(loc)
      fireToast("✓ 坐标已写入设备，下次定位生效")
    } catch (e) {
      showErrorAlert(`储存失败：${e instanceof Error ? e.message : String(e)}\n请检查 WLOC 模块配置`)
    }
  }

  async function handleClear() {
    try {
      const { clearDevice } = await import("./api/deviceApi")
      await clearDevice(settings.saveApi)
      activeLoc.setValue(null)
      fireToast("已清除设备坐标")
    } catch (e) {
      showErrorAlert(`清除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function buildSheetContent(kind: SheetKind): VirtualNode | null {
    switch (kind) {
      case "settings":
        return <SettingsPage settings={settings} onSave={handleSaveSettings} onSettingsChange={handleSettingsChange} />
      case "favorites":
        return (
          <FavoritesPage
            favorites={favorites}
            active={activeLoc.value}
            onPick={(coord: Coordinate) => handlePick(coord)}
            onDelete={handleDeleteFav}
            onClearAll={handleClearAllFav}
          />
        )
      default:
        return null
    }
  }

  const sheetContent = buildSheetContent(sheetKind.value)
  const loc = activeLoc.value

  // 统一顶部悬浮按钮样式
  const topBtnSize = 24
  const topBtnPadding = 9
  const topBtnRadius = (topBtnSize + topBtnPadding * 2) / 2

  function topBtn(icon: string, tint: Color, action: () => void) {
    return (
      <Button action={action}>
        <Image
          systemName={icon}
          foregroundStyle={tint}
          frame={{ width: topBtnSize, height: topBtnSize }}
          padding={topBtnPadding}
          background={<RoundedRectangle cornerRadius={topBtnRadius} fill="secondarySystemBackground" />}
          shadow={{ color: "rgba(0,0,0,0.08)", radius: 4, y: 2 }}
        />
      </Button>
    )
  }

  return (
    <ZStack
      sheet={
        sheetKind.value && sheetContent
          ? { content: sheetContent, isPresented: showSheet }
          : undefined
      }
      alert={{
        title: "提示",
        message: <Text>{errorMsg.value}</Text>,
        actions: <Button title="好" action={() => showError.setValue(false)} />,
        isPresented: showError,
      }}
      toast={
        toastMsg.value
          ? { message: toastMsg.value, isPresented: showToast, position: "top", duration: 2.5 }
          : undefined
      }
    >
      {/* 地图（不再包含顶部工具栏） */}
      <MapPage
        settings={settings}
        pendingCoord={pendingCoord}
        coordLat={coordLat}
        coordLng={coordLng}
        layer={layer}
        onCycleLayer={cycleLayer}
        onCoordChange={handleCoordChange}
        onActiveLocChange={handleActiveLocChange}
        poiResults={poiResults}
        onPoiSelect={(poi) => handlePick(poi.coordinate)}
      />

      {/* 顶部统一工具栏 */}
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="leading">
        {/* 第一行：左侧 + 右侧水平对齐 */}
        <HStack spacing={8} padding={{ top: 12, leading: 16, trailing: 16 }}>
          {/* 左侧：关闭 + 图层切换 */}
          {topBtn("xmark", "systemRed", handleCloseApp)}
          {topBtn(layerIcon(layer.value), "label", cycleLayer)}
          <Spacer />
          {/* 右侧：选点 + 解析 + 收藏 + 设置 */}
          {topBtn("mappin.and.ellipse", "label", handlePickFromMap)}
          {topBtn("link", "label", handleLinkParse)}
          {topBtn(favorites.length > 0 ? "star.fill" : "star", favorites.length > 0 ? "systemYellow" : "label", () => openSheet("favorites"))}
          {topBtn("gearshape", "label", () => openSheet("settings"))}
        </HStack>
        {/* 第二行：当前定位按钮（右对齐） */}
        <HStack frame={{ maxWidth: "infinity" }} padding={{ trailing: 16 }}>
          <Spacer />
          {topBtn("location", "systemBlue", handleCurrentLocation)}
        </HStack>
        <Spacer />
      </VStack>

      {/* 底部坐标面板（圆角悬浮框） */}
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="leading" padding={{ leading: 16, trailing: 16, bottom: 0 }}>
        <Spacer />

        {/* 搜索标点附近 POI 按钮（白色胶囊样式） */}
        <HStack frame={{ maxWidth: "infinity" }} padding={{ bottom: 4 }} alignment="center">
          <Button action={handleSearchNearPin} frame={{ maxWidth: 180 }} background={{ style: "systemBackground", shape: "capsule" }} tint="label">
            <HStack spacing={6} padding={{ vertical: 10, leading: 16, trailing: 20 }} frame={{ maxWidth: "infinity" }} alignment="center">
              <Image systemName="magnifyingglass" foregroundStyle="label" font="subheadline" />
              <Text font="subheadline" fontWeight="medium" foregroundStyle="label">搜索标点附近 POI</Text>
            </HStack>
          </Button>
        </HStack>

        <VStack
          alignment="leading"
          spacing={12}
          padding={{ top: 16, bottom: 16, leading: 16, trailing: 16 }}
          frame={{ maxWidth: "infinity" }}
          background={
            <RoundedRectangle cornerRadius={24} fill="systemBackground" />
          }
          shadow={{ color: "rgba(0,0,0,0.15)", radius: 20, y: -5 }}
          clipShape={{ type: "rect", cornerRadius: 24 }}
        >
          {/* 第1行：当前坐标标题 */}
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Image systemName="mappin.and.ellipse" foregroundStyle="systemRed" font="subheadline" />
            <Text font="headline" foregroundStyle="label">
              当前坐标
            </Text>
          </HStack>

          {/* 第2行：坐标数据 */}
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {coordReady.value
                ? `经度 ${coordLng.value.toFixed(6)}  纬度 ${coordLat.value.toFixed(6)}`
                : "请通过选点或地图移动来选择坐标"}
            </Text>
          </HStack>

          {/* 第3行：功能按钮（胶囊样式） */}
          <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
            <Button
              action={handleSave}
              frame={{ maxWidth: "infinity" }}
              background={{ style: "systemBlue", shape: "capsule" }}
              tint="white"
            >
              <HStack spacing={6} padding={{ vertical: 10, leading: 16, trailing: 20 }}>
                <Image systemName="square.and.arrow.down" font="subheadline" />
                <Text font="subheadline" fontWeight="medium">储存到设备</Text>
              </HStack>
            </Button>
            <Button
              action={isCurrentCoordFavorited() ? handleRemoveCurrentFavorite : () => handleAddFavorite({ latitude: coordLat.value, longitude: coordLng.value })}
              frame={{ maxWidth: "infinity" }}
              background={{ style: isCurrentCoordFavorited() ? "systemGray" : "systemOrange", shape: "capsule" }}
              tint="white"
            >
              <HStack spacing={6} padding={{ vertical: 10, leading: 16, trailing: 20 }}>
                <Image systemName={isCurrentCoordFavorited() ? "star.slash" : "star"} font="subheadline" />
                <Text font="subheadline" fontWeight="medium">{isCurrentCoordFavorited() ? "取消收藏" : "收藏"}</Text>
              </HStack>
            </Button>
          </HStack>

          {/* 第4行：保存坐标状态 */}
          <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
            {loc ? (
              <>
                <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" font="subheadline" />
                <Text font="subheadline" foregroundStyle="systemGreen">
                  经度 {loc.longitude.toFixed(6)} 纬度 {loc.latitude.toFixed(6)} {loc.accuracy ? `精度 ${loc.accuracy}m` : ""}
                </Text>
                <Spacer />
                <Button action={handleClear}>
                  <Image systemName="trash" foregroundStyle="systemRed" font="subheadline" />
                </Button>
              </>
            ) : (
              <>
                <Image systemName="location.slash" foregroundStyle="tertiaryLabel" font="subheadline" />
                <Text font="subheadline" foregroundStyle="tertiaryLabel">设备无已保存坐标</Text>
              </>
            )}
          </HStack>
        </VStack>
      </VStack>
    </ZStack>
  )
}

const run = async () => {
  await Navigation.present({ element: <App />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}

run()
