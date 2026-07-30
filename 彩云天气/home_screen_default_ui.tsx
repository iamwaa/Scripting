/**
 * home_screen_default_ui.tsx — App 首页 Tab 的精简天气首页
 *
 * 与 index.tsx / HomePage 的分工：
 * - index.tsx：Navigation.present(<HomePage />) 全屏弹出，支持多地点跟手翻页；dismiss 后 Script.exit()。
 * - 本文件：占据 App 首页一个常驻 Tab，只读展示「单个地点」的天气概览，复用 WeatherPage detail 模式。
 *
 * Home Tab 能力约束（见文档 Home Screen UI）：
 * - 默认导出函数组件；直接 return 视图，不要 Navigation.present。
 * - 不要 Script.exit()：Tab 常驻，退出会让界面卡死需 Reload。
 * - 顶层代码只在 Tab 首次构建时运行一次，状态在切 Tab 间保留。
 *
 * 地点来源：loadLastPlace()（App 最近查看/定位的地点）；无历史时自动定位一次。
 */
import {
  Button,
  ContentUnavailableView,
  Image,
  List,
  NavigationStack,
  ProgressView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import { WeatherBackground } from "./components/WeatherBackground"
import { weatherListChrome } from "./components/tokens"
import { WeatherPage } from "./pages/WeatherPage"
import { loadLastPlace, saveLastPlace } from "./services/favoritesService"
import { getCurrentPlace } from "./services/locationService"
import { hasApiToken } from "./services/settingsService"
import type { Place } from "./types"

export default function HomeScreenTab() {
  // 初始地点直接取最近查看/定位的地点；无历史则进入定位流程
  const [place, setPlace] = useState<Place | null>(() => loadLastPlace())
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  // 定位到当前位置：成功后写入 lastPlace 并切换，供工具栏「当前位置」与空态复用
  const locate = async () => {
    setLocating(true)
    setLocateError(null)
    try {
      const current = await getCurrentPlace(true)
      saveLastPlace(current)
      setPlace(current)
    } catch (e: any) {
      setLocateError(e?.message ?? String(e))
    } finally {
      setLocating(false)
    }
  }

  // 无历史地点时自动定位一次
  useEffect(() => {
    if (!place) {
      locate()
    }
  }, [])

  // 有地点：复用 WeatherPage detail 模式（自绘背景 + 工具栏 + 自加载天气）
  if (place) {
    return (
      <NavigationStack>
        <WeatherPage place={place} toolbarMode="detail" onLocate={locate} />
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
