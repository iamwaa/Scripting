import { VStack, HStack, Text, Image, Widget, Spacer, Color, Divider, ZStack } from 'scripting'
import { AppData, AnniversaryEvent, Person } from './types'
import { loadAppData } from './storage'
import { resolveWidgetAvatarPath } from './widgetAvatar'
import { buildOccurrenceList, getReferenceDate, getWeddingAnniversaryName, getWeddingNameColor, formatElapsedYearsAndDays } from './dateUtils'
import { CapsuleTag, RELATIONSHIP_STYLES, DEFAULT_RELATIONSHIP_STYLE } from './components'

// 每种尺寸默认显示的纪念日数量
const FAMILY_LIMITS: Record<string, number> = {
  systemSmall: 1,
  systemMedium: 3,
  systemLarge: 7,
  systemExtraLarge: 6
}

// 纪念日类型标签（用于无自定义标题时显示）
const EVENT_TYPE_LABELS: Record<AnniversaryEvent['type'], string> = {
  birthday: '生日',
  meet: '相识',
  love: '恋爱',
  wedding: '结婚',
  enrollment: '入学',
  graduation: '毕业',
  join: '入职',
  custom: '其他'
}

// 计算后的一条纪念日记录
interface Occurrence {
  event: AnniversaryEvent
  person: Person
  nextDate: Date
  daysLeft: number
  age?: number
  yearsPassed?: number
}

// 每种 widget 尺寸对应的字号、尺寸与行高参数
interface LayoutParams {
  avatarSize: number
  titleFont: number
  dateFont: number
  daysFont: number
  rowHeight: number
  rowSpacing: number
  numberWidth: number
}

const LAYOUT_PARAMS: Record<string, LayoutParams> = {
  systemSmall: { avatarSize: 38, titleFont: 15, dateFont: 11, daysFont: 80, rowHeight: 0, rowSpacing: 0, numberWidth: 0 },
  systemMedium: { avatarSize: 34, titleFont: 15, dateFont: 11, daysFont: 30, rowHeight: 0, rowSpacing: 12, numberWidth: 80 },
  systemLarge: { avatarSize: 34, titleFont: 15, dateFont: 11, daysFont: 30, rowHeight: 0, rowSpacing: 12, numberWidth: 80 }
}

// 根据当前 widget 尺寸获取条数与布局参数
function getDisplayLimit(): number {
  return FAMILY_LIMITS[Widget.family as string] ?? 1
}

function getLayoutParams(): LayoutParams {
  return LAYOUT_PARAMS[Widget.family as string] ?? LAYOUT_PARAMS.systemMedium
}

// 将十六进制颜色转为带透明度的 rgba
function colorWithAlpha(hex: string, alpha: number): Color {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})` as Color
}

// 短日期格式：6月18日 · 星期四
function formatDateShortWithWeekday(date: Date): string {
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`
}

// 事件标题
function formatEventTitle(event: AnniversaryEvent, person: Person): string {
  return `${person.name}的${event.title || EVENT_TYPE_LABELS[event.type]}`
}

// 倒计天数显示：0 天显示为“今天”
function formatDaysLeft(daysLeft: number): string {
  return daysLeft === 0 ? '今天' : String(daysLeft)
}

// 小号组件天数字号：位数越多字号越小，避免 4 位数被截断
function getSmallDaysFont(daysLeft: number): number {
  if (daysLeft === 0) return 48
  const digits = String(daysLeft).length
  if (digits <= 2) return 80
  if (digits === 3) return 64
  return 48
}

