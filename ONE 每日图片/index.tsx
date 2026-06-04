import {
  Button,
  DatePicker,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Rectangle,
  Script,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
  Widget,
  ZStack,
} from 'scripting'
import { useEffect, useState } from 'scripting'
import {
  BingSettingsManager,
  displayModeOptions,
  getAllWallpapers,
  getCurrentSettings,
  getDisplayWallpaper,
  setDisplayMode,
  setManualWallpaperDate,
  clearLastUpdateTime,
  clearRefreshLogs,
  getRefreshLogs,
  type RefreshLogEntry,
  type WallpaperData,
  type WallpaperDisplayMode,
} from './utils/one-service'
import { ImageCacheManager } from './utils/image-cache'

const MONTH_LABELS: string[] = [
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'May.',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sep.',
  'Oct.',
  'Nov.',
  'Dec.',
]

const PREVIEW_IMAGE_HEIGHT = 220
const PREVIEW_CORNER_RADIUS = 12

type CacheStats = {
  totalFiles: number
  totalSize: number
  oldestCache: number
  newestCache: number
}

type OneDateParts = {
  day: string
  metadata: string
}

type RefreshLogViewItem = RefreshLogEntry & {
  timeLabel: string
  nextRefreshLabel: string
  statusLabel: string
}

type CurrentWallpaperPreviewProps = {
  imageUrl: string
  cachedImagePath: string
  title: string
  copyright: string
  showTitle: boolean
  showCopyright: boolean
}

const buildFallbackTitle = (title: string): string => {
  return title.trim() || 'ONE 每日图片'
}

const buildFallbackCopyright = (copyright: string): string => {
  return copyright.trim() || 'ONE · 一个'
}

