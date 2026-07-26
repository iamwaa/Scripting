import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  TextField,
  VStack,
  ZStack,
  useState,
} from "scripting"
import { PageBackground } from "../components/PageBackground"
import { GlassBadge } from "../components/glass"
import {
  glassControlProps,
  glassChipProps,
  textColor,
  weatherCardProps,
  weatherListChrome,
} from "../components/tokens"
import {
  addFavorite,
  isFavorite,
  loadFavorites,
  removeFavorite,
  updateFavoriteDisplayName,
} from "../services/favoritesService"
import { searchPlaces } from "../services/locationService"
import type { Place } from "../types"
import { placeAddress, placeDisplayName } from "../utils/place"

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

function PlaceRow({
  place,
  favorited,
  onSelect,
  onToggleFavorite,
  onEditName,
  showRemove,
  onRemove,
}: {
  place: Place
  favorited: boolean
  onSelect: () => void
  onToggleFavorite?: () => void
  onEditName?: () => void
  showRemove?: boolean
  onRemove?: () => void
}) {
  const title = placeDisplayName(place)
  const subtitle = placeAddress(place)

  return (
    <HStack spacing={12} {...weatherCardProps}>
      <Button action={onSelect} buttonStyle="plain">
        <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <ZStack
            frame={{ width: 40, height: 40 }}
            background={{
              style: {
                light: "rgba(0,122,255,0.12)",
                dark: "rgba(10,132,255,0.18)",
              },
              shape: { type: "rect", cornerRadius: 12, style: "continuous" },
            }}
          >
            <Image
              systemName={showRemove ? "star.fill" : "mappin.and.ellipse"}
              font={16}
              foregroundStyle={showRemove ? "systemYellow" : "systemBlue"}
            />
          </ZStack>
          <VStack
            alignment="leading"
            spacing={3}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          >
            <Text font="body" fontWeight="semibold" foregroundStyle={textColor.primary} lineLimit={1}>
              {title}
            </Text>
            <Text font="footnote" foregroundStyle={textColor.secondary} lineLimit={2}>
              {subtitle}
            </Text>
          </VStack>
        </HStack>
      </Button>

      {onEditName ? (
        <Button action={onEditName} buttonStyle="plain">
          <Image systemName="pencil" font={16} foregroundStyle={textColor.secondary} />
        </Button>
      ) : null}

      {onToggleFavorite ? (
        <Button action={onToggleFavorite} buttonStyle="plain">
          <Image
            systemName={favorited ? "star.fill" : "star"}
            font={18}
            foregroundStyle={favorited ? "systemYellow" : "secondaryLabel"}
          />
        </Button>
      ) : null}

      {showRemove && onRemove ? (
        <Button action={onRemove} buttonStyle="plain">
          <Image systemName="trash" font={16} foregroundStyle="systemRed" />
        </Button>
      ) : null}
    </HStack>
  )
}

export function SearchPage({
  onSelect,
}: {
  onSelect: (place: Place) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Place[]>([])
  const [favorites, setFavorites] = useState<Place[]>(() => loadFavorites())
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

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
    onSelect(place)
    dismiss()
  }

  const toggleFav = (place: Place) => {
    if (isFavorite(favorites, place)) {
      setFavorites(removeFavorite(favorites, place))
    } else {
      setFavorites(addFavorite(favorites, place))
    }
  }

  const editDisplayName = async (place: Place) => {
    const result = await Dialog.prompt({
      title: "设置显示名称",
      message: "留空则恢复原始地名",
      defaultValue: place.displayName ?? place.name,
      placeholder: place.name,
    })
    if (result == null) return
    setFavorites(updateFavoriteDisplayName(favorites, place, result))
  }

  const showIdle = !searching && !searched && results.length === 0

  return (
    <NavigationStack>
      <ZStack alignment="top" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <List
          {...weatherListChrome}
          navigationTitle="地点"
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            topBarLeading: (
              <Button title="" systemImage="xmark" action={dismiss} />
            ),
          }}
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
                const favorited = isFavorite(favorites, place)
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
            header={<SectionTitle title="我的收藏" count={favorites.length} />}
          >
            {favorites.length === 0 ? (
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
              favorites.map(place => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  favorited={true}
                  onSelect={() => selectPlace(place)}
                  onEditName={() => editDisplayName(place)}
                  showRemove
                  onRemove={() => setFavorites(removeFavorite(favorites, place))}
                />
              ))
            )}
          </Section>
        </List>
      </ZStack>
    </NavigationStack>
  )
}
