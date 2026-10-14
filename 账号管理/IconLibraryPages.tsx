import { useEffect, useMemo, useState, NavigationStack, List, Section, HStack, VStack, Text, Button, Spacer, Image, Navigation } from "scripting"

import { AvatarIcon } from "./components"
import {
  IconLibrary, IconLibraryEntry, IconPrefetch, LIBRARY_STALE_MS, clearIconCache, formatBytes,
  getIconCacheInfo, loadIconLibraries, prefetchIcons, refreshIconLibrary, saveIconLibraries, subscribeIconLibrary,
} from "./icons"

// 每行展示的图标数量
const COLUMNS = 4

// 搜索时最多预取多少个命中图标：关键词太宽泛时不必把整库都拉下来
const MAX_SEARCH_PREFETCH = 60

const chunkEntries = (entries: IconLibraryEntry[], size: number): IconLibraryEntry[][] => {
  const rows: IconLibraryEntry[][] = []
  for (let i = 0; i < entries.length; i += size) rows.push(entries.slice(i, i + size))
  return rows
}

const emptyCell = (key: string) => <VStack key={key} frame={{ maxWidth: "infinity" }} />

const IconCell = ({ entry, selected, onPick }: { entry: IconLibraryEntry; selected: boolean; onPick: (url: string) => void }) => (
  <Button buttonStyle="plain" action={() => onPick(entry.url)}>
    <VStack spacing={4} padding={{ vertical: 6, horizontal: 2 }} frame={{ maxWidth: "infinity" }} background={selected ? "quaternarySystemFill" : undefined} clipShape={{ type: "rect", cornerRadius: 10 }}>
      <AvatarIcon url={entry.url} name={entry.name} size={42} />
      <Text font={10} lineLimit={1} foregroundStyle={selected ? "#007AFF" : "#8E8E93"}>{entry.name}</Text>
    </VStack>
  </Button>
)

// 图标选择器：展示已订阅图标库中的图标，点选后回填图标链接
export const IconPickerPage = ({ currentUrl, onPick }: { currentUrl?: string; onPick: (url: string) => void }) => {
  const dismiss = Navigation.useDismiss()
  const [libraries, setLibraries] = useState<IconLibrary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError, isPresented: true })

  // 逐个刷新并写回本地，失败时保留原有图标
  const refreshAll = async (source: IconLibrary[]) => {
    setRefreshing(true)
    let next = source
    for (const library of source) {
      const updated = await refreshIconLibrary(library)
      next = next.map(item => item.id === library.id ? updated : item)
      setLibraries(next)
    }
    await saveIconLibraries(next)
    setRefreshing(false)
    if (next.some(lib => lib.lastError)) showToast("部分图标库刷新失败", true)
  }

  useEffect(() => {
    let alive = true
    loadIconLibraries().then(libs => {
      if (!alive) return
      setLibraries(libs)
      setLoading(false)
      // 订阅内容过期或尚未成功拉取时，后台自动刷新一次
      if (libs.some(lib => !lib.updatedAt || lib.icons.length === 0 || Date.now() - lib.updatedAt > LIBRARY_STALE_MS)) refreshAll(libs)
    })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return libraries
    return libraries
      .map(lib => ({ ...lib, icons: lib.icons.filter(entry => entry.name.toLowerCase().includes(keyword) || entry.url.toLowerCase().includes(keyword)) }))
      .filter(lib => lib.icons.length > 0)
  }, [libraries, query])

  // 搜索命中的图标优先下载：一边输入一边就能在结果里看到真实的图标。
  // 关键词变化时取消上一批还没开始的下载，避免旧结果占着队列。
  useEffect(() => {
    if (!query.trim()) return
    const urls: string[] = []
    for (const library of filtered) {
      for (const entry of library.icons) {
        if (urls.length >= MAX_SEARCH_PREFETCH) break
        urls.push(entry.url)
      }
      if (urls.length >= MAX_SEARCH_PREFETCH) break
    }
    let handle: IconPrefetch | null = null
    // 略微防抖，避免连续输入时每个字符都发一批
    const timer = setTimeout(() => { handle = prefetchIcons(urls) }, 150)
    return () => { clearTimeout(timer); handle?.cancel() }
  }, [filtered])

  const handlePick = (url: string) => { onPick(url); dismiss() }

  return (
    <NavigationStack>
      <List
        navigationTitle="选择图标"
        navigationBarTitleDisplayMode="inline"
        searchable={{ value: query, onChanged: setQuery, placement: "navigationBarDrawerAlwaysDisplay", prompt: "搜索图标" }}
        toast={{ isPresented: toast.isPresented, onChanged: (v: boolean) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><Text foregroundStyle="#007AFF">取消</Text></Button>,
          topBarTrailing: <Button action={() => refreshAll(libraries)}><Image systemName="arrow.clockwise" foregroundStyle={refreshing ? "#C7C7CC" : "#007AFF"} /></Button>,
        }}
      >
        {loading ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Text foregroundStyle="#8E8E93" font={15}>正在加载图标库…</Text></VStack>
        ) : libraries.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center">
            <Image systemName="square.grid.2x2" foregroundStyle="#C7C7CC" font={40} />
            <Text foregroundStyle="#8E8E93" font={15} padding={{ top: 12 }}>尚未订阅图标库</Text>
            <Text foregroundStyle="#8E8E93" font={13} padding={{ top: 4 }}>请到 设置 → 图标库订阅 添加图标库地址</Text>
          </VStack>
        ) : filtered.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Text foregroundStyle="#8E8E93" font={15}>没有匹配的图标</Text></VStack>
        ) : (
          filtered.map(library => (
            <Section
              key={library.id}
              header={<Text>{library.name}</Text>}
              footer={library.lastError ? <Text font={12} foregroundStyle="#FF3B30">刷新失败：{library.lastError}</Text> : undefined}
            >
              {chunkEntries(library.icons, COLUMNS).map((row, index) => (
                <HStack key={`${library.id}-${index}`} spacing={8} onAppear={() => prefetchIcons(row.map(entry => entry.url))}>
                  {row.map(entry => <IconCell key={entry.url} entry={entry} selected={entry.url === currentUrl} onPick={handlePick} />)}
                  {Array.from({ length: COLUMNS - row.length }).map((_, i) => emptyCell(`${library.id}-${index}-empty-${i}`))}
                </HStack>
              ))}
            </Section>
          ))
        )}
      </List>
    </NavigationStack>
  )
}

