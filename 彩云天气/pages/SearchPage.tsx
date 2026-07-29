import {
  Button,
  ForEach,
  HStack,
  Image,
  Label,
  List,
  ProgressView,
  Rectangle,
  RoundedRectangle,
  Section,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useState,
} from "scripting"
import { PageBackground } from "../components/PageBackground"
import { GlassBadge } from "../components/glass"
import {
  favoriteSurfaceFill,
  favoriteRowLayout,
  glassControlProps,
  glassChipProps,
  shadow,
  textColor,
  weatherCardProps,
  weatherListChrome,
} from "../components/tokens"
import {
  addFavorite,
  isFavorite,
  loadFavorites,
  removeFavorite,
  saveFavorites,
  updateFavoriteDisplayName,
} from "../services/favoritesService"
import { searchPlaces } from "../services/locationService"
import type { Place } from "../types"
import { placeAddress, placeDisplayName } from "../utils/place"
import { WeatherPage } from "./WeatherPage"

// 常用城市快捷入口
const QUICK_CITIES = [
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "成都",
  "武汉",
  "西安",
  "南京",
  "重庆",
]

function SectionTitle({
  title,
  count,
}: {
  title: string
  count?: number
}) {
  return (
    <HStack spacing={8} padding={{ bottom: 2 }}>
      <Text font="subheadline" fontWeight="semibold" foregroundStyle={textColor.secondary}>
        {title}
      </Text>
      {count != null ? (
        <GlassBadge style="neutral">
          <Text font={11} fontWeight="medium">
            {count}
          </Text>
        </GlassBadge>
      ) : null}
    </HStack>
  )
}

// 收藏行 listRowBackground：仅 clear 撑满整格，拖动不露系统白底。
// 玻璃挂在内容卡上（见 native 分支），不能放这里——listRowBackground 上的 padding 缩不了 glassEffect。
function FavoriteRowBackground() {
  return <Rectangle fill="clear" />
}