// 人物头像：有头像则显示图片，否则用名字首字作为圆形文字头像
function PersonAvatar({ person, size }: { person: Person; size: number }) {
  const style = RELATIONSHIP_STYLES[person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const backgroundColor = colorWithAlpha(style.color, 0.16)
  const foregroundColor = style.color as Color

  if (person.avatarPath) {
    return (
      <Image
        filePath={person.avatarPath}
        resizable
        scaleToFill
        frame={{ width: size, height: size }}
        clipShape="circle"
      />
    )
  }

  const char = person.name.trim().charAt(0) || '?'
  return (
    <VStack
      frame={{ width: size, height: size }}
      background={backgroundColor}
      clipShape="circle"
      alignment="center"
    >
      <Text font={Math.max(12, size * 0.45)} fontWeight="semibold" foregroundStyle={foregroundColor}>
        {char}
      </Text>
    </VStack>
  )
}

// 副标题胶囊标签：生日显示年龄、恋爱/结婚显示周年、一次性事件显示“纪念日”等
function EventSubtitleTags({ item }: { item: Occurrence }) {
  const event = item.event

  if (event.type === 'birthday' && item.age !== undefined) {
    return <CapsuleTag label={`${item.age} 岁`} color="#007AFF" />
  }

  if (!event.repeatYearly) {
    return <CapsuleTag label="纪念日" color="#8E8E93" />
  }

  if (event.type === 'love' && item.yearsPassed !== undefined) {
    return <CapsuleTag label={`${item.yearsPassed} 周年`} color="#FF2D55" />
  }

  if (event.type === 'wedding' && item.yearsPassed !== undefined) {
    const anniversaryName = getWeddingAnniversaryName(item.yearsPassed)
    return (
      <HStack spacing={4} alignment="center">
        <CapsuleTag label={`${item.yearsPassed} 周年`} color="#FF2D55" />
        {anniversaryName ? <CapsuleTag label={anniversaryName} color={getWeddingNameColor(item.yearsPassed)} /> : null}
      </HStack>
    )
  }

  const ref = getReferenceDate(event)
  if (ref) {
    return <CapsuleTag label={formatElapsedYearsAndDays(ref, new Date())} color="#5AC8FA" />
  }

  return null
}

// 中号/大号共用的单行纪念日视图
function EventListRow({ item }: { item: Occurrence }) {
  const params = getLayoutParams()
  const title = formatEventTitle(item.event, item.person)
  const dateText = formatDateShortWithWeekday(item.nextDate)
  const daysColor: Color = item.daysLeft === 0 ? 'systemRed' : (item.daysLeft > 0 ? 'accentColor' : 'secondaryLabel')

  return (
    <HStack
      spacing={params.rowSpacing}
      frame={{ maxWidth: Infinity }}
      alignment="center"
    >
      <PersonAvatar person={item.person} size={params.avatarSize} />
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: Infinity }}>
        <HStack spacing={5} alignment="center">
          <Text fontWeight="bold" font={params.titleFont} lineLimit={1}>{title}</Text>
          <EventSubtitleTags item={item} />
        </HStack>
        <Text font={params.dateFont} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: Infinity, alignment: 'leading' }}>{dateText}</Text>
      </VStack>
      <HStack frame={{ width: params.numberWidth, alignment: 'trailing' }}>
        <Text fontWeight="semibold" fontDesign="rounded" font={params.daysFont} foregroundStyle={daysColor}>
          {formatDaysLeft(item.daysLeft)}
        </Text>
      </HStack>
    </HStack>
  )
}

// 小号 widget：大数字居中，标题与标签聚合在顶部，日期置底
function SmallWidgetView({ item }: { item: Occurrence }) {
  const title = formatEventTitle(item.event, item.person)
  const dateText = formatDateShortWithWeekday(item.nextDate)
  const daysColor: Color = item.daysLeft === 0 ? 'systemRed' : (item.daysLeft > 0 ? 'accentColor' : 'secondaryLabel')
  const params = getLayoutParams()

  return (
    <ZStack frame={{ maxWidth: Infinity, maxHeight: Infinity }} alignment="center" padding={14}>
      <Text fontWeight="semibold" fontDesign="rounded" font={getSmallDaysFont(item.daysLeft)} foregroundStyle={daysColor} offset={{ x: 0, y: 12 }} lineLimit={1}>
        {formatDaysLeft(item.daysLeft)}
      </Text>
      <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }} alignment="center">
        <HStack spacing={0} alignment="center" frame={{ maxWidth: Infinity }}>
          <PersonAvatar person={item.person} size={params.avatarSize} />
          <VStack alignment="leading" spacing={0} frame={{ maxWidth: Infinity }}>
            <Text fontWeight="bold" font={params.titleFont} lineLimit={1}>{title}</Text>
            <EventSubtitleTags item={item} />
          </VStack>
        </HStack>
        <Spacer />
        <Text foregroundStyle="secondaryLabel" font={params.dateFont}>{dateText}</Text>
      </VStack>
    </ZStack>
  )
}

