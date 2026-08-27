import { Button, Form, HStack, Image, Navigation, NavigationLink, NavigationStack, Picker, Section, Text, TextField, VStack, useEffect, useState } from "scripting"
import { fetchModels, executeTest } from "../api/openaiCompatible"
import { AppConfig, ModelInfo, TestMode, TestResult, ThinkingLevel } from "../types"
import { thinkingLevels } from "../constants"
import { FormRow } from "../components/FormRow"
import { ModelDetailPage } from "./ModelDetailPage"
import { evaluateQuestionTest } from "../utils/candyTest"
import { isValidHtml } from "../utils/htmlTest"

type Activity = "idle" | "models" | "testing"

export function HomePage({ config, onConfigChanged }: { config: AppConfig; onConfigChanged: (config: AppConfig) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [results, setResults] = useState<TestResult[]>([])
  const [mode, setMode] = useState<TestMode>("chat")
  const [modelSearch, setModelSearch] = useState("")
  const [activity, setActivity] = useState<Activity>("idle")
  const [testingModelID, setTestingModelID] = useState<string | null>(null)
  const [testingStartedAt, setTestingStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [testingProgress, setTestingProgress] = useState("")
  const [selectionMode, setSelectionMode] = useState(false)
  const [modelButtonTitle, setModelButtonTitle] = useState("获取模型列表")
  const [testButtonTitles, setTestButtonTitles] = useState<Record<TestMode, string>>({ chat: "开始测试（已选 0 个）", vision: "开始测试（已选 0 个）", image: "开始测试（已选 0 个）", candy: "开始测试（已选 0 个）", svg: "开始测试（已选 0 个）" })
  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    if (testingStartedAt === null) {
      setElapsedSeconds(0)
      return
    }
    let timerID = 0
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - testingStartedAt) / 1000))
      timerID = setTimeout(tick, 1000)
    }
    tick()
    return () => clearTimeout(timerID)
  }, [testingStartedAt])

  function setCurrentTestButtonTitle(title: string) {
    setTestButtonTitles(current => ({ ...current, [mode]: title }))
  }

  function formatDuration(milliseconds: number) {
    return `${(milliseconds / 1000).toFixed(1)}s`
  }


  function updateConfig(patch: Partial<AppConfig>) {
    onConfigChanged({ ...config, ...patch })
  }

  async function loadModels() {
    setActivity("models"); setModelButtonTitle("正在获取模型…")
    try {
      const next = await fetchModels(config)
      setModels(next)
      setSelectedModels([])
      setResults([])
      setTestButtonTitles({ chat: "开始测试（已选 0 个）", vision: "开始测试（已选 0 个）", image: "开始测试（已选 0 个）", candy: "开始测试（已选 0 个）", svg: "开始测试（已选 0 个）" })
      setModelButtonTitle(`已获取 ${next.length} 个模型`)
    } catch (error) { setModelButtonTitle(`获取失败：${String(error)}`) } finally { setActivity("idle") }
  }

  function setModelSelected(modelID: string, selected: boolean) {
    setSelectedModels(current => {
      const next = selected ? [...new Set([...current, modelID])] : current.filter(id => id !== modelID)
      setCurrentTestButtonTitle(`开始测试（已选 ${next.length} 个）`)
      return next
    })
  }

  function toggleAllModels() {
    const next = selectedModels.length === models.length ? [] : models.map(model => model.id)
    setSelectedModels(next)
    setCurrentTestButtonTitle(`开始测试（已选 ${next.length} 个）`)
  }

  async function executeModelTest(modelID: string, testMode: TestMode, onProgress?: (text: string) => void) {
    let imageData: string | undefined
    const sourceImage = config.testImagePath ? UIImage.fromFile(config.testImagePath) : null
    const encodedImage = sourceImage?.toJPEGBase64String(0.82)
    if (encodedImage) imageData = `data:image/jpeg;base64,${encodedImage}`
    try {
      return await executeTest(config, modelID, testMode, imageData, onProgress)
    } catch (error) {
      return { mode: testMode, model: modelID, ok: false, status: null, durationMs: 0, content: `请求异常：${String(error)}`, createdAt: Date.now() } as TestResult
    }
  }

  async function runSingleTest(modelID: string) {
    if (mode === "vision" && !config.testImagePath) return
    setActivity("testing")
    setTestingModelID(modelID)
    setTestingStartedAt(Date.now())
    setTestingProgress("")
    try {
      const result = await executeModelTest(modelID, mode, text => setTestingProgress(`正在接收… ${text.length} 字`))
      setResults(current => [...current.filter(item => !(item.model === modelID && item.mode === mode)), result])
    } finally {
      setActivity("idle")
      setTestingModelID(null)
      setTestingStartedAt(null)
      setTestingProgress("")
    }
  }

  async function runTest() {
    if (models.length === 0) { setCurrentTestButtonTitle("请先获取模型列表"); return }
    if (selectedModels.length === 0) { setCurrentTestButtonTitle("请至少选择一个模型"); return }
    if (mode === "vision" && !config.testImagePath) { setCurrentTestButtonTitle("请先在设置中选择测试图片"); return }
    setSelectionMode(false)
    setActivity("testing")
    const batch: TestResult[] = []
    try {
      for (let index = 0; index < selectedModels.length; index += 1) {
        const modelID = selectedModels[index]
        setTestingModelID(modelID)
        setTestingStartedAt(Date.now())
        setTestingProgress("")
        setCurrentTestButtonTitle(`正在测试 ${index + 1}/${selectedModels.length}：${modelID}`)
        const result = await executeModelTest(modelID, mode)
        batch.push(result)
        setResults(current => [...current.filter(item => !(item.model === modelID && item.mode === mode)), batch[batch.length - 1]])
      }
      setCurrentTestButtonTitle(`测试完成：${batch.filter(item => item.ok).length}/${batch.length} 请求成功`)
    } finally {
      setActivity("idle")
      setTestingModelID(null)
      setTestingStartedAt(null)
      setTestingProgress("")
    }
  }

  function resultFor(modelID: string, testMode: TestMode = mode) {
    return results.find(item => item.model === modelID && item.mode === testMode)
  }

  function resultPassed(result?: TestResult) {
    if (!result?.ok) return false
    if (result.mode === "svg") return isValidHtml(result.content)
    if (result.mode !== "candy") return true
    const evaluation = evaluateQuestionTest(result.content, config.qaAnswers)
    return evaluation !== null && evaluation.score >= 60
  }

  function statusFor(modelID: string) {
    if (testingModelID === modelID) return "测试中…"
    const result = resultFor(modelID)
    if (!result) return "未测试"
    if (!result.ok) return "失败"
    if (mode === "candy") {
      const evaluation = evaluateQuestionTest(result.content, config.qaAnswers)
      return evaluation ? `${evaluation.score} 分` : "无法评分"
    }
    if (mode === "svg") return isValidHtml(result.content) ? `HTML 有效 · ${formatDuration(result.durationMs)}` : "HTML 无效"
    return `成功 · ${formatDuration(result.durationMs)}`
  }

  function sortedModels() {
    const query = modelSearch.trim().toLowerCase()
    return models.filter(model => !query || [model.id, model.owned_by, model.object].some(value => value?.toLowerCase().includes(query)))
  }

  function modelRow(model: ModelInfo) {
    const selected = selectedModels.includes(model.id)
    const result = resultFor(model.id)
    const status = statusFor(model.id)
    const content = (
      <HStack alignment="center" spacing={10} frame={{ maxWidth: Infinity }}>
        <Image
          systemName={selectionMode ? (selected ? "checkmark.circle.fill" : "circle") : "cpu"}
          foregroundStyle={selectionMode && selected ? "blue" : "secondaryLabel"}
          font={20}
          frame={{ width: 34, alignment: "center" }}
        />
        <VStack alignment="leading" spacing={3} frame={{ maxWidth: Infinity, alignment: "leading" }}>
          <Text>{model.id}</Text>
          <Text foregroundStyle="secondaryLabel">{model.owned_by ?? model.object ?? "模型"}</Text>
        </VStack>
        {testingModelID === model.id ? <Text foregroundStyle="orange" font={12}>测试中…({elapsedSeconds}s)</Text> : <Text foregroundStyle={status === "未测试" ? "secondaryLabel" : status === "无法评分" ? "orange" : status === "失败" || !resultPassed(result) ? "red" : "green"} font={12} frame={{ width: 96, alignment: "trailing" }}>{status}</Text>}
      </HStack>
    )
    return selectionMode
      ? <Button action={() => setModelSelected(model.id, !selected)} buttonStyle="plain">{content}</Button>
      : <NavigationLink destination={<ModelDetailPage model={model} mode={mode} config={config} initialResult={result} isTesting={testingModelID === model.id} elapsedSeconds={testingModelID === model.id ? elapsedSeconds : 0} progress={testingModelID === model.id ? testingProgress : ""} onRunTest={() => void runSingleTest(model.id)} />}>{content}</NavigationLink>
  }

  async function copyModels() {
    const passedModels = models.filter(model => resultPassed(resultFor(model.id)))
    await Pasteboard.setString(passedModels.map(model => model.id).join("\n"))
    setModelButtonTitle(`已复制 ${passedModels.length} 个通过模型`)
  }

  return (
    <NavigationStack>
      <Form navigationTitle="模型测试" navigationBarTitleDisplayMode="inline" toolbar={{
        cancellationAction: selectionMode ? <Button title="完成" action={() => setSelectionMode(false)} /> : <Button title="关闭" tint="red" action={dismiss} />,
        confirmationAction: models.length === 0 ? undefined : selectionMode ? <Button title={selectedModels.length === models.length ? "取消全选" : "全选"} action={toggleAllModels} /> : <Button title="选择" action={() => setSelectionMode(true)} />
      }}>
        <Section header={<Text>连接</Text>}>
          <FormRow label="URL" value={config.baseURL} prompt="https://example.com/v1" onChanged={value => updateConfig({ baseURL: value })} labelWidth={58} />
          <FormRow label="KEY" value={config.apiKey} prompt="sk-..." onChanged={value => updateConfig({ apiKey: value })} labelWidth={58} />
          <Picker title="模型思考等级" pickerStyle="menu" value={config.thinkingLevel} onChanged={(value: string) => updateConfig({ thinkingLevel: value as ThinkingLevel })}>
            {thinkingLevels.map(item => <Text key={item.tag} tag={item.tag}>{item.label}</Text>)}
          </Picker>
          <Button title={activity === "models" ? "正在获取模型…" : modelButtonTitle} systemImage="arrow.down.circle" action={() => void loadModels()} />
        </Section>
        <Section header={<Text>测试配置</Text>}>
          <Picker title="测试内容" value={mode} onChanged={(value: string) => setMode(value as TestMode)} pickerStyle="segmented">
            <Text tag="chat">文本</Text><Text tag="vision">多模态</Text><Text tag="image">生图</Text><Text tag="candy">问答</Text><Text tag="svg">HTML</Text>
          </Picker>
          <Button title={testButtonTitles[mode]} systemImage={activity === "testing" ? "hourglass" : "play.fill"} disabled={models.length === 0 || activity === "testing"} action={() => void runTest()} />
        </Section>
        <Section header={
          <HStack alignment="center" frame={{ maxWidth: Infinity }}>
            <Text frame={{ maxWidth: Infinity, alignment: "leading" }}>模型列表</Text>
            {models.length > 0 ? <Button title="复制通过模型" systemImage="doc.on.doc" font={12} disabled={!results.some(result => result.mode === mode && resultPassed(result))} action={() => void copyModels()} /> : null}
          </HStack>
        }>
          {models.length > 0 ? (
            <HStack alignment="center" spacing={10} frame={{ maxWidth: Infinity }}>
              <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" />
              <TextField label={<Text>搜索模型</Text>} value={modelSearch} prompt="搜索模型名称或所有者" onChanged={setModelSearch} />
              {modelSearch.length > 0 ? (
                <Button action={() => setModelSearch("")} buttonStyle="plain">
                  <Image systemName="xmark.circle.fill" foregroundStyle="tertiaryLabel" />
                </Button>
              ) : null}
            </HStack>
          ) : null}
          {models.length === 0 ? <Text foregroundStyle="secondaryLabel">请先获取模型列表</Text> : sortedModels().length === 0 ? <Text foregroundStyle="secondaryLabel">没有匹配的模型</Text> : sortedModels().map(modelRow)}
        </Section>
      </Form>
    </NavigationStack>
  )
}