// 图标库订阅管理：添加/刷新/删除订阅，并查看与清理图标缓存
export const IconLibraryPage = () => {
  const dismiss = Navigation.useDismiss()
  const [libraries, setLibraries] = useState<IconLibrary[]>([])
  const [loading, setLoading] = useState(true)
  const [cache, setCache] = useState<{ count: number; bytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState({ msg: "", isError: false, isPresented: false })
  const showToast = (msg: string, isError = false) => setToast({ msg, isError, isPresented: true })

  const loadCacheInfo = async () => setCache(await getIconCacheInfo())

  useEffect(() => {
    loadIconLibraries().then(libs => { setLibraries(libs); setLoading(false) }).catch(console.error)
    loadCacheInfo().catch(console.error)
  }, [])

  const persist = async (next: IconLibrary[]) => { setLibraries(next); await saveIconLibraries(next) }

  const addLibrary = async () => {
    const url = await Dialog.prompt({ title: "订阅图标库", message: "请输入图标库 JSON 地址", placeholder: "https://example.com/icons.json" })
    if (!url?.trim()) return
    setBusy(true)
    try {
      const library = await subscribeIconLibrary(url.trim())
      const name = await Dialog.prompt({ title: "图标库名称", message: "为该图标库取一个名称", defaultValue: library.name })
      if (name?.trim()) library.name = name.trim()
      if (libraries.some(lib => lib.url === library.url)) { showToast("该图标库已订阅", true); return }
      await persist([...libraries, library])
      showToast(`已订阅「${library.name}」，共 ${library.icons.length} 个图标`)
    } catch { showToast("订阅失败：请检查地址与返回格式", true) } finally { setBusy(false) }
  }

  const refreshOne = async (library: IconLibrary) => {
    setBusy(true)
    try {
      const updated = await refreshIconLibrary(library)
      await persist(libraries.map(item => item.id === library.id ? updated : item))
      if (updated.lastError) showToast(`刷新失败：${updated.lastError}`, true)
      else showToast(`已更新「${updated.name}」，共 ${updated.icons.length} 个图标`)
    } finally { setBusy(false) }
  }

  const removeLibrary = async (library: IconLibrary) => {
    if (!await Dialog.confirm({ title: "取消订阅", message: `确定要移除「${library.name}」吗？已缓存的图标不会被删除。` })) return
    await persist(libraries.filter(item => item.id !== library.id))
    showToast("已移除订阅")
  }

  const handleClearCache = async () => {
    if (!await Dialog.confirm({ title: "清空图标缓存", message: "确定要清空本地图标缓存吗？图标将在下次显示时重新下载。" })) return
    await clearIconCache()
    await loadCacheInfo()
    showToast("图标缓存已清空")
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="图标库订阅"
        navigationBarTitleDisplayMode="inline"
        toast={{ isPresented: toast.isPresented, onChanged: (v: boolean) => { if (!v) setToast(prev => ({ ...prev, isPresented: false })) }, message: toast.msg || " ", position: "top", textColor: toast.isError ? "#FF3B30" : undefined }}
        toolbar={{
          topBarLeading: <Button action={() => dismiss()}><HStack spacing={5}><Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF" /></HStack></Button>,
          topBarTrailing: <Button action={addLibrary}><Image systemName="plus" foregroundStyle={busy ? "#C7C7CC" : "#007AFF"} fontWeight="semibold" /></Button>,
        }}
      >
        {loading ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center"><Text foregroundStyle="#8E8E93" font={15}>正在加载…</Text></VStack>
        ) : libraries.length === 0 ? (
          <VStack padding={40} frame={{ maxWidth: "infinity" }} alignment="center">
            <Image systemName="square.grid.2x2" foregroundStyle="#C7C7CC" font={40} />
            <Text foregroundStyle="#8E8E93" font={15} padding={{ top: 12 }}>尚未订阅图标库</Text>
            <Text foregroundStyle="#8E8E93" font={13} padding={{ top: 4 }}>点击右上角 + 添加图标库地址</Text>
          </VStack>
        ) : (
          <Section
            header={<Text>已订阅图标库</Text>}
            footer={<Text font={12} foregroundStyle="#8E8E93">订阅地址需返回图标数组（每项包含 name 与 url），也支持 selfh.st/icons 索引地址；订阅后即可在新增或编辑信息时从图标库选择图标，图标会缓存在本地。</Text>}
          >
            {libraries.map(library => (
              <HStack key={library.id} alignment="center" spacing={12} padding={{ vertical: 6 }} contextMenu={{ menuItems: <Button action={() => removeLibrary(library)} tint="red"><Text>取消订阅</Text><Image systemName="trash" /></Button> }}>
                <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
                  <Text font={16}>{library.name}</Text>
                  <Text font={12} lineLimit={1} foregroundStyle="#8E8E93">{library.url}</Text>
                  <Text font={12} foregroundStyle={library.lastError ? "#FF3B30" : "#8E8E93"}>
                    {library.lastError
                      ? `刷新失败：${library.lastError}`
                      : `${library.icons.length} 个图标${library.updatedAt ? ` · 更新于 ${new Date(library.updatedAt).toLocaleDateString()}` : " · 尚未刷新"}`}
                  </Text>
                </VStack>
                <Button action={() => refreshOne(library)} buttonStyle="bordered" controlSize="small"><Text>刷新</Text></Button>
              </HStack>
            ))}
          </Section>
        )}
        <Section header={<Text>图标缓存</Text>} footer={<Text font={12} foregroundStyle="#8E8E93">图标首次显示时会下载到本地缓存，之后不再重复请求网络，加载更快也更省流量。</Text>}>
          <HStack alignment="center" padding={{ vertical: 6 }}>
            <VStack alignment="leading" spacing={4}>
              <Text font={16}>已缓存图标</Text>
              <Text font={12} foregroundStyle="#8E8E93">{cache ? `${cache.count} 个 · ${formatBytes(cache.bytes)}` : "统计中…"}</Text>
            </VStack>
            <Spacer />
            <Button action={handleClearCache} disabled={!cache || cache.count === 0}><Text foregroundStyle={cache && cache.count > 0 ? "#FF3B30" : "#C7C7CC"}>清空缓存</Text></Button>
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
