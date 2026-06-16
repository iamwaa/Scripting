import { Navigation, NavigationStack, List, Section, Picker, Toggle, Stepper, Button, Text, HStack, VStack, Spacer, DatePicker, GeometryReader, Toolbar, ToolbarItem, Image } from 'scripting'
import { useState } from 'scripting'
import { AnniversaryEvent, Person, EventType, AppSettings } from '../types'
import { Avatar, FormRow, RelationshipTag } from '../components'
import { formatDateKey, formatDateCN, parseDateKey, getLunarParts, findGregorianDateForLunar, LUNAR_MONTH_NAMES, LUNAR_DAY_NAMES, getLunarYearGanZhi } from '../dateUtils'

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  birthday: '生日',
  meet: '相识',
  love: '恋爱',
  wedding: '结婚',
  enrollment: '入学',
  graduation: '毕业',
  join: '入职',
  custom: '其他'
}

// 各人物关系对应的可选纪念日内置类型
const RELATIONSHIP_EVENT_TYPES: Record<string, EventType[]> = {
  '自己': ['birthday', 'enrollment', 'graduation', 'join'],
  '伴侣': ['birthday', 'meet', 'love', 'wedding'],
  '子女': ['birthday', 'enrollment', 'graduation'],
  '家人': ['birthday'],
  '朋友': ['birthday', 'meet'],
  '同学': ['birthday', 'meet', 'graduation'],
  '同事': ['birthday', 'meet', 'join'],
  '其他': ['birthday', 'meet']
}

// 根据人物关系生成类型选项，始终保留“其他”和当前编辑的类型
function getEventTypeOptions(person: Person, currentType?: EventType): { value: EventType; label: string }[] {
  // 自定义关系（不在映射中的值）使用“其他”的过滤规则
  const allowed = RELATIONSHIP_EVENT_TYPES[person.relationship ?? ''] ??
    RELATIONSHIP_EVENT_TYPES['其他'] ??
    ['birthday']
  const merged = new Set<EventType>([...allowed, 'custom'])
  if (currentType && !merged.has(currentType)) {
    merged.add(currentType)
  }
  return Array.from(merged).map(value => ({ value, label: EVENT_TYPE_LABELS[value] }))
}

interface EventEditorPageProps {
  event?: AnniversaryEvent
  person: Person
  settings: AppSettings
  onSave: (event: AnniversaryEvent) => void
  onDelete?: (event: AnniversaryEvent) => void
}

