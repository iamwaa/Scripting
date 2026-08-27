import { fetch } from "scripting"
import { AppConfig, ModelInfo, TestMode, TestResult, ThinkingLevel } from "../types"
import { buildQuestionPrompt } from "../utils/candyTest"
import { buildHtmlPrompt } from "../utils/htmlTest"
import { readSSEStream } from "./sseStream"

// 思考强度由高到低，服务端不认识高档位时沿此顺序降级
const thinkingLadder: ThinkingLevel[] = ["max", "xhigh", "high", "medium", "low"]

// 进度回调节流间隔，避免每个 chunk 都触发界面刷新
const progressInterval = 250

// 流式原文行数极多，展示用原始响应截断防止内存与渲染膨胀
const rawLimit = 12000

function clipRaw(raw: string) {
  return raw.length > rawLimit ? `${raw.slice(0, rawLimit)}\n…（已截断，共 ${raw.length} 字符）` : raw
}

function endpoint(baseURL: string, path: string) {
  return `${baseURL.replace(/\/+$/, "")}${path}`
}

function headers(config: AppConfig) {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }
}

// 思考等级映射：default 不干预；off 显式关闭思考；其余作为 reasoning_effort 强度
function thinkingPayload(level: ThinkingLevel) {
  if (level === "default") return {}
  if (level === "off") return { reasoning_effort: "none", enable_thinking: false, thinking: { type: "disabled" } }
  return { reasoning_effort: level, enable_thinking: true, thinking: { type: "enabled" } }
}

// 推理模型会先消耗思考 token，预算给小了会出现 finish_reason=length 且正文为空；
// 上限只是安全护栏，未用到不计费；超出服务端限制时由参数适配重试改为不传上限
const budgetCeiling = 131072

function tokenBudget(mode: TestMode, level: ThinkingLevel) {
  const base = mode === "svg" ? 48000 : mode === "candy" ? 32000 : 8000
  if (level === "default" || level === "off") return base
  const multiplier = level === "max" ? 3 : level === "xhigh" ? 2 : 1
  return Math.min(base + (mode === "svg" ? 32000 : 16000) * multiplier, budgetCeiling)
}

// 请求降级链：末尾的 null 表示彻底不带思考参数
function fallbackLevels(level: ThinkingLevel): (ThinkingLevel | null)[] {
  if (level === "default") return ["default"]
  if (level === "off") return ["off", null]
  const index = thinkingLadder.indexOf(level)
  const rest = index >= 0 ? thinkingLadder.slice(index) : [level]
  return [...rest, null]
}

async function readJSON(response: any) {
  const text = await response.text()
  try {
    return { data: JSON.parse(text), text }
  } catch {
    return { data: null, text }
  }
}

// 只提取文本内容；拿不到文本时返回空串，避免把整个响应对象当成模型回答
function messageContent(value: any): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(item => messageContent(item)).join("")
  const nested = value.content ?? value.text ?? value.value ?? value.reasoning_content
  return nested == null ? "" : messageContent(nested)
}

export async function fetchModels(config: AppConfig): Promise<ModelInfo[]> {
  const response = await fetch(endpoint(config.baseURL, "/models"), { headers: headers(config) })
  const { data, text } = await readJSON(response)
  if (!response.ok) throw new Error(data?.error?.message ?? text ?? `HTTP ${response.status}`)
  return Array.isArray(data?.data) ? data.data : []
}

type ChatOutcome = { content: string; raw: string; status: number; ok: boolean; finishReason?: string }

// 流式读取一次 chat 请求：逐行解析 SSE，累加 delta；服务端不遵守 stream 时回退为整包 JSON
async function streamChat(url: string, config: AppConfig, payload: object, useStream = true, onProgress?: (text: string) => void): Promise<ChatOutcome> {
  const response = await fetch(url, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ ...payload, stream: useStream }),
  })
  if (!response.ok) {
    const { data, text } = await readJSON(response)
    return { content: data?.error?.message ?? text ?? `HTTP ${response.status}`, raw: text, status: response.status, ok: false }
  }

  let content = ""
  let reasoning = ""
  let errorMessage = ""
  let finishReason = ""
  let sawEvent = false
  let lastReport = 0

  const raw = await readSSEStream(response.dataStream, line => {
    if (!line.startsWith("data:")) return
    sawEvent = true
    const body = line.slice(5).trim()
    if (body === "[DONE]" || body.length === 0) return
    try {
      const chunk = JSON.parse(body)
      if (chunk?.error) errorMessage ||= messageContent(chunk.error?.message) || JSON.stringify(chunk.error)
      const choice = chunk?.choices?.[0]
      if (typeof choice?.finish_reason === "string" && choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice?.delta
      if (delta) {
        content += messageContent(delta.content)
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content
      } else if (choice?.message) {
        content += messageContent(choice.message)
      } else {
        content += messageContent(choice?.text)
      }
    } catch {
      // 单行解析失败不中止整个流，原文仍保留在 raw 中
    }
    const now = Date.now()
    if (onProgress && now - lastReport >= progressInterval) {
      lastReport = now
      onProgress(content || reasoning)
    }
  })

  // 服务端忽略 stream 参数或本次就是非流式请求，直接返回完整 JSON
  if (!sawEvent) {
    try {
      const data = JSON.parse(raw)
      const choice = data?.choices?.[0]
      const text = messageContent(choice?.message) || messageContent(choice?.text)
      const reason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined
      if (text) return { content: text, raw: clipRaw(raw), status: response.status, ok: true, finishReason: reason }
      const failure = messageContent(data?.error?.message) || `模型未返回文本内容${reason ? `（finish_reason: ${reason}）` : ""}`
      return { content: failure, raw: clipRaw(raw), status: response.status, ok: false, finishReason: reason }
    } catch {
      return { content: raw, raw: clipRaw(raw), status: response.status, ok: false }
    }
  }
  return { content: content || reasoning || errorMessage || raw, raw: clipRaw(raw), status: response.status, ok: !errorMessage && Boolean(content || reasoning), finishReason: finishReason || undefined }
}

