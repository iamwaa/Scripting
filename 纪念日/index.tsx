import { Script, Navigation, TabView, VStack, Text, Image, useObservable, useEffect, Widget } from 'scripting'
import { Person, AnniversaryEvent, AppData, AppSettings } from './types'
import { loadAppData, saveAppData, generateId, deleteAvatar } from './storage'
import { refreshNotifications } from './notifications'
import { HomePage } from './pages/HomePage'
import { PeoplePage } from './pages/PeoplePage'
import { SettingsPage } from './pages/SettingsPage'
import { PersonDetailPage } from './pages/PersonDetailPage'
import { PersonEditorPage } from './pages/PersonEditorPage'
import { PersonPickerPage } from './pages/PersonPickerPage'
import { EventEditorPage } from './pages/EventEditorPage'

function MainView() {
  const dismiss = Navigation.useDismiss()
  const persons = useObservable<Person[]>([])
  const events = useObservable<AnniversaryEvent[]>([])
  const settings = useObservable<AppSettings>({
    defaultReminderDays: [1, 3],
    defaultRemindOnDay: true,
    notificationsEnabled: true,
    groupPastEvents: true
  })
  const isLoading = useObservable(true)
  const selectedTab = useObservable(0)

  // 加载数据
  useEffect(() => {
    loadAppData().then((data: import('./types').AppData) => {
      persons.setValue(data.persons)
      events.setValue(data.events)
      settings.setValue(data.settings)
      isLoading.setValue(false)
      // 首次加载后刷新通知
      refreshNotifications(data.events, data.persons, data.settings)
    })
  }, [])

  // 持久化、刷新小组件与通知
  const commit = async (newPersons?: Person[], newEvents?: AnniversaryEvent[], newSettings?: AppSettings) => {
    const payload: AppData = {
      persons: newPersons ?? persons.value,
      events: newEvents ?? events.value,
      settings: newSettings ?? settings.value,
      version: 1
    }
    await saveAppData(payload)
    // 数据保存后立即请求刷新所有小组件，不等通知调度完成
    Widget.reloadAll()
    try {
      await refreshNotifications(payload.events, payload.persons, payload.settings)
    } catch (err) {
      console.log('刷新通知失败:', err)
    }
  }

  const handleSavePerson = async (person: Person) => {
    const list = [...persons.value]
    if (person.id) {
      const idx = list.findIndex(p => p.id === person.id)
      if (idx >= 0) list[idx] = person
    } else {
      person.id = generateId()
      list.push(person)
    }
    persons.setValue(list)
    await commit(list, undefined, undefined)
  }

  const handleDeletePerson = async (person: Person) => {
    const newEvents = events.value.filter(e => e.personId !== person.id)
    const newPersons = persons.value.filter(p => p.id !== person.id)
    persons.setValue(newPersons)
    events.setValue(newEvents)
    await deleteAvatar(person.avatarPath)
    await commit(newPersons, newEvents, undefined)
  }

  const handleSaveEvent = async (event: AnniversaryEvent) => {
    const list = [...events.value]
    if (event.id) {
      const idx = list.findIndex(e => e.id === event.id)
      if (idx >= 0) list[idx] = event
    } else {
      event.id = generateId()
      list.push(event)
    }
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleDeleteEvent = async (event: AnniversaryEvent) => {
    const list = events.value.filter(e => e.id !== event.id)
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleTogglePinEvent = async (event: AnniversaryEvent) => {
    const list = events.value.map(e =>
      e.id === event.id ? { ...e, isPinned: !e.isPinned } : e
    )
    events.setValue(list)
    await commit(undefined, list, undefined)
  }

  const handleTogglePinPerson = async (person: Person) => {
    const list = persons.value.map(p =>
      p.id === person.id ? { ...p, isPinned: !p.isPinned } : p
    )
    persons.setValue(list)
    await commit(list, undefined, undefined)
  }

  const handleClearAll = async () => {
    for (const person of persons.value) {
      await deleteAvatar(person.avatarPath)
    }
    persons.setValue([])
    events.setValue([])
    await commit([], [], settings.value)
  }

  const handleSettingsChange = async (newSettings: AppSettings) => {
    settings.setValue(newSettings)
    await commit(undefined, undefined, newSettings)
  }

  // 呈现人物编辑器
  const presentPersonEditor = (person?: Person) => {
    Navigation.present(
      <PersonEditorPage
        person={person}
        onSave={handleSavePerson}
      />
    )
  }

  // 呈现纪念日编辑器
  const presentEventEditor = (person: Person, event?: AnniversaryEvent) => {
    Navigation.present(
      <EventEditorPage
        event={event}
        person={person}
        settings={settings.value}
        onSave={handleSaveEvent}
        onDelete={event ? handleDeleteEvent : undefined}
      />
    )
  }

  // 新建人物并继续添加纪念日
  const presentNewPersonForEvent = async () => {
    const newPerson = await Navigation.present<Person>(
      <PersonEditorPage
        person={undefined}
        onSave={handleSavePerson}
      />
    )
    if (newPerson) {
      presentEventEditor(newPerson)
    }
  }

  // 在首页直接添加纪念日：先选人物（或新建人物），再进入编辑器
  const presentAddEvent = () => {
    Navigation.present(
      <PersonPickerPage
        persons={persons.value}
        onSelectPerson={(person) => presentEventEditor(person)}
        onCreatePerson={presentNewPersonForEvent}
      />
    )
  }

  // 呈现人物详情页（传入 Observable，使详情页可订阅实时刷新）
  const presentPersonDetail = (person: Person) => {
    Navigation.present(
      <PersonDetailPage
        person={person}
        persons={persons}
        events={events}
        onEdit={() => presentPersonEditor(persons.value.find(p => p.id === person.id) ?? person)}
        onAddEvent={() => presentEventEditor(persons.value.find(p => p.id === person.id) ?? person)}
        onEditEvent={(event) => {
          const latestPerson = persons.value.find(p => p.id === person.id) ?? person
          const latestEvent = events.value.find(e => e.id === event.id) ?? event
          presentEventEditor(latestPerson, latestEvent)
        }}
        onDeletePerson={() => handleDeletePerson(person)}
      />
    )
  }

  if (isLoading.value) {
    return (
      <TabView tabIndex={selectedTab.value}>
        <Text>加载中…</Text>
      </TabView>
    )
  }

  return (
    <TabView tabIndex={selectedTab.value}>
      <VStack tabItem={<><Image systemName="heart.text.square.fill" font={20} /><Text>纪念日</Text></>} tag={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <HomePage
          events={events.value}
          persons={persons.value}
          settings={settings.value}
          onClose={dismiss}
          onSelectEvent={(event: AnniversaryEvent) => {
            const person = persons.value.find((p: Person) => p.id === event.personId)
            if (person) presentEventEditor(person, event)
          }}
          onDeleteEvent={handleDeleteEvent}
          onTogglePinEvent={handleTogglePinEvent}
          onAddEvent={presentAddEvent}
        />
      </VStack>
      <VStack tabItem={<><Image systemName="person.2.fill" font={20} /><Text>人物</Text></>} tag={1} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <PeoplePage
          persons={persons.value}
          events={events.value}
          onClose={dismiss}
          onSelectPerson={presentPersonDetail}
          onAddPerson={() => presentPersonEditor()}
          onDeletePerson={handleDeletePerson}
          onTogglePinPerson={handleTogglePinPerson}
        />
      </VStack>
      <VStack tabItem={<><Image systemName="gearshape.fill" font={20} /><Text>设置</Text></>} tag={2} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <SettingsPage
          settings={settings.value}
          onClose={dismiss}
          onSettingsChange={handleSettingsChange}
          onClearAllData={handleClearAll}
        />
      </VStack>
    </TabView>
  )
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