export function EventEditorPage({ event, person, settings, onSave, onDelete }: EventEditorPageProps) {
  const dismiss = Navigation.useDismiss()
  const isNew = !event
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)

  const handleDelete = () => {
    setShowDeleteAlert(false)
    if (event && onDelete) {
      onDelete(event)
      dismiss()
    }
  }
  const today = new Date()
  const currentYear = today.getFullYear()

  // 初始化编辑状态
  const initialRef = event ? new Date(event.gregorianDate) : today
  const initialLunarParts = getLunarParts(initialRef)
  const initialLunar = event?.isLunar && event.lunarMonth && event.lunarDay
    ? {
      year: event.lunarYear ?? initialLunarParts.year,
      month: event.lunarMonth,
      day: event.lunarDay,
      isLeap: event.isLeapMonth
    }
    : {
      year: initialLunarParts.year,
      month: initialLunarParts.month,
      day: initialLunarParts.day,
      isLeap: initialLunarParts.isLeapMonth
    }

  const [title, setTitle] = useState(event?.title ?? '')
  const defaultTypes = RELATIONSHIP_EVENT_TYPES[person.relationship ?? ''] ?? ['birthday']
  const [type, setType] = useState<EventType>(event?.type ?? defaultTypes[0] ?? 'birthday')
  const isCustomType = type === 'custom'
  const eventTypeOptions = getEventTypeOptions(person, event?.type)
  const [isLunar, setIsLunar] = useState(event?.isLunar ?? false)
  const [gregorianDate, setGregorianDate] = useState<number>(initialRef.getTime())
  const [lunarYear, setLunarYear] = useState<number>(initialLunar.year)
  const [lunarMonth, setLunarMonth] = useState<number>(initialLunar.month)
  const [lunarDay, setLunarDay] = useState<number>(initialLunar.day)
  const [isLeapMonth, setIsLeapMonth] = useState<boolean>(initialLunar.isLeap)
  const [repeatYearly, setRepeatYearly] = useState(event?.repeatYearly ?? true)
  const [remindOnDay, setRemindOnDay] = useState(event?.remindOnDay ?? settings.defaultRemindOnDay)

  // 提前提醒：用一个开关控制是否启用，再用步进器设置提前天数
  const initialReminderDays = event?.reminderDays ?? settings.defaultReminderDays
  const initialAdvanceDays = initialReminderDays[0] ?? 1
  const [advanceEnabled, setAdvanceEnabled] = useState(initialReminderDays.length > 0 && initialAdvanceDays > 0)
  const [advanceDays, setAdvanceDays] = useState(initialAdvanceDays > 0 ? initialAdvanceDays : 1)
  const [reminderDays, setReminderDays] = useState<number[]>(initialReminderDays.length > 0 && initialAdvanceDays > 0 ? [initialAdvanceDays] : [])

  // 农历年份可选项范围
  const yearOptions = Array.from({ length: currentYear - 1900 + 2 }, (_, i) => currentYear + 1 - i)

  const MIN_ADVANCE_DAYS = 1
  const MAX_ADVANCE_DAYS = 30

  const handleAdvanceEnabledChanged = (enabled: boolean) => {
    setAdvanceEnabled(enabled)
    setReminderDays(enabled ? [advanceDays] : [])
  }

  const adjustAdvanceDays = (delta: number) => {
    const next = Math.max(MIN_ADVANCE_DAYS, Math.min(MAX_ADVANCE_DAYS, advanceDays + delta))
    setAdvanceDays(next)
    if (advanceEnabled) {
      setReminderDays([next])
    }
  }

  // 切换公历/农历开关时，根据当前值实时互转日期
  const handleIsLunarChanged = (value: boolean) => {
    if (value) {
      // 公历转农历
      const parts = getLunarParts(new Date(gregorianDate))
      setLunarYear(parts.year)
      setLunarMonth(parts.month)
      setLunarDay(parts.day)
      setIsLeapMonth(parts.isLeapMonth)
    } else {
      // 农历转公历
      const date = findGregorianDateForLunar(lunarMonth, lunarDay, isLeapMonth, lunarYear)
      if (date) {
        setGregorianDate(date.getTime())
      }
    }
    setIsLunar(value)
  }

  // 根据 lunar 字段计算当前应存储的公历基准日期（取所选农历年份对应的公历日期）
  const computeGregorianDate = (): string => {
    if (isLunar) {
      const date = findGregorianDateForLunar(lunarMonth, lunarDay, isLeapMonth, lunarYear)
      if (date) return formatDateKey(date)
      // 兜底：使用当前年
      const fallback = findGregorianDateForLunar(lunarMonth, lunarDay, false, currentYear)
      if (fallback) return formatDateKey(fallback)
    }
    return formatDateKey(new Date(gregorianDate))
  }

  const handleSave = () => {
    const trimmed = isCustomType
      ? title.trim() || '其他'
      : EVENT_TYPE_LABELS[type] || '纪念日'
    const gregorian = computeGregorianDate()
    const saved: AnniversaryEvent = {
      id: event?.id ?? '',
      personId: person.id,
      title: trimmed,
      type,
      isLunar,
      gregorianDate: gregorian,
      lunarYear: isLunar ? lunarYear : null,
      lunarMonth: isLunar ? lunarMonth : null,
      lunarDay: isLunar ? lunarDay : null,
      isLeapMonth: isLunar ? isLeapMonth : false,
      reminderDays,
      remindOnDay,
      repeatYearly,
      isPinned: event?.isPinned ?? false,
      createdAt: event?.createdAt ?? Date.now()
    }
    onSave(saved)
    dismiss()
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle={isNew ? '添加纪念日' : '编辑纪念日'}
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="返回" action={dismiss}>
                <Image systemName="chevron.left" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="保存" systemImage="square.and.arrow.down" fontWeight="semibold" action={handleSave} />
            </ToolbarItem>
          </Toolbar>
        }
        alert={{
          title: '删除纪念日',
          message: <Text>确定要删除这条纪念日吗？</Text>,
          isPresented: showDeleteAlert,
          onChanged: setShowDeleteAlert,
          actions: (
            <>
              <Button title="取消" role="cancel" action={() => setShowDeleteAlert(false)} />
              <Button title="删除" role="destructive" action={handleDelete} />
            </>
          )
        }}
      >
        <Section>
          <HStack spacing={16}>
            <Avatar person={person} size={68} />
            <VStack alignment="leading" spacing={5}>
              <Text fontWeight="semibold" font={24}>{person.name}</Text>
              <RelationshipTag relationship={person.relationship} />
            </VStack>
            <Spacer />
          </HStack>
        </Section>

        <Section>
          <Picker
            title="纪念日类型"
            value={type}
            onChanged={(v: string) => {
              const nextType = v as EventType
              setType(nextType)
              if (nextType !== 'custom') {
                setTitle('')
              }
            }}
            pickerStyle="menu"
          >
            {eventTypeOptions.map(opt => (
              <Text key={opt.value} tag={opt.value}>{opt.label}</Text>
            ))}
          </Picker>
          {isCustomType && (
            <FormRow label="名称" value={title} prompt="例如：相识纪念日" onChanged={setTitle} />
          )}
        </Section>

        <Section title="日期">
          <Toggle
            title="农历"
            value={isLunar}
            onChanged={handleIsLunarChanged}
          />
          {!isLunar ? (
            <DatePicker
              title="公历日期"
              value={gregorianDate}
              onChanged={setGregorianDate}
              displayedComponents={['date']}
            />
          ) : (
            <>
              {/* 农历行内占比：年份 3/7，月份与日期各 2/7 */}
              <GeometryReader>
                {({ size }) => {
                  const gap = 1
                  const total = size.width - gap * 2
                  return (
                    <HStack spacing={gap} frame={{ maxWidth: Infinity }}>
                      <Picker
                        title="年"
                        value={lunarYear}
                        onChanged={(v: number) => setLunarYear(v)}
                        pickerStyle="menu"
                        frame={{ width: total * 3.5 / 7.1 }}
                      >
                        {yearOptions.map(y => (
                          <Text key={String(y)} tag={y}>{y} 年（{getLunarYearGanZhi(y)}）</Text>
                        ))}
                      </Picker>
                      <Picker
                        title="月"
                        value={lunarMonth}
                        onChanged={(v: number) => setLunarMonth(v)}
                        pickerStyle="menu"
                        frame={{ width: total * 1.8 / 7.1 }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                          <Text key={String(m)} tag={m}>{LUNAR_MONTH_NAMES[m]}</Text>
                        ))}
                      </Picker>
                      <Picker
                        title="日"
                        value={lunarDay}
                        onChanged={(v: number) => setLunarDay(v)}
                        pickerStyle="menu"
                        frame={{ width: total * 1.8 / 7.1 }}
                      >
                        {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                          <Text key={String(d)} tag={d}>{LUNAR_DAY_NAMES[d]}</Text>
                        ))}
                      </Picker>
                    </HStack>
                  )
                }}
              </GeometryReader>
              <Toggle
                title="闰月"
                value={isLeapMonth}
                onChanged={setIsLeapMonth}
              />
              <Text foregroundStyle="secondaryLabel" font={14}>
                {(() => {
                  const key = computeGregorianDate()
                  const date = parseDateKey(key)
                  return date ? `对应公历：${formatDateCN(date)}` : ''
                })()}
              </Text>
            </>
          )}
          <Toggle
            title="每年重复"
            value={repeatYearly}
            onChanged={setRepeatYearly}
          />
        </Section>

        <Section title="提醒">
          <Toggle
            title="当天提醒"
            value={remindOnDay}
            onChanged={setRemindOnDay}
          />
          <Toggle
            title="提前提醒"
            value={advanceEnabled}
            onChanged={handleAdvanceEnabledChanged}
          />
          {advanceEnabled && (
            <Stepper
              title={`提前 ${advanceDays} 天`}
              onIncrement={() => adjustAdvanceDays(1)}
              onDecrement={() => adjustAdvanceDays(-1)}
            />
          )}
        </Section>

        {event && onDelete && (
          <Section>
            <HStack frame={{ maxWidth: Infinity }} alignment="center">
              <Button
                title="删除纪念日"
                role="destructive"
                action={() => setShowDeleteAlert(true)}
              />
            </HStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