function PlaceRow({
  place,
  favorited,
  favoriteRow,
  native,
  onSelect,
  onToggleFavorite,
  onRename,
  onRemove,
}: {
  place: Place
  favorited: boolean
  // 收藏行：左侧图标用黄色星标
  favoriteRow?: boolean
  // 原生列表行：玻璃在 listRowBackground，内容行只挂一次左滑
  native?: boolean
  onSelect: () => void
  onToggleFavorite?: () => void
  // 收藏行左滑：改名 / 删除（在组件内挂到 HStack，避免外层再传 trailingSwipeActions 导致重复）
  onRename?: () => void
  onRemove?: () => void
}) {
  const title = placeDisplayName(place)
  const subtitle = placeAddress(place)
  // 紧凑收藏行布局参数（search 结果行继续用原样）
  const L = favoriteRowLayout
  // 图标块尺寸：收藏行紧凑；搜索结果行保持原大
  const iconSize = native ? L.iconSize : 40
  const iconRadius = native ? L.iconRadius : 12
  const iconFont = native ? L.iconFont : 16
  const textSpacing = native ? L.textSpacing : 3

  // 行主体：图标 + 标题/副标题；不含点击容器，供两种行样式复用
  const body = (
    <>
      <ZStack
        frame={{ width: iconSize, height: iconSize }}
        background={{
          style: {
            light: "rgba(0,122,255,0.12)",
            dark: "rgba(10,132,255,0.18)",
          },
          shape: { type: "rect", cornerRadius: iconRadius, style: "continuous" },
        }}
      >
        <Image
          systemName={favoriteRow ? "star.fill" : "mappin.and.ellipse"}
          font={iconFont}
          foregroundStyle={favoriteRow ? "systemYellow" : "systemBlue"}
        />
      </ZStack>
      <VStack
        alignment="leading"
        spacing={textSpacing}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
      >
        <Text font={16} fontWeight="semibold" foregroundStyle={textColor.primary} lineLimit={1}>
          {title}
        </Text>
        <Text font={13} foregroundStyle={textColor.secondary} lineLimit={2}>
          {subtitle}
        </Text>
      </VStack>
    </>
  )

  // 收藏行：
  // - 外层：透明 list 行 + 水平 inset + 左滑/点击（玻璃不在 listRowBackground）
  // - 内层：版本感知玻璃卡（与搜索结果 weatherCardProps 同构），框与内容一起离开屏幕边缘
  // - 禁止 listRowBackground 再叠一层玻璃；禁止行内 Button
  if (native) {
    return (
      <HStack
        padding={{ horizontal: L.insetX }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        listRowBackground={<FavoriteRowBackground />}
        listRowSeparator="hidden"
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            // 不用 role="destructive"：会触发系统自动移除行动画，与确认弹窗叠加导致闪动
            <Button tint="systemBlue" action={() => onRename?.()}>
              <Label title="修改" systemImage="pencil" />
            </Button>,
            <Button tint="systemRed" action={() => onRemove?.()}>
              <Label title="删除" systemImage="trash" />
            </Button>,
          ],
        }}
        onTapGesture={onSelect}
      >
        <HStack
          spacing={L.spacing}
          padding={{ horizontal: 14, vertical: L.paddingY }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          {...favoriteSurfaceFill}
          shadow={shadow.card}
        >
          {body}
          {/* 拖动手柄：提示该行可长按拖动排序；弱化视觉权重 */}
          <Image
            systemName="line.3.horizontal"
            font={14}
            foregroundStyle={textColor.tertiary}
          />
        </HStack>
      </HStack>
    )
  }

  // 搜索结果行：悬浮玻璃卡片 + 行内星标
  return (
    <HStack spacing={12} {...weatherCardProps}>
      <Button action={onSelect} buttonStyle="plain">
        <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {body}
        </HStack>
      </Button>
      {onToggleFavorite ? (
        <Button action={onToggleFavorite} buttonStyle="plain">
          <Image
            systemName={favorited ? "star.fill" : "star"}
            font={18}
            foregroundStyle={favorited ? "systemYellow" : "secondaryLabel"}
          />
        </Button>
      ) : null}
    </HStack>
  )
}

