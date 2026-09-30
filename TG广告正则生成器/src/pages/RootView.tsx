import {
  Navigation,
  NavigationStack,
  List,
  Section,
  HStack,
  VStack,
  Text,
  Button,
  Image,
  TextField,
  useState,
  useEffect,
} from "scripting"
import { AdGroup, defaultOptions } from "../types"
import { loadGroups, saveGroups, newId, STORAGE_FILE } from "../store"
import { combineRegexes, findMatches } from "../regex"
import { GroupDetailPage } from "./GroupDetailPage"

// NextDNS / 正则过滤设置页（Telegram 内打开）
const SETTINGS_URL = "https://t.me/nasettings/chat?p=ios&r=RegexFilters"

// 主页面：广告库列表管理
export function RootView() {
  const dismiss = Navigation.useDismiss()
  const [groups, setGroups] = useState<AdGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [testText, setTestText] = useState("")

  // 实时测试：遍历各分组正则，找出命中的分组与关键词
  const matches =
    testText.trim().length > 0
      ? findMatches(
          groups.map(g => ({ name: g.name, regex: g.regex })),
          testText
        )
      : []

  useEffect(() => {
    loadGroups().then(g => {
      setGroups(g)
      setLoaded(true)
    })
  }, [])

  // 统一更新并持久化
  const persist = (next: AdGroup[]) => {
    setGroups(next)
    saveGroups(next).catch(e => console.error("保存失败：" + String(e)))
  }

  // 新增广告库
  const addGroup = async () => {
    const name = await Dialog.prompt({
      title: "新建广告库",
      message: "给这组广告起个名字",
      placeholder: "例如：手游外挂 / VPN 广告",
    })
    if (name == null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    const group: AdGroup = {
      id: newId(),
      name: trimmed,
      ads: [],
      options: defaultOptions(),
      customKeywords: [],
      excludeKeywords: [],
      regex: "",
      updatedAt: Date.now(),
    }
    persist([...groups, group])
  }

  // 重命名
  const renameGroup = async (id: string) => {
    const target = groups.find(g => g.id === id)
    if (!target) return
    const name = await Dialog.prompt({
      title: "重命名",
      message: "输入新的名称",
      defaultValue: target.name,
    })
    if (name == null || name.trim().length === 0) return
    persist(groups.map(g => (g.id === id ? { ...g, name: name.trim(), updatedAt: Date.now() } : g)))
  }

  // 删除广告库（危险操作，需确认）
  const deleteGroup = async (id: string) => {
    const target = groups.find(g => g.id === id)
    if (!target) return
    const ok = await Dialog.confirm({
      title: "删除广告库",
      message: `确定删除「${target.name}」及其 ${target.ads.length} 条广告？此操作不可撤销。`,
    })
    if (ok === true) persist(groups.filter(g => g.id !== id))
  }

  // 复制所有分组的总集合正则
  const copyAllRegex = async () => {
    const combined = combineRegexes(groups.map(g => g.regex))
    if (!combined) {
      await Dialog.alert({ message: "还没有任何已生成的正则，请先在各分组里生成。" })
      return
    }
    await Clipboard.copyText(combined) // Clipboard 为全局命名空间
    const count = groups.filter(g => g.regex).length
    await Dialog.alert({ message: `已复制 ${count} 个分组的总集合正则到剪贴板。` })
  }

  // 跳转正则过滤设置
  const openSettings = () => {
    Safari.openURL(SETTINGS_URL)
  }

  // 打开详情
  const openGroup = async (id: string) => {
    const target = groups.find(g => g.id === id)
    if (!target) return
    await Navigation.present(
      <GroupDetailPage
        group={target}
        onChange={updated => {
          persist(groups.map(g => (g.id === updated.id ? updated : g)))
        }}
      />
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="广告正则生成器"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: (
            <Button action={addGroup}>
              <Image systemName="plus" />
            </Button>
          ),
        }}
      >
        {loaded ? (
          <Section header={<Text>工具</Text>}>
            <Button action={copyAllRegex}>
              <HStack spacing={10} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                <Image systemName="doc.on.doc" foregroundStyle="blue" />
                <Text>复制所有正则</Text>
              </HStack>
            </Button>
            <Button action={openSettings}>
              <HStack spacing={10} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                <Image systemName="arrow.up.forward.app" foregroundStyle="blue" />
                <Text>Nagram 设置</Text>
              </HStack>
            </Button>
          </Section>
        ) : null}
        {loaded ? (
          <Section
            header={<Text>测试匹配</Text>}
            footer={
              <Text>粘贴一条消息，看它会被哪些分组的正则命中（需先在分组里生成正则）。</Text>
            }
          >
            <TextField
              label={<Text>测试文本</Text>}
              value={testText}
              prompt="粘贴一条消息试试…"
              axis="vertical"
              onChanged={setTestText}
            />
            {testText.trim().length > 0 ? (
              matches.length > 0 ? (
                matches.map(m => (
                  <HStack
                    key={m.name}
                    spacing={8}
                    frame={{ maxWidth: Infinity, alignment: "leading" }}
                  >
                    <Image
                      systemName="checkmark.circle.fill"
                      foregroundStyle="green"
                      imageScale="small"
                    />
                    <Text>命中分组：{m.name}</Text>
                    <Text foregroundStyle="secondaryLabel">关键词：{m.hit}</Text>
                  </HStack>
                ))
              ) : (
                <HStack spacing={8}>
                  <Image
                    systemName="xmark.circle"
                    foregroundStyle="secondaryLabel"
                    imageScale="small"
                  />
                  <Text foregroundStyle="secondaryLabel">未命中任何分组（不会被过滤）</Text>
                </HStack>
              )
            ) : null}
          </Section>
        ) : null}
        {!loaded ? (
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        ) : groups.length === 0 ? (
          <Section footer={<Text>点右上角 + 新建一个广告库，填入多条广告后一键生成过滤正则。</Text>}>
            <Text foregroundStyle="secondaryLabel">还没有广告库</Text>
          </Section>
        ) : (
          <Section footer={<Text>数据保存在：{STORAGE_FILE}</Text>}>
            {groups.map(g => (
              <Button
                key={g.id}
                action={() => openGroup(g.id)}
                buttonStyle="plain"
                trailingSwipeActions={{
                  actions: [
                    <Button title="删除" tint="red" action={() => deleteGroup(g.id)} />,
                    <Button title="重命名" tint="blue" action={() => renameGroup(g.id)} />,
                  ],
                }}
              >
                <HStack spacing={12} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                  <Image systemName="folder.fill" foregroundStyle="blue" />
                  <VStack alignment="leading" spacing={2} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                    <Text>{g.name}</Text>
                    <Text font={12} foregroundStyle="secondaryLabel">
                      {g.ads.length} 条广告 · {g.regex ? "已生成正则" : "未生成"}
                    </Text>
                  </VStack>
                  <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font={13} />
                </HStack>
              </Button>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
