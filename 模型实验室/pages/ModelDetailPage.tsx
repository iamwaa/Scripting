import { Button, Form, HStack, Image, Section, Spacer, Text, useEffect, useState } from "scripting"
import { modeLabels, thinkingLevels } from "../constants"
import { AppConfig, ModelInfo, TestMode, TestResult } from "../types"
import { evaluateQuestionTest, explainQuestionFailure } from "../utils/candyTest"
import { extractHtml, isValidHtml } from "../utils/htmlTest"

export function ModelDetailPage({ model, mode, config, initialResult, isTesting, elapsedSeconds, progress, onRunTest }: {
  model: ModelInfo
  mode: TestMode
  config: AppConfig
  initialResult?: TestResult
  isTesting: boolean
  elapsedSeconds: number
  progress: string
  onRunTest: () => void
}) {
  const [result, setResult] = useState<TestResult | undefined>(initialResult)
  const [buttonTitle, setButtonTitle] = useState(isTesting ? "正在测试…" : initialResult ? (initialResult.ok ? "重新测试" : "测试失败，重试") : "开始测试")

  useEffect(() => {
    setResult(initialResult)
    setButtonTitle(isTesting ? "正在测试…" : initialResult ? (initialResult.ok ? "重新测试" : "测试失败，重试") : "开始测试")
  }, [initialResult, isTesting, elapsedSeconds, progress])

  function formatDuration(milliseconds: number) {
    return `${(milliseconds / 1000).toFixed(1)}s`
  }

  function thinkingLabel() {
    return thinkingLevels.find(item => item.tag === (result?.thinkingLevel ?? config.thinkingLevel))?.label ?? "默认"
  }

  const evaluation = result?.mode === "candy" ? evaluateQuestionTest(result.content, config.qaAnswers) : null
  const html = result?.mode === "svg" ? extractHtml(result.content) : null
  const htmlPassed = result?.mode === "svg" && isValidHtml(result.content)

  async function downloadHtml() {
    if (!html) return
    const data = Data.fromRawString(html, "utf-8")
    if (!data) return
    const safeModelName = model.id.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "model"
    const paths = await DocumentPicker.exportFiles({ files: [{ data, name: `generated-${safeModelName}.html` }] })
    if (paths.length > 0) setButtonTitle("HTML 已下载")
  }

  async function previewHtml() {
    if (!html || !htmlPassed) return
    const controller = new WebViewController({ ephemeral: true })
    controller.shouldAllowRequest = async request => request.url.startsWith("about:")
    await controller.loadHTML(html, "about:blank")
    await controller.present({ navigationTitle: "HTML 预览" })
    controller.dispose()
  }

  return (
    <Form navigationTitle={model.id} navigationBarTitleDisplayMode="inline">
      <Section header={<Text>模型信息</Text>}>
        <Text foregroundStyle="secondaryLabel">所有者：{model.owned_by ?? "未知"}</Text>
        <Text foregroundStyle="secondaryLabel">对象类型：{model.object ?? "未知"}</Text>
        <Text foregroundStyle="secondaryLabel">思考等级：{thinkingLabel()}</Text>
        <Text foregroundStyle="secondaryLabel">测试模式：{modeLabels[mode]}</Text>
        {mode === "svg" ? <Text foregroundStyle="secondaryLabel">检测内容：HTML 文档结构完整性</Text> : null}
        <Button title={isTesting ? `测试中…(${elapsedSeconds}s)` : buttonTitle} systemImage={isTesting ? "hourglass" : "play.fill"} disabled={isTesting} action={onRunTest} />
        {isTesting && progress ? <Text foregroundStyle="secondaryLabel">{progress}</Text> : null}
      </Section>
      {result ? <>
        <Section header={<Text>测试摘要</Text>}>
          <Text foregroundStyle={result.ok ? "green" : "red"}>{result.ok ? "请求成功" : "请求失败"}</Text>
          <Text foregroundStyle="secondaryLabel">HTTP {result.status ?? "网络错误"} · {formatDuration(result.durationMs)}</Text>
        </Section>
        <Section header={<Text>模型响应</Text>}>
          {result.imageURL ? <HStack alignment="center" frame={{ maxWidth: "infinity" }}><Spacer /><Image imageUrl={result.imageURL} resizable scaleToFit frame={{ height: 280 }} /><Spacer /></HStack> : null}
          {result.mode === "candy" ? <>
            {evaluation ? <>
              <Text font={28} foregroundStyle="blue">{evaluation.score} 分</Text>
              <Text font={18}>{evaluation.level}</Text>
              <Text multilineTextAlignment="leading">答对 {evaluation.answers.filter(item => item.correct).length}/{evaluation.answers.length} 题</Text>
              {evaluation.answers.map((answer, index) => <Text key={index} foregroundStyle={answer.correct ? "green" : "red"}>{index + 1}. {answer.correct ? "✓" : "✗"} {answer.question}：{answer.answer}</Text>)}
            </> : <Text foregroundStyle="orange">无法评分：{explainQuestionFailure(result.content, config.qaAnswers)}</Text>}
            <Text multilineTextAlignment="leading">{result.content || "（空响应）"}</Text>
          </> : result.mode === "svg" ? <>
            <Text foregroundStyle={htmlPassed ? "green" : "orange"}>{htmlPassed ? "已通过 HTML 校验" : "未通过 HTML 校验"}</Text>
            {html && htmlPassed ? <><Button title="预览 HTML" systemImage="eye" action={() => void previewHtml()} /><Button title="下载 HTML" systemImage="arrow.down.doc" action={() => void downloadHtml()} /></> : null}
            <Text multilineTextAlignment="leading">{result.content || "（空响应）"}</Text>
          </> : <Text multilineTextAlignment="leading">{result.content || "（空响应）"}</Text>}
        </Section>
        <Section header={<Text>原始响应</Text>}>
          <Text multilineTextAlignment="leading" foregroundStyle="secondaryLabel">{result.raw || "（无原始响应）"}</Text>
        </Section>
      </> : null}
    </Form>
  )
}
