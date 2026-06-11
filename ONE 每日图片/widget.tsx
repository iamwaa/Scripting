import { Image, VStack, HStack, ZStack, Spacer, Text, Widget, Rectangle } from 'scripting'
import {
  getCurrentSettings,
  getDisplayWallpaper,
  BingSettingsManager,
  shouldRetryRefreshAfterFetch,
  getNextRefreshDate,
  getRetryRefreshDate,
  addRefreshLog,
} from './utils/one-service'
import { ImageCacheManager } from './utils/image-cache'

type WidgetViewProps = {
  imageUrl: string
  localImagePath?: string
  title: string
  copyright: string
  showTitle: boolean
  showCopyright: boolean
}

type WidgetBackgroundProps = {
  imageUrl: string
  localImagePath?: string
}

type EdgeInsets = {
  top: number
  bottom: number
  leading: number
  trailing: number
}

type TextOverlayLayout = {
  contentSpacing: number
  metadataSpacing: number
  padding: EdgeInsets
  dayFont: number
  metadataFont: number
  titleFont: number
  titleLineLimit: number
}

const MEDIUM_TEXT_LAYOUT: TextOverlayLayout = {
  contentSpacing: 2,
  metadataSpacing: 2,
  padding: {
    top: 0,
    bottom: 50,
    leading: 16,
    trailing: 16,
  },
  dayFont: 28,
  metadataFont: 14,
  titleFont: 12,
  titleLineLimit: 2,
}

const LARGE_TEXT_LAYOUT: TextOverlayLayout = {
  contentSpacing: 4,
  metadataSpacing: 4,
  padding: {
    top: 0,
    bottom: 16,
    leading: 120,
    trailing: 120,
  },
  dayFont: 36,
  metadataFont: 18,
  titleFont: 15,
  titleLineLimit: 2,
}

const buildFallbackTitle = (title: string): string => {
  return title.trim() || 'ONE 每日图片'
}

const buildFallbackCopyright = (copyright: string): string => {
  return copyright.trim() || 'ONE · 一个'
}

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

type OneDateParts = {
  day: string
  metadata: string
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

const WidgetBackground = ({
  imageUrl,
  localImagePath,
}: WidgetBackgroundProps) => {
  if (localImagePath) {
    return (
      <Image filePath={localImagePath} resizable={true} scaleToFill={true} />
    )
  }

  return <Image imageUrl={imageUrl} resizable={true} scaleToFill={true} />
}

type WidgetTextOverlayProps = {
  title: string
  copyright: string
  showTitle: boolean
  showCopyright: boolean
  layout: TextOverlayLayout
}

const WidgetScrim = () => {
  return <Rectangle fill="#000000" opacity={0.2} />
}

const WidgetTextOverlay = ({
  title,
  copyright,
  showTitle,
  showCopyright,
  layout,
}: WidgetTextOverlayProps) => {
  const shouldShowText: boolean = showTitle || showCopyright
  const dateParts: OneDateParts = getOneDateParts(copyright)

  if (!shouldShowText) {
    return null
  }

  return (
    <VStack spacing={0}>
      <Spacer />

      <HStack spacing={0}>
        <VStack
          alignment="leading"
          spacing={layout.contentSpacing}
          padding={layout.padding}
          frame={{ maxWidth: 'infinity', alignment: 'leading' }}
        >
          {showCopyright && (
            <VStack alignment="leading" spacing={layout.metadataSpacing}>
              {!!dateParts.day && (
                <Text
                  font={layout.dayFont}
                  foregroundStyle="#ffffff"
                  lineLimit={1}
                >
                  {dateParts.day}
                </Text>
              )}
              <Text
                font={layout.metadataFont}
                foregroundStyle="#ffffff"
                lineLimit={1}
              >
                {dateParts.metadata}
              </Text>
            </VStack>
          )}

          {showTitle && (
            <Text
              font={layout.titleFont}
              foregroundStyle="#ffffff"
              lineLimit={{ max: layout.titleLineLimit, reservesSpace: false }}
              truncationMode="tail"
              frame={{ maxWidth: 'infinity', alignment: 'leading' }}
              layoutPriority={1}
            >
              {buildFallbackTitle(title)}
            </Text>
          )}
        </VStack>
      </HStack>
    </VStack>
  )
}

const SmallWidget = ({
  imageUrl,
  localImagePath,
}: Pick<WidgetViewProps, 'imageUrl' | 'localImagePath'>) => {
  return (
    <ZStack>
      <WidgetBackground imageUrl={imageUrl} localImagePath={localImagePath} />
    </ZStack>
  )
}

type TextWidgetProps = WidgetViewProps & {
  layout: TextOverlayLayout
}

const TextWidget = ({
  imageUrl,
  localImagePath,
  title,
  copyright,
  showTitle,
  showCopyright,
  layout,
}: TextWidgetProps) => {
  return (
    <ZStack>
      <WidgetBackground imageUrl={imageUrl} localImagePath={localImagePath} />
      <WidgetScrim />
      <WidgetTextOverlay
        title={title}
        copyright={copyright}
        showTitle={showTitle}
        showCopyright={showCopyright}
        layout={layout}
      />
    </ZStack>
  )
}

const UnsupportedWidget = () => {
  return (
    <VStack spacing={8} alignment="center" padding={16}>
      <Spacer />
      <Image
        systemName="photo.fill"
        font="title"
        foregroundStyle="systemBlue"
      />
      <Text font="body" foregroundStyle="label">
        ONE 每日图片
      </Text>
      <Text font="caption" foregroundStyle="secondaryLabel">
        当前尺寸暂未适配
      </Text>
      <Spacer />
    </VStack>
  )
}

const WidgetView = ({
  imageUrl,
  localImagePath,
  title,
  copyright,
  showTitle,
  showCopyright,
}: WidgetViewProps) => {
  switch (Widget.family) {
    case 'systemSmall':
      return <SmallWidget imageUrl={imageUrl} localImagePath={localImagePath} />

    case 'systemMedium':
      return (
        <TextWidget
          imageUrl={imageUrl}
          localImagePath={localImagePath}
          title={title}
          copyright={copyright}
          showTitle={showTitle}
          showCopyright={showCopyright}
          layout={MEDIUM_TEXT_LAYOUT}
        />
      )

    case 'systemLarge':
    case 'systemExtraLarge':
      return (
        <TextWidget
          imageUrl={imageUrl}
          localImagePath={localImagePath}
          title={title}
          copyright={copyright}
          showTitle={showTitle}
          showCopyright={showCopyright}
          layout={LARGE_TEXT_LAYOUT}
        />
      )

    default:
      return <UnsupportedWidget />
  }
}

const ErrorWidget = ({ message }: { message: string }) => {
  return (
    <VStack spacing={8} alignment="center" padding={16}>
      <Spacer />
      <Image
        systemName="wifi.exclamationmark"
        font="title2"
        foregroundStyle="systemOrange"
      />
      <Text font="body" foregroundStyle="label">
        ONE 每日图片
      </Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
        {message}
      </Text>
      <Spacer />
    </VStack>
  )
}

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return '未知错误'
}