export async function executeTest(
  config: AppConfig,
  model: string,
  mode: TestMode,
  imageData?: string,
  onProgress?: (text: string) => void,
): Promise<TestResult> {
  const started = Date.now()
  if (mode === "image") {
    const response = await fetch(endpoint(config.baseURL, "/images/generations"), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ model, prompt: config.imagePrompt, n: 1, size: "1024x1024" }),
    })
    const { data, text } = await readJSON(response)
    const url = typeof data?.data?.[0]?.url === "string" ? data.data[0].url : undefined
    const content = url ? `图片 URL：${url}` : data?.data?.[0]?.b64_json ? "已返回 Base64 图片数据。" : text
    return {
      mode, model, ok: response.ok, status: response.status, durationMs: Date.now() - started,
      content: typeof content === "string" ? content : JSON.stringify(content, null, 2),
      raw: text, imageURL: url, createdAt: Date.now(),
    }
  }

  const content = mode === "vision" && imageData
    ? [{ type: "text", text: config.visionPrompt }, { type: "image_url", image_url: { url: imageData } }]
    : config.defaultPrompt
  const requestContent = mode === "candy" ? buildQuestionPrompt(config.qaQuestions) : mode === "svg" ? buildHtmlPrompt(config.htmlPrompt) : content
  const structuredTest = mode === "candy" || mode === "svg"
  const url = endpoint(config.baseURL, "/chat/completions")

  // 预算字段适配：推理类模型只接受 max_completion_tokens，且可能拒绝 temperature
  type Variant = { completionTokens: boolean; dropTemperature: boolean; uncapped: boolean }

  function payloadFor(level: ThinkingLevel | null, variant: Variant) {
    const budget = tokenBudget(mode, level ?? "default")
    const limit = variant.uncapped ? {} : variant.completionTokens ? { max_completion_tokens: budget } : { max_tokens: budget }
    const temperature = variant.dropTemperature ? {} : mode === "candy" ? { temperature: 0.2 } : mode === "svg" ? { temperature: 0.4 } : {}
    return {
      model,
      messages: [{ role: "user", content: requestContent }],
      ...limit,
      ...temperature,
      ...(level == null ? {} : thinkingPayload(level)),
    }
  }

  // 高档位可能不被识别，400 时逐级降级重试，最后才完全去掉思考参数
  let outcome: ChatOutcome | undefined
  let usedLevel = config.thinkingLevel
  for (const level of fallbackLevels(config.thinkingLevel)) {
    let variant: Variant = { completionTokens: false, dropTemperature: false, uncapped: false }
    for (let attempt = 0; attempt < 4; attempt++) {
      outcome = await streamChat(url, config, payloadFor(level, variant), !structuredTest, onProgress)
      usedLevel = level ?? "default"
      if (outcome.ok) break
      // 参数不被接受时不只看 400：部分中转服务会用 500 报“max_tokens exceeds the limit”
      const message = outcome.content.toLowerCase()
      const budgetRejected = message.includes("max_tokens") || message.includes("max_completion_tokens")
      if (budgetRejected) {
        const unsupportedField = message.includes("unsupported") || message.includes("unrecognized") || message.includes("not supported")
        if (unsupportedField && !variant.completionTokens) {
          variant = { ...variant, completionTokens: true }
          continue
        }
        // 上限超过模型允许值时改为完全不传上限
        if (!variant.uncapped) {
          variant = { ...variant, uncapped: true }
          continue
        }
      }
      if (!variant.dropTemperature && message.includes("temperature")) {
        variant = { ...variant, dropTemperature: true }
        continue
      }
      break
    }
    if (outcome!.ok || outcome!.status !== 400) break
  }

  // 正文被思考 token 吃完时（finish_reason=length 且无内容），去掉输出上限重试一次
  if (!outcome!.ok && outcome!.finishReason === "length") {
    const retry = await streamChat(url, config, payloadFor(usedLevel === "default" ? "default" : usedLevel, { completionTokens: false, dropTemperature: false, uncapped: true }), !structuredTest, onProgress)
    if (retry.ok) outcome = retry
  }

  const result = outcome!
  return {
    mode, model, ok: result.ok, status: result.status, durationMs: Date.now() - started,
    content: result.content, raw: result.raw, thinkingLevel: usedLevel, createdAt: Date.now(),
  }
}