// 空状态提示
function EmptyWidgetView() {
  return (
    <VStack spacing={8} alignment="center" frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
      <Image systemName="calendar.badge.clock" font={36} foregroundStyle="quaternaryLabel" />
      <Text fontWeight="semibold" font={14} foregroundStyle="secondaryLabel">还没有纪念日</Text>
      <Text font={11} foregroundStyle="tertiaryLabel">打开应用添加重要日子</Text>
    </VStack>
  )
}

// 空占位行：保持与数据行相同高度，维持布局一致
function PlaceholderRow() {
  const params = getLayoutParams()
  return (
    <HStack frame={{ maxWidth: Infinity, height: params.avatarSize }} />
  )
}

// 中号/大号列表视图：行间距固定为 10，列表上下也保留 10
function ListWidgetView({ items }: { items: Occurrence[] }) {
  const params = getLayoutParams()
  const limit = getDisplayLimit()
  const placeholderCount = Math.max(0, limit - items.length)

  const rows = [
    ...items.map(item => ({ type: 'item' as const, item })),
    ...Array.from({ length: placeholderCount }, (_, i) => ({ type: 'placeholder' as const, index: i }))
  ]

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      alignment="leading"
      padding={{ horizontal: 14, vertical: 10 }}
    >
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1
        const rowKey = row.type === 'item' ? row.item.event.id : `placeholder-${row.index}`
        return (
          <VStack key={rowKey} spacing={0} frame={{ maxWidth: Infinity }}>
            {row.type === 'item' ? <EventListRow item={row.item} /> : <PlaceholderRow />}
            {!isLast ? (
              <>
                <VStack frame={{ height: 10 }} />
                <Divider padding={{ leading: params.avatarSize + params.rowSpacing }} />
                <VStack frame={{ height: 10 }} />
              </>
            ) : null}
          </VStack>
        )
      })}
    </VStack>
  )
}

// 根视图：按尺寸决定展示数量与布局
function WidgetView({ occurrences }: { occurrences: Occurrence[] }) {
  const limit = getDisplayLimit()
  const items = occurrences.slice(0, limit)

  if (items.length === 0) {
    return <EmptyWidgetView />
  }

  if (limit === 1) {
    return <SmallWidgetView item={items[0]} />
  }

  return <ListWidgetView items={items} />
}

// 将人物头像替换为小组件专用缩略图路径（首次会按需生成缓存）
async function resolvePersonsWidgetAvatars(persons: Person[]): Promise<Person[]> {
  return Promise.all(
    persons.map(async (person) => {
      if (!person.avatarPath) return person
      const widgetPath = await resolveWidgetAvatarPath(person.avatarPath)
      return widgetPath ? { ...person, avatarPath: widgetPath } : person
    })
  )
}

// 读取数据并按首页规则排序：置顶优先，其次即将到来的纪念日
async function prepareOccurrences(): Promise<Occurrence[]> {
  let data: AppData
  try {
    data = await loadAppData()
  } catch {
    return []
  }

  const persons = await resolvePersonsWidgetAvatars(data.persons)
  const personMap = new Map(persons.map(p => [p.id, p]))
  const list = buildOccurrenceList(data.events, id => personMap.get(id), new Date()) as Occurrence[]

  const pinned = list.filter(item => item.event.isPinned && item.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)
  const upcoming = list.filter(item => !item.event.isPinned && item.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)
  return [...pinned, ...upcoming]
}

// 异步加载后呈现小组件
async function run() {
  const occurrences = await prepareOccurrences()
  Widget.present(<WidgetView occurrences={occurrences} />)
}

run()
