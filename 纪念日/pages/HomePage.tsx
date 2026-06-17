import { NavigationStack, List, Section, Text, Button, Toolbar, ToolbarItem, useState, Image } from 'scripting'
import { AnniversaryEvent, Person, AppSettings } from '../types'
import { EventRow, EmptyState } from '../components'
import { buildOccurrenceList } from '../dateUtils'

interface HomePageProps {
  events: AnniversaryEvent[]
  persons: Person[]
  settings: AppSettings
  onClose: () => void
  onSelectEvent: (event: AnniversaryEvent) => void
  onDeleteEvent: (event: AnniversaryEvent) => void
  onTogglePinEvent: (event: AnniversaryEvent) => void
  onToggleCountdownFormatEvent: (event: AnniversaryEvent) => void
  onAddEvent?: () => void
}

export function HomePage({ events, persons, settings, onClose, onSelectEvent, onDeleteEvent, onTogglePinEvent, onToggleCountdownFormatEvent, onAddEvent }: HomePageProps) {
  const [eventToDelete, setEventToDelete] = useState<AnniversaryEvent | null>(null)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)

  const requestDeleteEvent = (event: AnniversaryEvent) => {
    setEventToDelete(event)
    setShowDeleteAlert(true)
  }

  const confirmDeleteEvent = () => {
    setShowDeleteAlert(false)
    if (eventToDelete) {
      onDeleteEvent(eventToDelete)
      setEventToDelete(null)
    }
  }

  const occurrences = buildOccurrenceList(
    events,
    (id) => persons.find(p => p.id === id),
    new Date()
  )

  // 置顶事件单独展示
  const pinned = occurrences.filter(item => item.event.isPinned).sort((a, b) => a.daysLeft - b.daysLeft)
  const unpinned = occurrences.filter(item => !item.event.isPinned)

  // 是否将已过的纪念日单独归入「纪念日」分组
  const groupPast = settings.groupPastEvents
  const upcoming = groupPast ? unpinned.filter(item => item.daysLeft >= 0) : unpinned
  const past = groupPast ? unpinned.filter(item => item.daysLeft < 0) : []

  // 按月份分组
  const grouped: Record<string, typeof occurrences> = {}
  for (const item of upcoming) {
    const key = `${item.nextDate.getFullYear()}-${String(item.nextDate.getMonth() + 1).padStart(2, '0')}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  }
  const sortedKeys = Object.keys(grouped).sort()

  // 已过纪念日按日期由新到旧排序
  const sortedPast = [...past].sort((a, b) => b.nextDate.getTime() - a.nextDate.getTime())

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="纪念日"
        navigationBarTitleDisplayMode="large"
        scrollIndicator="hidden"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button key="关闭" action={onClose}>
                <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
            {onAddEvent ? (
              <ToolbarItem placement="topBarTrailing">
                <Button
                  key="添加纪念日"
                  action={onAddEvent}
                >
                  <Image systemName="plus" fontWeight="semibold" />
                </Button>
              </ToolbarItem>
            ) : null}
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
              <Button title="删除" role="destructive" action={confirmDeleteEvent} />
            </>
          )
        }}
      >
        {occurrences.length === 0 ? (
          <EmptyState
            title="还没有纪念日"
            subtitle="去「人物」页添加重要的人与日子"
            systemImage="heart.text.square"
          />
        ) : (
          <>
            {pinned.length > 0 && (
              <Section title="置顶">
                {pinned.map(item => (
                  <EventRow
                    key={item.event.id}
                    event={item.event}
                    person={item.person as Person}
                    onSelected={() => onSelectEvent(item.event)}
                    onDelete={() => requestDeleteEvent(item.event)}
                    onTogglePin={() => onTogglePinEvent(item.event)}
                  onToggleCountdownFormat={() => onToggleCountdownFormatEvent(item.event)}
                  />
                ))}
              </Section>
            )}
            {sortedKeys.map(key => (
              <Section
                key={key}
                title={`${grouped[key][0].nextDate.getFullYear()}年${grouped[key][0].nextDate.getMonth() + 1}月`}
              >
                {grouped[key].map(item => (
                  <EventRow
                    key={item.event.id}
                    event={item.event}
                    person={item.person as Person}
                    onSelected={() => onSelectEvent(item.event)}
                    onDelete={() => requestDeleteEvent(item.event)}
                    onTogglePin={() => onTogglePinEvent(item.event)}
                  onToggleCountdownFormat={() => onToggleCountdownFormatEvent(item.event)}
                  />
                ))}
              </Section>
            ))}
            {sortedPast.length > 0 && (
              <Section title="纪念日">
                {sortedPast.map(item => (
                  <EventRow
                    key={item.event.id}
                    event={item.event}
                    person={item.person as Person}
                    onSelected={() => onSelectEvent(item.event)}
                    onDelete={() => requestDeleteEvent(item.event)}
                    onTogglePin={() => onTogglePinEvent(item.event)}
                  onToggleCountdownFormat={() => onToggleCountdownFormatEvent(item.event)}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </List>
    </NavigationStack>
  )
}
