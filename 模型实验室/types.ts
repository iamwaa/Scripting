export type TestMode = "chat" | "vision" | "image" | "candy" | "svg"

// 思考等级：default 表示不发送任何思考参数，交由服务端默认行为
export type ThinkingLevel = "default" | "off" | "low" | "medium" | "high" | "xhigh" | "max"

export type ModelInfo = {
  id: string
  object?: string
  owned_by?: string
}

// 一个 OpenAI 兼容接口的持久化配置，id 生成后不再变化
export type ApiProfile = {
  id: string
  name: string
  baseURL: string
  apiKey: string
}

export type AppConfig = {
  // 全部已保存的接口，与 activeApiID 一起决定当前请求发往哪里
  apis: ApiProfile[]
  activeApiID: string
  defaultPrompt: string
  visionPrompt: string
  imagePrompt: string
  testImagePath: string
  thinkingLevel: ThinkingLevel
  // 通用问答题：规则内置在 constants，这里只配置题目与答案，每行一项按顺序对应
  qaQuestions: string
  qaAnswers: string
  // 通用 HTML 生成题：规则内置在 constants，这里只配置提示语
  htmlPrompt: string
}

export type TestResult = {
  mode: TestMode
  model: string
  ok: boolean
  status: number | null
  durationMs: number
  content: string
  raw?: string
  imageURL?: string
  // 降级重试后实际生效的思考等级，仅 chat 类测试有值
  thinkingLevel?: ThinkingLevel
  createdAt: number
}