const formatCacheSize = (size: number): string => {
  if (size <= 0) {
    return '0 KB'
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const formatLogTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-'
  }

  const date: Date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const getRefreshLogStatusLabel = (status: RefreshLogEntry['status']): string => {
  switch (status) {
    case 'start':
      return '开始'
    case 'success':
      return '成功'
    case 'error':
      return '失败'
    default:
      return status
  }
}

const buildRefreshLogViewItems = (): RefreshLogViewItem[] => {
  return getRefreshLogs().map((log: RefreshLogEntry) => ({
    ...log,
    timeLabel: formatLogTime(log.timestamp),
    nextRefreshLabel: formatLogTime(log.nextRefreshAt),
    statusLabel: getRefreshLogStatusLabel(log.status),
  }))
}

const getOneDateParts = (copyright: string): OneDateParts => {
  const normalizedCopyright: string = buildFallbackCopyright(copyright)
  const match: RegExpMatchArray | null = normalizedCopyright.match(
    /^(VOL\.\d+)\s*\|\s*(\d{4})年(\d{2})月(\d{2})日$/,
  )

  if (!match) {
    return {
      day: '',
      metadata: normalizedCopyright,
    }
  }

  const monthIndex: number = Number(match[3]) - 1
  const monthLabel: string = MONTH_LABELS[monthIndex] || match[3]

  return {
    day: String(Number(match[4])),
    metadata: `${match[1]} | ${monthLabel} ${match[2]}`,
  }
}

const CurrentWallpaperPreview = ({
  imageUrl,
  cachedImagePath,
  title,
  copyright,
  showTitle,
  showCopyright,
}: CurrentWallpaperPreviewProps) => {
  const dateParts: OneDateParts = getOneDateParts(copyright)
  const shouldShowText: boolean = showTitle || showCopyright

  return (
    <VStack spacing={12} alignment="leading">
      <ZStack
        frame={{ height: PREVIEW_IMAGE_HEIGHT }}
        clipShape={{ type: 'rect', cornerRadius: PREVIEW_CORNER_RADIUS }}
      >
        {cachedImagePath ? (
          <Image
            filePath={cachedImagePath}
            resizable={true}
            scaleToFill={true}
            frame={{ height: PREVIEW_IMAGE_HEIGHT }}
          />
        ) : (
          <Image
            imageUrl={imageUrl}
            resizable={true}
            scaleToFill={true}
            frame={{ height: PREVIEW_IMAGE_HEIGHT }}
          />
        )}

        <Rectangle fill="#000000" opacity={0.2} />

        <VStack spacing={0}>
          <Spacer />
          {shouldShowText && (
            <HStack spacing={0}>
              <VStack
                alignment="leading"
                spacing={4}
                padding={{ top: 0, bottom: 10, leading: 10, trailing: 10 }}
              >
                {showCopyright && (
                  <VStack alignment="leading" spacing={4}>
                    {!!dateParts.day && (
                      <Text font={36} foregroundStyle="#ffffff" lineLimit={1}>
                        {dateParts.day}
                      </Text>
                    )}
                    <Text font={18} foregroundStyle="#ffffff" lineLimit={1}>
                      {dateParts.metadata}
                    </Text>
                  </VStack>
                )}

                {showTitle && (
                  <Text font={15} foregroundStyle="#ffffff" lineLimit={2}>
                    {buildFallbackTitle(title)}
                  </Text>
                )}
              </VStack>
              <Spacer />
            </HStack>
          )}
        </VStack>
      </ZStack>

      <Text font="caption" foregroundStyle="secondaryLabel">
        当前预览效果仅供参考
      </Text>
    </VStack>
  )
}

const RefreshLogPage = () => {
  const [logs, setLogs] = useState<RefreshLogViewItem[]>(() => buildRefreshLogViewItems())

  const reloadLogs = (): void => {
    setLogs(buildRefreshLogViewItems())
  }

  const clearLogs = (): void => {
    clearRefreshLogs()
    reloadLogs()
  }

  return (
    <List navigationTitle="刷新日志">
      <Section>
        <Button title="重新读取日志" action={reloadLogs} />
        <Button title="清空刷新日志" action={clearLogs} />
      </Section>

      <Section header={<Text font="headline">最近记录</Text>}>
        {logs.length === 0 ? (
          <Text font="body" foregroundStyle="secondaryLabel">
            暂无刷新日志
          </Text>
        ) : (
          logs.map((log: RefreshLogViewItem) => (
            <VStack key={log.id} alignment="leading" spacing={4}>
              <HStack alignment="center">
                <Text font="body" foregroundStyle="label">
                  {log.statusLabel} · {log.timeLabel}
                </Text>
                <Spacer />
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {log.forceRefresh ? '强制刷新' : '常规加载'}
                </Text>
              </HStack>

              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {log.message}
              </Text>

              <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
                下次 {log.nextRefreshLabel}
                {log.displayDate ? ` · 显示 ${log.displayDate}` : ''}
              </Text>
            </VStack>
          ))
        )}
      </Section>
    </List>
  )
}

const OneWallpaperDetail = () => {
  const dismiss = Navigation.useDismiss()
  const [wallpaperData, setWallpaperData] = useState<WallpaperData | null>(null)
  const [cachedImagePath, setCachedImagePath] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [availableWallpapers, setAvailableWallpapers] = useState<WallpaperData[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    BingSettingsManager.getSelectedDate(),
  )
  const [displayMode, setDisplayModeState] = useState<WallpaperDisplayMode>(() =>
    BingSettingsManager.getDisplayMode(),
  )
  const [showTitle, setShowTitle] = useState<boolean>(() => BingSettingsManager.getShowTitle())
  const [showCopyright, setShowCopyright] = useState<boolean>(() =>
    BingSettingsManager.getShowCopyright(),
  )
  const [refreshTimeValue, setRefreshTimeValue] = useState<number>(() =>
    BingSettingsManager.getRefreshTimeValue(),
  )
  const [refreshLogs, setRefreshLogs] = useState<RefreshLogViewItem[]>(() =>
    buildRefreshLogViewItems(),
  )
  const [cacheStats, setCacheStats] = useState<CacheStats>({
    totalFiles: 0,
    totalSize: 0,
    oldestCache: 0,
    newestCache: 0,
  })

  const refreshLogItems = (): void => {
    setRefreshLogs(buildRefreshLogViewItems())
  }

  const refreshCacheStats = async (): Promise<void> => {
    const stats = await ImageCacheManager.getCacheStats()
    setCacheStats(stats)
  }

  const updateCachedImage = async (imageUrl: string): Promise<void> => {
    const cachedPath: string | null = await ImageCacheManager.getCachedImagePath(imageUrl)
    setCachedImagePath(cachedPath || '')
    await refreshCacheStats()
  }

  const loadData = async (forceRefresh: boolean = true): Promise<void> => {
    setLoading(true)

    try {
      const wallpapers: WallpaperData[] = await getAllWallpapers()
      setAvailableWallpapers(wallpapers)

      const settings = getCurrentSettings()
      setSelectedDate(settings.selectedDate)
      setDisplayModeState(settings.displayMode)
      setShowTitle(settings.showTitle)
      setShowCopyright(settings.showCopyright)
      setRefreshTimeValue(BingSettingsManager.getRefreshTimeValue())
      refreshLogItems()

      const displayWallpaper: WallpaperData = await getDisplayWallpaper(forceRefresh)
      setWallpaperData(displayWallpaper)
      await updateCachedImage(displayWallpaper.imageUrl)
    } catch {
      await refreshCacheStats()
    } finally {
      setLoading(false)
    }
  }

  const refreshData = async (): Promise<void> => {
    clearLastUpdateTime()
    await loadData(true)
    Widget.reloadAll()
    refreshLogItems()
  }

  const handleDateChange = async (rawDate: string): Promise<void> => {
    setSelectedDate(rawDate)
    setManualWallpaperDate(rawDate)

    const wallpaper: WallpaperData | undefined = availableWallpapers.find(
      (item: WallpaperData) => item.rawDate === rawDate,
    )

    if (wallpaper) {
      setWallpaperData(wallpaper)
      await updateCachedImage(wallpaper.imageUrl)
    }

    setDisplayModeState('manual')
    Widget.reloadAll()
  }

  const handleDisplayModeChange = async (mode: string): Promise<void> => {
    const nextMode: WallpaperDisplayMode = mode as WallpaperDisplayMode
    setDisplayModeState(nextMode)

    const nextSettings = setDisplayMode(nextMode)
    setSelectedDate(nextSettings.selectedDate)

    const displayWallpaper: WallpaperData = await getDisplayWallpaper(false)
    setWallpaperData(displayWallpaper)
    await updateCachedImage(displayWallpaper.imageUrl)
    Widget.reloadAll()
  }

  const handleShowTitleChange = (value: boolean): void => {
    setShowTitle(value)
    BingSettingsManager.setShowTitle(value)
    Widget.reloadAll()
  }

  const handleShowCopyrightChange = (value: boolean): void => {
    setShowCopyright(value)
    BingSettingsManager.setShowCopyright(value)
    Widget.reloadAll()
  }

  const handleRefreshTimeChange = (timestamp: number): void => {
    setRefreshTimeValue(timestamp)
    BingSettingsManager.setRefreshTime(timestamp)
    clearLastUpdateTime()
    setTimeout(() => Widget.reloadAll(), 300)
  }

  const clearImageCache = async (): Promise<void> => {
    await ImageCacheManager.clearAllCache()
    setCachedImagePath('')
    await refreshCacheStats()
    Widget.reloadAll()
  }

  useEffect(() => {
    loadData(true).then(() => Widget.reloadAll())
  }, [])

  if (loading || !wallpaperData) {
    return (
      <NavigationStack>
        <List navigationTitle="ONE 每日图片">
          <Section>
            <Text font="body" foregroundStyle="secondaryLabel">
              正在加载每日内容...
            </Text>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  const cacheSizeLabel: string = formatCacheSize(cacheStats.totalSize)

  return (
    <NavigationStack>
      <List
        navigationTitle="ONE 每日图片"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: (
            <Button action={dismiss}>
              <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
            </Button>
          ),
        }}
      >
        <Section header={<Text font="headline">显示配置</Text>}>
          <Picker title="显示模式" value={displayMode} onChanged={handleDisplayModeChange}>
            {displayModeOptions.map((option: { label: string; value: WallpaperDisplayMode }) => (
              <Text key={option.value} tag={option.value} font="body">
                {option.label}
              </Text>
            ))}
          </Picker>

          {displayMode === 'latest' ? (
            <HStack alignment="center">
              <Text font="body" foregroundStyle="secondaryLabel">
                手动指定日期
              </Text>
              <Spacer />
              <Text font="caption" foregroundStyle="tertiaryLabel">
                最新内容模式下不可操作
              </Text>
            </HStack>
          ) : (
            <Picker title="手动指定日期" value={selectedDate} onChanged={handleDateChange}>
              {availableWallpapers.map((wallpaper: WallpaperData) => (
                <Text key={wallpaper.rawDate} tag={wallpaper.rawDate} font="body">
                  {wallpaper.date}
                </Text>
              ))}
            </Picker>
          )}

          <Toggle title="显示底部标题" value={showTitle} onChanged={handleShowTitleChange} />

          <Toggle
            title="显示 VOL / 日期信息"
            value={showCopyright}
            onChanged={handleShowCopyrightChange}
          />

          <DatePicker
            title="刷新时间"
            value={refreshTimeValue}
            displayedComponents={['hourAndMinute']}
            onChanged={handleRefreshTimeChange}
          />
        </Section>

        <Section header={<Text font="headline">当前显示内容</Text>}>
          <CurrentWallpaperPreview
            imageUrl={wallpaperData.imageUrl}
            cachedImagePath={cachedImagePath}
            title={wallpaperData.title}
            copyright={wallpaperData.copyright}
            showTitle={showTitle}
            showCopyright={showCopyright}
          />
        </Section>

        <Section header={<Text font="headline">详细信息</Text>}>
          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              当前显示日期
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{wallpaperData.date}</Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              显示模式
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {displayModeOptions.find(
                (item: { label: string; value: WallpaperDisplayMode }) => item.value === displayMode,
              )?.label || displayMode}
            </Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              标题
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel" lineLimit={2}>
              {wallpaperData.title}
            </Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              VOL / 日期
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel" lineLimit={2}>
              {wallpaperData.copyright}
            </Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              图片来源
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">ONE · 一个</Text>
          </HStack>

          <HStack alignment="center">
            <Text font="body" foregroundStyle="label">
              图片缓存
            </Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {cacheStats.totalFiles} 个 / {cacheSizeLabel}
            </Text>
          </HStack>
        </Section>

        <Section header={<Text font="headline">刷新日志</Text>}>
          <NavigationLink destination={<RefreshLogPage />}>
            <HStack alignment="center">
              <Text font="body" foregroundStyle="label">
                查看刷新日志
              </Text>
              <Spacer />
              <Text font="body" foregroundStyle="secondaryLabel">
                {refreshLogs.length} 条
              </Text>
            </HStack>
          </NavigationLink>
        </Section>

        <Section
          footer={
            <VStack spacing={10} alignment="leading">
              <Text font="caption" foregroundStyle="tertiaryLabel">
                接口数据由 https://m.wufazhuce.com 提供
              </Text>
            </VStack>
          }
        >
          <Button title="刷新每日内容" action={refreshData} />
          <Button title="清除图片缓存" action={clearImageCache} />
        </Section>
      </List>
    </NavigationStack>
  )
}

const run = async (): Promise<void> => {
  await Navigation.present({
    element: <OneWallpaperDetail />,
    modalPresentationStyle: 'pageSheet',
  })
  Script.exit()
}

run()