const buildReloadPolicy = (retryRefresh: boolean): { policy: 'after'; date: Date } => {
  return {
    policy: 'after',
    date: retryRefresh ? getRetryRefreshDate() : getNextRefreshDate(),
  }
}

const presentWidget = async (): Promise<void> => {
  const settings = getCurrentSettings()
  const previousDisplayDate: string = settings.currentDisplayDate
  const forceRefresh: boolean = settings.autoRefresh && settings.displayMode === 'latest'

  addRefreshLog({
    status: 'start',
    message: '小组件被系统唤醒，交给系统调度下次刷新',
    forceRefresh,
  })

  addRefreshLog({
    status: 'start',
    message: forceRefresh ? '开始检查最新内容' : '开始加载显示内容',
    forceRefresh,
  })

  const wallpaperData = await getDisplayWallpaper(forceRefresh)
  const retryRefresh: boolean = shouldRetryRefreshAfterFetch(wallpaperData)

  const reloadPolicy = buildReloadPolicy(retryRefresh)
  const shouldNotifyReload: boolean =
    forceRefresh && !!previousDisplayDate && wallpaperData.rawDate !== previousDisplayDate

  addRefreshLog({
    status: 'start',
    message: '内容加载完成，开始准备图片缓存',
    forceRefresh,
    nextRefreshAt: reloadPolicy.date.getTime(),
    displayDate: wallpaperData.date,
  })

  const showTitle: boolean = BingSettingsManager.getShowTitle()
  const showCopyright: boolean = BingSettingsManager.getShowCopyright()
  const localImagePath: string | null =
    await ImageCacheManager.getCachedImagePath(wallpaperData.imageUrl)

  addRefreshLog({
    status: 'success',
    message: retryRefresh
      ? '当前内容仍不是今天，等待系统下次唤醒后继续检查'
      : forceRefresh
        ? '已检查并更新最新内容'
        : '已加载当前显示内容',
    forceRefresh,
    nextRefreshAt: reloadPolicy.date.getTime(),
    displayDate: wallpaperData.date,
  })

  Widget.present(
    <WidgetView
      imageUrl={wallpaperData.imageUrl}
      localImagePath={localImagePath || undefined}
      title={wallpaperData.title}
      copyright={wallpaperData.copyright}
      showTitle={showTitle}
      showCopyright={showCopyright}
    />,
    {
      reloadPolicy,
    },
  )

  if (shouldNotifyReload) {
    Widget.reloadAll()
  }
}

const presentErrorWidget = (error?: unknown): void => {
  const errorMessage: string = error ? formatErrorMessage(error) : '未知错误'

  const retryRefresh: boolean = true
  const reloadPolicy = buildReloadPolicy(retryRefresh)

  addRefreshLog({
    status: 'error',
    message: `加载失败，等待系统下次唤醒后重试：${errorMessage}`,
    forceRefresh: false,
    nextRefreshAt: reloadPolicy.date.getTime(),
  })

  Widget.present(<ErrorWidget message="加载失败，请稍后重试" />, {
    reloadPolicy,
  })
}

presentWidget().catch((error: unknown) => {
  presentErrorWidget(error)
})