export function SearchPage({
  onReturnToCurrent,
}: {
  onReturnToCurrent?: () => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Place[]>([])
  // 收藏用 Observable：data 模式 ForEach 才能正确 diff（修复重复左滑）与承载拖动排序
  const favorites = useObservable<Place[]>(() => loadFavorites())
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [previewPlace, setPreviewPlace] = useState<Place | null>(null)

  const clearSearch = () => {
    setQuery("")
    setResults([])
    setError(null)
    setSearched(false)
  }

  const runSearch = async (raw?: string) => {
    const keyword = (raw ?? query).trim()
    if (!keyword) {
      setError("请输入要搜索的地点")
      setResults([])
      setSearched(false)
      return
    }

    if (raw != null && raw !== query) {
      setQuery(raw)
    }

    setSearching(true)
    setError(null)
    setSearched(true)
    try {
      const places = await searchPlaces(keyword)
      setResults(places)
      if (places.length === 0) {
        setError("未找到匹配地点，可尝试更具体的名称")
      }
    } catch (e: any) {
      setResults([])
      setError(e?.message ?? String(e))
    } finally {
      setSearching(false)
    }
  }

  const selectPlace = (place: Place) => {
    // 在搜索页内切换为天气详情，不改动首页的原生分页容器
    setPreviewPlace({ ...place, isCurrent: false })
  }

  const toggleFav = async (place: Place) => {
    if (isFavorite(favorites.value, place)) {
      // 取消收藏前确认
      const ok = await Dialog.confirm({
        title: "取消收藏",
        message: `确定取消收藏「${placeDisplayName(place)}」吗？`,
      })
      if (ok !== true) return
      favorites.setValue(removeFavorite(favorites.value, place))
    } else {
      favorites.setValue(addFavorite(favorites.value, place))
    }
  }

  // 收藏列表移除前确认
  const removeFav = async (place: Place) => {
    const ok = await Dialog.confirm({
      title: "取消收藏",
      message: `确定取消收藏「${placeDisplayName(place)}」吗？`,
    })
    if (ok !== true) return
    favorites.setValue(removeFavorite(favorites.value, place))
  }

  const editDisplayName = async (place: Place) => {
    const result = await Dialog.prompt({
      title: "设置显示名称",
      message: "留空则恢复原始地名",
      defaultValue: place.displayName ?? place.name,
      placeholder: place.name,
    })
    if (result == null) return
    favorites.setValue(updateFavoriteDisplayName(favorites.value, place, result))
  }

  // data 模式 ForEach 通过 editActions 拖动排序时会原地改写 Observable；
  // 用顺序签名做副作用，顺序变化即持久化（跳过首帧）。
  const favSig = favorites.value.map(p => p.id).join("|")
  const favFirstRun = useState(true)
  useEffect(() => {
    if (favFirstRun[0]) {
      favFirstRun[1](false)
      return
    }
    saveFavorites(favorites.value)
  }, [favSig])

  const showIdle = !searching && !searched && results.length === 0

  return (
    <ZStack
      alignment="top"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      // 详情页改用 navigationDestination 原生 push：系统自动提供返回按钮与右滑返回手势
      navigationDestination={{
        isPresented: previewPlace != null,
        onChanged: isPresented => {
          if (!isPresented) {
            setPreviewPlace(null)
            favorites.setValue(loadFavorites())
          }
        },
        content: previewPlace ? (
          <WeatherPage
            place={previewPlace}
            toolbarMode="detail"
            onLocate={() => onReturnToCurrent?.()}
            onFavoritesChanged={() => favorites.setValue(loadFavorites())}
          />
        ) : (
          <></>
        ),
      }}
    >
      {/* 搜索页由外层 NavigationStack 原生 push，系统自动提供返回按钮和右滑手势 */}
      <PageBackground />
      <List
        {...weatherListChrome}
        navigationTitle="地点"
        navigationBarTitleDisplayMode="inline"
      >
        {/* 搜索栏：清空 List 行底，避免玻璃胶囊外再套一层违和背景 */}
        <Section>
          <HStack
            spacing={10}
            {...glassControlProps}
            listRowBackground={<></>}
            listRowSeparator="hidden"
          >
            <Image systemName="magnifyingglass" font={16} foregroundStyle={textColor.secondary} />
            <TextField
              title=""
              value={query}
              prompt="搜索城市、区县或地标"
              onChanged={setQuery}
              textFieldStyle="plain"
              submitLabel="search"
              textContentType="location"
              autocorrectionDisabled={true}
              textInputAutocapitalization="never"
              onSubmit={() => runSearch()}
            />
            {query.length > 0 ? (
              <Button action={clearSearch} buttonStyle="plain">
                <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
              </Button>
            ) : null}
            <Button
              action={() => runSearch()}
              buttonStyle="plain"
              disabled={searching || query.trim().length === 0}
            >
              <Text
                font="callout"
                fontWeight="semibold"
                foregroundStyle={
                  searching || query.trim().length === 0
                    ? textColor.tertiary
                    : textColor.accent
                }
              >
                搜索
              </Text>
            </Button>
          </HStack>
        </Section>

        {/* 快捷城市：空闲或尚未有结果时展示 */}
        {showIdle || (searched && results.length === 0 && !searching) ? (
          <Section header={<SectionTitle title="热门城市" />}>
            <VStack
              alignment="center"
              spacing={10}
              {...weatherCardProps}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <HStack
                spacing={8}
                frame={{ maxWidth: "infinity", alignment: "center" }}
              >
                {QUICK_CITIES.slice(0, 5).map(city => (
                  <Button
                    key={city}
                    action={() => runSearch(city)}
                    buttonStyle="plain"
                    disabled={searching}
                  >
                    <Text
                      font="footnote"
                      fontWeight="medium"
                      foregroundStyle={textColor.primary}
                      padding={{ horizontal: 12, vertical: 7 }}
                      {...glassChipProps}
                    >
                      {city}
                    </Text>
                  </Button>
                ))}
              </HStack>
              <HStack
                spacing={8}
                frame={{ maxWidth: "infinity", alignment: "center" }}
              >
                {QUICK_CITIES.slice(5).map(city => (
                  <Button
                    key={city}
                    action={() => runSearch(city)}
                    buttonStyle="plain"
                    disabled={searching}
                  >
                    <Text
                      font="footnote"
                      fontWeight="medium"
                      foregroundStyle={textColor.primary}
                      padding={{ horizontal: 12, vertical: 7 }}
                      {...glassChipProps}
                    >
                      {city}
                    </Text>
                  </Button>
                ))}
              </HStack>
            </VStack>
          </Section>
        ) : null}

        {/* 加载中 */}
        {searching ? (
          <Section>
            <HStack
              spacing={12}
              {...weatherCardProps}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <ProgressView
                frame={{ width: 18, height: 18 }}
                progressViewStyle="circular"
              />
              <VStack alignment="leading" spacing={2}>
                <Text font="body" fontWeight="medium" foregroundStyle={textColor.primary}>
                  正在搜索 {query.trim() || "地点"}…
                </Text>
                <Text font="footnote" foregroundStyle={textColor.secondary}>
                  正在匹配附近地点
                </Text>
              </VStack>
            </HStack>
          </Section>
        ) : null}

        {/* 错误 / 无结果 */}
        {error && searched && !searching ? (
          <Section>
            <VStack
              alignment="center"
              spacing={10}
              {...weatherCardProps}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <Image
                systemName="magnifyingglass"
                font={28}
                foregroundStyle={textColor.tertiary}
              />
              <Text
                font="headline"
                foregroundStyle={textColor.primary}
                multilineTextAlignment="center"
              >
                未找到结果
              </Text>
              <Text
                font="footnote"
                foregroundStyle={textColor.secondary}
                multilineTextAlignment="center"
                frame={{ maxWidth: "infinity" }}
              >
                {error}
              </Text>
            </VStack>
          </Section>
        ) : null}

        {/* 搜索结果 */}
        {results.length > 0 && !searching ? (
          <Section
            header={<SectionTitle title="搜索结果" count={results.length} />}
          >
            {results.map(place => {
              const favorited = isFavorite(favorites.value, place)
              return (
                <PlaceRow
                  key={place.id}
                  place={place}
                  favorited={favorited}
                  onSelect={() => selectPlace(place)}
                  onToggleFavorite={() => toggleFav(place)}
                />
              )
            })}
          </Section>
        ) : null}

        {/* 收藏列表 */}
        <Section
          header={<SectionTitle title="我的收藏" count={favorites.value.length} />}
        >
          {favorites.value.length === 0 ? (
            <VStack
              alignment="center"
              spacing={10}
              {...weatherCardProps}
              frame={{ maxWidth: "infinity", alignment: "center" }}
            >
              <Image systemName="star" font={28} foregroundStyle={textColor.tertiary} />
              <Text
                font="headline"
                foregroundStyle={textColor.primary}
                multilineTextAlignment="center"
              >
                暂无收藏
              </Text>
              <Text
                font="footnote"
                foregroundStyle={textColor.secondary}
                multilineTextAlignment="center"
                frame={{ maxWidth: "infinity" }}
              >
                搜索地点后点星标，或在天气页点右上角星标收藏
              </Text>
            </VStack>
          ) : (
            <ForEach
              data={favorites}
              editActions="move"
              builder={(place: Place) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  favorited={true}
                  favoriteRow
                  native
                  onSelect={() => selectPlace(place)}
                  onRename={() => editDisplayName(place)}
                  onRemove={() => removeFav(place)}
                />
              )}
            />
          )}
        </Section>
      </List>
    </ZStack>
  )
}
