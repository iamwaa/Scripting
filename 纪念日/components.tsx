import { Image, VStack, HStack, Text, Spacer, Button, Color, TextField } from 'scripting'
import { Person, AnniversaryEvent } from './types'
import { formatDateCN, formatLunar, getNextOccurrence, daysBetween, getAge, getYearsPassed, getReferenceDate, getWeddingAnniversaryName, getWeddingNameColor, formatElapsedYearsAndDays } from './dateUtils'

// 把六位十六进制颜色转成 rgba 字符串，用于设置带透明度的背景
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  }
}

function colorWithAlpha(hex: string, alpha: number): Color {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})` as Color
}

// 表单输入行：左侧标题 + 文本框 + 清空按钮
interface FormRowProps {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
}

export function FormRow({ label, value, prompt, onChanged }: FormRowProps) {
  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: 72, alignment: "leading" }}>{label}</Text>
      <TextField
        label={<Text>{label}</Text>}
        value={value}
        prompt={prompt}
        onChanged={onChanged}
      />
      {value.length > 0 ? (
        <Button action={() => onChanged('')} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
        </Button>
      ) : null}
    </HStack>
  )
}

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

const EVENT_TYPE_ICONS: Record<AnniversaryEvent['type'], { icon: string; color: string }> = {
  birthday: { icon: 'gift.fill', color: '#FF9500' },
  meet: { icon: 'hand.wave.fill', color: '#007AFF' },
  love: { icon: 'heart.fill', color: '#FF2D55' },
  wedding: { icon: 'heart.circle.fill', color: '#AF52DE' },
  enrollment: { icon: 'book.fill', color: '#34C759' },
  graduation: { icon: 'graduationcap.fill', color: '#5856D6' },
  join: { icon: 'briefcase.fill', color: '#5AC8FA' },
  custom: { icon: 'star.fill', color: '#FFCC00' }
}

// 人物关系标签样式
export const RELATIONSHIP_STYLES: Record<string, { icon: string; color: string }> = {
  '自己': { icon: 'person.fill', color: '#007AFF' },
  '伴侣': { icon: 'heart.fill', color: '#FF2D55' },
  '子女': { icon: 'person.2.fill', color: '#FF9500' },
  '家人': { icon: 'house.fill', color: '#34C759' },
  '朋友': { icon: 'person.2.fill', color: '#5856D6' },
  '同学': { icon: 'graduationcap.fill', color: '#5AC8FA' },
  '同事': { icon: 'briefcase.fill', color: '#AF52DE' },
  '其他': { icon: 'tag.fill', color: '#8E8E93' }
}

export const DEFAULT_RELATIONSHIP_STYLE = RELATIONSHIP_STYLES['其他']

// 通用胶囊标签
export interface CapsuleTagProps {
  label: string
  color?: string
  icon?: string
}

export function CapsuleTag({ label, color = '#8E8E93', icon }: CapsuleTagProps) {
  const tagColor = color as Color
  const backgroundColor = colorWithAlpha(color, 0.16)
  return (
    <HStack
      spacing={4}
      padding={{ vertical: 4, horizontal: 8 }}
      background={backgroundColor}
      clipShape={{ type: 'rect', cornerRadius: 10 }}
      alignment="center"
    >
      {icon ? <Image systemName={icon} font={9} foregroundStyle={tagColor} /> : null}
      <Text font={10} fontWeight="medium" foregroundStyle={tagColor}>{label}</Text>
    </HStack>
  )
}

// 关系胶囊标签
interface RelationshipTagProps {
  relationship?: string
}

export function RelationshipTag({ relationship }: RelationshipTagProps) {
  const label = relationship?.trim() || '未设置关系'
  const style = RELATIONSHIP_STYLES[label] ?? DEFAULT_RELATIONSHIP_STYLE
  return <CapsuleTag label={label} color={style.color} icon={style.icon} />
}

// 圆形滑动操作按钮（图标在上，文字在下）
interface SwipeActionButtonProps {
  icon: string
  label: string
  color: Color
  action: () => void
}

function SwipeActionButton({ icon, label, color, action }: SwipeActionButtonProps) {
  return (
    <Button action={action} tint={color}>
      <VStack alignment="center" spacing={2} frame={{ width: 56, height: 56 }} clipShape="circle">
        <Image systemName={icon} font={18} foregroundStyle="white" />
        <Text font={10} foregroundStyle="white">{label}</Text>
      </VStack>
    </Button>
  )
}

// 头像组件
interface AvatarProps {
  person: Person
  size?: number
}

export function Avatar({ person, size = 48 }: AvatarProps) {
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
  // 无头像时使用名字首字作为圆形文字头像
  const style = RELATIONSHIP_STYLES[person.relationship?.trim() || '其他'] ?? DEFAULT_RELATIONSHIP_STYLE
  const backgroundColor = colorWithAlpha(style.color, 0.16)
  const char = person.name.trim().charAt(0) || '?'
  return (
    <VStack
      frame={{ width: size, height: size }}
      background={backgroundColor}
      clipShape="circle"
      alignment="center"
    >
      <Text font={Math.max(12, size * 0.45)} fontWeight="semibold" foregroundStyle={style.color as Color}>
        {char}
      </Text>
    </VStack>
  )
}

// 空状态提示
interface EmptyStateProps {
  title: string
  subtitle?: string
  systemImage?: string
}

export function EmptyState({ title, subtitle, systemImage = "tray" }: EmptyStateProps) {
  return (
    <VStack padding spacing={12} alignment="center" frame={{ maxWidth: Infinity, minHeight: 240 }}>
      <Image systemName={systemImage} font={56} foregroundStyle="quaternaryLabel" />
      <VStack spacing={4} alignment="center">
        <Text fontWeight="semibold" font={17} foregroundStyle="secondaryLabel">{title}</Text>
        {subtitle ? <Text foregroundStyle="tertiaryLabel" font={14}>{subtitle}</Text> : null}
      </VStack>
    </VStack>
  )
}

// 人物卡片
interface PersonCardProps {
  person: Person
  eventCount: number
  onSelected?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
}

export function PersonCard({ person, eventCount, onSelected, onDelete, onTogglePin }: PersonCardProps) {
  const countText = eventCount > 0 ? `${eventCount} 个纪念日` : '暂无纪念日'
  const pinTitle = person.isPinned ? '取消置顶' : '置顶'

  return (
    <Button
      action={onSelected ?? (() => {})}
      trailingSwipeActions={{
        actions: [
          <SwipeActionButton key="置顶" icon={person.isPinned ? 'pin.slash' : 'pin.fill'} label={pinTitle} color="#FF9500" action={onTogglePin ?? (() => {})} />,
          <SwipeActionButton key="删除" icon="trash.fill" label="删除" color="systemRed" action={onDelete ?? (() => {})} />
        ]
      }}
    >
      <HStack spacing={16} padding={{ vertical: 12, horizontal: 16 }} frame={{ maxWidth: Infinity }} alignment="center">
        <Avatar person={person} size={58} />
        <VStack alignment="leading" spacing={5}>
          <Text fontWeight="semibold" font={18}>{person.name}</Text>
          <RelationshipTag relationship={person.relationship} />
        </VStack>
        <Spacer />
        <HStack spacing={4} alignment="center">
          <Text foregroundStyle="secondaryLabel" font={15}>{countText}</Text>
          <Image systemName="chevron.right" font={15} foregroundStyle="tertiaryLabel" />
        </HStack>
      </HStack>
    </Button>
  )
}

// 纪念日列表行
interface EventRowProps {
  event: AnniversaryEvent
  person: Person
  onSelected?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
}

export function EventRow({ event, person, onSelected, onDelete, onTogglePin }: EventRowProps) {
  const today = new Date()
  const nextDate = getNextOccurrence(event, today)
  const daysLeft = nextDate ? daysBetween(today, nextDate) : null
  const age = getAge(event, today)
  const yearsPassed = nextDate && event.repeatYearly
    ? getYearsPassed(event, nextDate.getFullYear())
    : undefined
  const refDate = getReferenceDate(event)

  const titleText = `${person.name} 的${event.title || EVENT_TYPE_LABELS[event.type]}`

  // 目标日相对今天的倒数/已过天数
  let countdownText = ''
  let countdownColor: 'systemRed' | 'accentColor' | 'secondaryLabel' = 'accentColor'
  if (daysLeft !== null) {
    if (daysLeft === 0) {
      countdownText = '今天'
      countdownColor = 'systemRed'
    } else if (daysLeft > 0) {
      countdownText = `${daysLeft} 天后`
      countdownColor = 'accentColor'
    } else {
      countdownText = `${Math.abs(daysLeft)} 天前`
      countdownColor = 'secondaryLabel'
    }
  }

  // 第二行：根据事件类型生成胶囊标签（ wedding 拆为“周年”和“婚名”两个标签）
  let subtitleTags: JSX.Element | null = null
  if (event.type === 'birthday' && age !== undefined) {
    subtitleTags = <CapsuleTag label={`${age} 岁`} color="#007AFF" />
  } else if (!event.repeatYearly) {
    subtitleTags = <CapsuleTag label="纪念日" color="#8E8E93" />
  } else if (event.type === 'love' && yearsPassed !== undefined) {
    subtitleTags = <CapsuleTag label={`${yearsPassed} 周年`} color="#FF2D55" />
  } else if (event.type === 'wedding' && yearsPassed !== undefined) {
    const anniversaryName = getWeddingAnniversaryName(yearsPassed)
    subtitleTags = (
      <HStack spacing={4} alignment="center">
        <CapsuleTag label={`${yearsPassed} 周年`} color="#FF2D55" />
        {anniversaryName ? <CapsuleTag label={anniversaryName} color={getWeddingNameColor(yearsPassed)} /> : null}
      </HStack>
    )
  } else if (refDate) {
    subtitleTags = <CapsuleTag label={formatElapsedYearsAndDays(refDate, today)} color="#5AC8FA" />
  }

  // 右下角日期：已过的显示设定日期，未来的显示下一个日期
  let targetDateText = ''
  const isPast = daysLeft !== null && daysLeft < 0
  if (isPast) {
    if (event.isLunar && event.lunarMonth && event.lunarDay) {
      targetDateText = formatLunar(event.lunarMonth, event.lunarDay, event.isLeapMonth)
    } else if (refDate) {
      targetDateText = formatDateCN(refDate)
    } else if (nextDate) {
      targetDateText = formatDateCN(nextDate)
    }
  } else if (nextDate) {
    targetDateText = formatDateCN(nextDate)
  } else if (refDate) {
    targetDateText = formatDateCN(refDate)
  }

  const pinTitle = event.isPinned ? '取消置顶' : '置顶'

  return (
    <Button
      action={onSelected ?? (() => {})}
      trailingSwipeActions={{
        actions: [
          <SwipeActionButton key="置顶" icon={event.isPinned ? 'pin.slash' : 'pin.fill'} label={pinTitle} color="#FF9500" action={onTogglePin ?? (() => {})} />,
          <SwipeActionButton key="删除" icon="trash.fill" label="删除" color="systemRed" action={onDelete ?? (() => {})} />
        ]
      }}
    >
      <HStack spacing={14} padding={{ vertical: 8, horizontal: 12 }} frame={{ maxWidth: Infinity }} alignment="center">
        <Avatar person={person} size={50} />
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity }}>
          <HStack frame={{ maxWidth: Infinity }}>
            <Text fontWeight="semibold" font={17} lineLimit={1}>{titleText}</Text>
            <Spacer />
            <Text fontWeight="bold" font={18} foregroundStyle={countdownColor}>{countdownText}</Text>
          </HStack>
          <HStack frame={{ maxWidth: Infinity }} spacing={6} alignment="center">
            {subtitleTags}
            <Spacer />
            <Text foregroundStyle="secondaryLabel" font={13} fontWeight="medium">{targetDateText}</Text>
          </HStack>
        </VStack>
      </HStack>
    </Button>
  )
}

// 人物详情页中的事件行（简洁版）
interface CompactEventRowProps {
  event: AnniversaryEvent
  person: Person
  onSelected?: () => void
}

// 纪念日类型图标
interface EventIconProps {
  type: AnniversaryEvent['type']
  size?: number
}

export function EventIcon({ type, size = 40 }: EventIconProps) {
  const { icon, color } = EVENT_TYPE_ICONS[type] ?? EVENT_TYPE_ICONS.custom
  const iconColor = color as Color
  const backgroundColor = colorWithAlpha(color, 0.13)
  return (
    <VStack
      frame={{ width: size, height: size }}
      alignment="center"
      background={backgroundColor}
      clipShape="circle"
    >
      <Image systemName={icon} font={26} foregroundStyle={iconColor} />
    </VStack>
  )
}

export function CompactEventRow({ event, onSelected }: CompactEventRowProps) {
  const nextDate = getNextOccurrence(event)
  const dateText = event.isLunar && event.lunarMonth && event.lunarDay
    ? formatLunar(event.lunarMonth, event.lunarDay, event.isLeapMonth)
    : (nextDate ? formatDateCN(nextDate) : '')
  return (
    <Button action={onSelected ?? (() => {})}>
      <HStack spacing={12} padding={{ vertical: 8, horizontal: 12 }} frame={{ maxWidth: Infinity }} alignment="center">
        <EventIcon type={event.type} size={50} />
        <VStack alignment="leading" spacing={4}>
          <Text fontWeight="semibold" font={17}>{event.title || EVENT_TYPE_LABELS[event.type]}</Text>
          <Text foregroundStyle="secondaryLabel" font={14}>{dateText}</Text>
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" font={14} foregroundStyle="tertiaryLabel" />
      </HStack>
    </Button>
  )
}
