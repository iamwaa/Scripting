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
  Toggle,
  Stepper,
  TextField,
  useState,
} from "scripting"
import { AdGroup, GenOptions, GenResult } from "../types"
import { newId } from "../store"
import { generateRegex, testRegex } from "../regex"
import { presentAdEditor } from "./AdEditorPage"

// 取广告首行摘要
function snippet(text: string): string {
  const line = text.split("\n").map(s => s.trim()).find(s => s.length > 0) ?? ""
  return line.length > 42 ? line.slice(0, 42) + "…" : line
}

// 把用户一次输入拆成多个词（支持逗号 / 空格 / 换行分隔）
function splitWords(input: string): string[] {
  return input
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// 广告库详情页：管理广告、生成选项、关键词精修、生成与测试
export function GroupDetailPage({
  group,
  onChange,
}: {
  group: AdGroup
  onChange: (group: AdGroup) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [state, setState] = useState<AdGroup>(group)
  const [result, setResult] = useState<GenResult | null>(null)
  const [testText, setTestText] = useState("")

  // 更新并向上同步（持久化在父层处理）
  const update = (patch: Partial<AdGroup>) => {
    const next = { ...state, ...patch, updatedAt: Date.now() }
    setState(next)
    onChange(next)
  }

  const setOption = <K extends keyof GenOptions>(key: K, value: GenOptions[K]) => {
    update({ options: { ...state.options, [key]: value } })
  }

  // 广告增删改
  const addAd = async () => {
    const text = await presentAdEditor("新增广告", "")
    if (text != null && text.trim().length > 0) {
      update({ ads: [...state.ads, { id: newId(), text }] })
    }
  }
  const editAd = async (id: string) => {
    const target = state.ads.find(a => a.id === id)
    if (!target) return
    const text = await presentAdEditor("编辑广告", target.text)
    if (text != null) update({ ads: state.ads.map(a => (a.id === id ? { ...a, text } : a)) })
  }
  const deleteAd = (id: string) => update({ ads: state.ads.filter(a => a.id !== id) })

  // 自定义 / 排除关键词增删
  const addCustom = async () => {
    const input = await Dialog.prompt({
      title: "添加自定义关键词",
      message: "命中这些词一定判为广告；可用逗号或空格分隔多个",
      placeholder: "例如：趣连VPN 飞鸟",
    })
    if (input == null) return
    const words = splitWords(input)
    if (words.length) update({ customKeywords: [...new Set([...state.customKeywords, ...words])] })
  }
  const removeCustom = (kw: string) =>
    update({ customKeywords: state.customKeywords.filter(k => k !== kw) })

  const addExclude = async () => {
    const input = await Dialog.prompt({
      title: "添加排除关键词",
      message: "含这些词的自动关键词会被剔除，避免误伤；可分隔多个",
      placeholder: "例如：netflix chatgpt",
    })
    if (input == null) return
    const words = splitWords(input)
    if (words.length) update({ excludeKeywords: [...new Set([...state.excludeKeywords, ...words])] })
  }
  const removeExclude = (kw: string) =>
    update({ excludeKeywords: state.excludeKeywords.filter(k => k !== kw) })

  // 生成正则
  const generate = async () => {
    if (state.ads.length === 0 && state.customKeywords.length === 0) {
      await Dialog.alert({ message: "请先添加广告信息或自定义关键词。" })
      return
    }
    const res = generateRegex(state.ads, state.options, state.customKeywords, state.excludeKeywords)
    setResult(res)
    update({ regex: res.regex })
    if (res.regex.length === 0) {
      await Dialog.alert({ message: "未能提取到关键词，试着降低最小长度/出现次数，或手动添加自定义关键词。" })
    }
  }

  const copyRegex = async () => {
    if (!state.regex) return
    await Clipboard.copyText(state.regex) // Clipboard 为全局命名空间
    await Dialog.alert({ message: "正则已复制到剪贴板。" })
  }

  const opt = state.options
  // 实时测试结果
  const test = testRegex(state.regex, testText)

  return (
    <NavigationStack>
      <List
        navigationTitle={state.name}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="返回" action={dismiss} />,
          topBarTrailing: (
            <Button action={addAd}>
              <Image systemName="plus" />
            </Button>
          ),
        }}
      >
        {/* 广告信息列表 */}
        <Section
          header={<Text>广告信息（{state.ads.length}）</Text>}
          footer={<Text>右上角 + 添加广告；左滑可删除，点按可编辑。</Text>}
        >
          {state.ads.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">暂无广告，点右上角 + 添加。</Text>
          ) : (
            state.ads.map(ad => (
              <Button
                key={ad.id}
                action={() => editAd(ad.id)}
                buttonStyle="plain"
                trailingSwipeActions={{
                  actions: [<Button title="删除" tint="red" action={() => deleteAd(ad.id)} />],
                }}
              >
                <HStack spacing={10} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                  <Text>{snippet(ad.text)}</Text>
                </HStack>
              </Button>
            ))
          )}
        </Section>

        {/* 生成选项 */}
        <Section header={<Text>生成选项</Text>}>
          <Stepper
            onIncrement={() => setOption("minLen", Math.min(8, opt.minLen + 1))}
            onDecrement={() => setOption("minLen", Math.max(2, opt.minLen - 1))}
          >
            <VStack alignment="leading" spacing={2}>
              <Text>关键词最小长度：{opt.minLen}</Text>
              <Text font={12} foregroundStyle="secondaryLabel">中文短语的最少字数</Text>
            </VStack>
          </Stepper>
          <Stepper
            onIncrement={() =>
              setOption("minDocFreq", Math.min(Math.max(1, state.ads.length), opt.minDocFreq + 1))
            }
            onDecrement={() => setOption("minDocFreq", Math.max(1, opt.minDocFreq - 1))}
          >
            <VStack alignment="leading" spacing={2}>
              <Text>最小出现条数：{opt.minDocFreq}</Text>
              <Text font={12} foregroundStyle="secondaryLabel">
                值越大越精准（减少误伤），越小越全（减少漏匹配）
              </Text>
            </VStack>
          </Stepper>
          <Stepper
            onIncrement={() => setOption("maxKeywords", Math.min(200, opt.maxKeywords + 10))}
            onDecrement={() => setOption("maxKeywords", Math.max(10, opt.maxKeywords - 10))}
          >
            <Text>关键词上限：{opt.maxKeywords}</Text>
          </Stepper>
          <Toggle
            title="忽略大小写"
            value={opt.caseInsensitive}
            onChanged={v => setOption("caseInsensitive", v)}
          />
          <Toggle
            title="宽松匹配（容忍字间空格/emoji）"
            value={opt.looseMatch}
            onChanged={v => setOption("looseMatch", v)}
          />
          <Toggle
            title="包含 @频道用户名"
            value={opt.includeUsernames}
            onChanged={v => setOption("includeUsernames", v)}
          />
          <Toggle
            title="包含域名/链接"
            value={opt.includeDomains}
            onChanged={v => setOption("includeDomains", v)}
          />
          <Toggle
            title="用 (?:…) 包裹整体"
            value={opt.wrapGroup}
            onChanged={v => setOption("wrapGroup", v)}
          />
        </Section>

        {/* 自定义关键词（补漏） */}
        <Section
          header={
            <HStack frame={{ maxWidth: Infinity, alignment: "leading" }}>
              <Text>自定义关键词（{state.customKeywords.length}）</Text>
              <Button action={addCustom}>
                <Image systemName="plus.circle" />
              </Button>
            </HStack>
          }
          footer={<Text>手动补充一定要过滤的词，解决漏匹配。</Text>}
        >
          {state.customKeywords.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">无</Text>
          ) : (
            state.customKeywords.map(kw => (
              <HStack key={kw} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                <Text>{kw}</Text>
                <Button action={() => removeCustom(kw)} buttonStyle="plain">
                  <Image systemName="minus.circle.fill" foregroundStyle="red" />
                </Button>
              </HStack>
            ))
          )}
        </Section>

        {/* 排除关键词（防误伤） */}
        <Section
          header={
            <HStack frame={{ maxWidth: Infinity, alignment: "leading" }}>
              <Text>排除关键词（{state.excludeKeywords.length}）</Text>
              <Button action={addExclude}>
                <Image systemName="plus.circle" />
              </Button>
            </HStack>
          }
          footer={<Text>含这些词的自动关键词会被剔除，如 netflix、chatgpt 这类常见词，避免误伤正常消息。</Text>}
        >
          {state.excludeKeywords.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">无</Text>
          ) : (
            state.excludeKeywords.map(kw => (
              <HStack key={kw} frame={{ maxWidth: Infinity, alignment: "leading" }}>
                <Text>{kw}</Text>
                <Button action={() => removeExclude(kw)} buttonStyle="plain">
                  <Image systemName="minus.circle.fill" foregroundStyle="red" />
                </Button>
              </HStack>
            ))
          )}
        </Section>

        {/* 生成与结果 */}
        <Section
          header={<Text>正则表达式</Text>}
          footer={
            result ? (
              <Text>
                关键词 {result.keywords.length} · 用户名 {result.usernames.length} · 域名{" "}
                {result.domains.length} · 自定义 {result.customKeywords.length}
              </Text>
            ) : (
              <Text>点击“生成正则”后在此显示结果。</Text>
            )
          }
        >
          <Button action={generate}>
            <HStack spacing={8}>
              <Image systemName="wand.and.stars" />
              <Text>一键生成正则</Text>
            </HStack>
          </Button>
          {state.regex ? (
            <VStack
              alignment="leading"
              spacing={8}
              frame={{ maxWidth: Infinity, alignment: "leading" }}
            >
              <Text font={13} fontDesign="monospaced" textSelection={true}>
                {state.regex}
              </Text>
              <Button action={copyRegex}>
                <HStack spacing={8}>
                  <Image systemName="doc.on.doc" />
                  <Text>复制正则</Text>
                </HStack>
              </Button>
            </VStack>
          ) : null}
        </Section>

        {/* 测试 */}
        <Section
          header={<Text>测试匹配</Text>}
          footer={<Text>粘贴一条消息，实时验证当前正则会不会命中，便于排查误伤/漏匹配。</Text>}
        >
          <TextField
            label={<Text>测试文本</Text>}
            value={testText}
            prompt="粘贴一条消息试试…"
            axis="vertical"
            onChanged={setTestText}
          />
          {testText.trim().length > 0 ? (
            !state.regex ? (
              <Text foregroundStyle="secondaryLabel">请先生成正则</Text>
            ) : !test.ok ? (
              <Text foregroundStyle="orange">正则无效：{test.error}</Text>
            ) : test.matched ? (
              <HStack spacing={8}>
                <Image systemName="checkmark.circle.fill" foregroundStyle="green" />
                <Text>命中：{test.hit}</Text>
              </HStack>
            ) : (
              <HStack spacing={8}>
                <Image systemName="xmark.circle" foregroundStyle="secondaryLabel" />
                <Text foregroundStyle="secondaryLabel">未命中（不会被过滤）</Text>
              </HStack>
            )
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}
