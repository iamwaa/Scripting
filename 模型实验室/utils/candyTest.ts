import { questionRule } from "../constants"

// 题目与答案均按行拆分，空行忽略，行序即题号
export function splitLines(value: string): string[] {
  return value.split("\n").map(item => item.trim()).filter(Boolean)
}

// 组装问答请求：内置规则在前，编号题目在后，明确题目数量便于模型对齐数组长度
export function buildQuestionPrompt(questions: string) {
  const list = splitLines(questions)
  const numbered = list.map((item, index) => `${index + 1}. ${item}`).join("\n")
  return `${questionRule}\n\n共 ${list.length} 道题，请依次作答：\n${numbered}\n\n现在只输出符合上述格式的 JSON。`
}

// 优先整体解析，失败时截取首个括号到末个闭括号，兼容附带说明文字的返回
function extractJSONValue(content: string): unknown {
  const normalized = content.replace(/^\uFEFF/, "").trim()
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? normalized
  try {
    return JSON.parse(fenced)
  } catch {
    const start = fenced.search(/[\[{]/)
    if (start < 0) return null
    const closing = fenced[start] === "[" ? "]" : "}"
    const end = fenced.lastIndexOf(closing)
    if (end < start) return null
    try {
      return JSON.parse(fenced.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

// 仅接受“1. 答案”“第1题：答案”这类明确编号行，避免把原始响应 JSON 的行当成答案
function numberedAnswers(content: string, expectedCount: number): string[] | null {
  const picked = new Map<number, string>()
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:第\s*(\d+)\s*题|(\d+))\s*[.、)．:：]\s*(.+)$/)
    if (!match) continue
    const index = Number(match[1] ?? match[2])
    if (index < 1 || index > expectedCount || picked.has(index)) continue
    picked.set(index, match[3].trim())
  }
  if (picked.size !== expectedCount) return null
  return Array.from({ length: expectedCount }, (_, index) => picked.get(index + 1) ?? "")
}

function actualAnswers(content: string, expectedCount: number): unknown[] | null {
  const parsed = extractJSONValue(content)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === "object") {
    const value = parsed as Record<string, unknown>
    if (Array.isArray(value.answers)) return value.answers
    if (Array.isArray(value.results)) return value.results
    const numberedKeys = Object.keys(value)
      .filter(key => /^(?:q|question|answer)?\d+$/i.test(key))
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
      .map(key => value[key])
    if (numberedKeys.length > 0) return numberedKeys
  }
  return numberedAnswers(content, expectedCount)
}

// 数组元素可能是对象（如 {"answer":"21"}），统一取其中的文本字段
function answerText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") {
    const item = value as Record<string, unknown>
    const nested = item.answer ?? item.text ?? item.content ?? item.value ?? item.result
    return nested == null ? "" : answerText(nested)
  }
  return ""
}

function expectedAnswers(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean)
  } catch {
    // 非 JSON 时支持按行填写答案
  }
  return splitLines(value)
}

// 去掉包裹引号与结尾标点，比对时忽略大小写
function normalize(value: string) {
  return value
    .trim()
    .replace(/^["'“”「『]+|["'“”」』]+$/g, "")
    .replace(/[。.,，、；;!！?？\s]+$/g, "")
    .trim()
    .toLocaleLowerCase()
}

function isCorrect(expected: string, received: string) {
  if (!received) return false
  const target = normalize(expected)
  const actual = normalize(received)
  if (target === actual) return true
  // 期望是纯数字时，容忍模型多写单位或量词，但答案中只能出现这一个数字
  if (/^-?\d+(?:\.\d+)?$/.test(target)) {
    const numbers = actual.match(/-?\d+(?:\.\d+)?/g)
    return numbers?.length === 1 && Number(numbers[0]) === Number(target)
  }
  return false
}

export type QuestionEvaluation = {
  score: number
  level: string
  answers: { question: string; answer: string; correct: boolean }[]
}

// 评分失败时给出可读原因，避免界面只显示「无法评分」而看不到症结
export function explainQuestionFailure(content: string, answerConfig: string): string {
  const expected = expectedAnswers(answerConfig)
  if (expected.length === 0) return "设置里的答案为空，请按行填写答案。"
  if (!content.trim()) return "模型没有返回任何文本内容。"
  const parsed = extractJSONValue(content)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const keys = Object.keys(parsed as Record<string, unknown>).slice(0, 6).join("、")
    return `返回的 JSON 里没有 answers 数组，实际字段：${keys || "无"}。`
  }
  return `没有从返回内容中找到 answers 数组或编号答案（预期 ${expected.length} 道题）。`
}

export function evaluateQuestionTest(content: string, answerConfig: string): QuestionEvaluation | null {
  try {
    const expected = expectedAnswers(answerConfig)
    if (expected.length === 0) return null
    const actual = actualAnswers(content, expected.length)
    if (!actual) return null
    const answers = expected.map((answer, index) => {
      const received = answerText(actual[index])
      return {
        question: `第 ${index + 1} 题`,
        answer: received || "未作答",
        correct: isCorrect(answer, received),
      }
    })
    const score = Math.round(answers.filter(item => item.correct).length * 100 / answers.length)
    const level = score === 100 ? "全部正确" : score >= 60 ? "通过" : "未通过"
    return { score, level, answers }
  } catch {
    return null
  }
}
