import { AppConfig, ThinkingLevel } from "./types"

export const defaultConfig: AppConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  defaultPrompt: "盆里有6只馒头，6个小朋友每人分到1只，但盆里还留着1只，为什么？",
  visionPrompt: "请描述这张图片中的主要内容，并指出你识别到的关键细节。",
  imagePrompt: "一张干净、细节丰富的美女摄影图，柔和自然光，简洁背景。",
  testImagePath: "",
  thinkingLevel: "default",
  qaQuestions: "盆里有6只馒头，6个小朋友每人分到1只，但盆里还留着1只，为什么？",
  qaAnswers: "盆里还留着的那只馒头连盆一起给了最后一个小朋友",
  htmlPrompt: "生成一个展示太阳系八大行星公转的页面，带 SVG 图形和动画。",
}

// 内置问答题规则：格式要求写死在项目内，避免用户配置不完整导致结果无法解析
export const questionRule = [
  "你是严格的答题器，只输出最终答案，不输出任何推导过程。",
  "输出格式要求（必须严格遵守）：",
  '1. 只输出一个 JSON 对象，格式固定为：{"answers":["第1题答案","第2题答案"]}',
  "2. 不要输出 Markdown 代码块、反引号、标题、解释、思考过程或 JSON 之外的任何文字。",
  "3. answers 必须是字符串数组，元素个数与题目数量一致，顺序与题目顺序一致。",
  "4. 每个元素只写最终答案本身：数值题只写阿拉伯数字（如 \"21\"），不带单位、量词、句号和多余说明。",
  "5. 选择题只写选项字母，判断题只写“是”或“否”。",
  "6. 无法作答时该位置填空字符串 \"\"，但数组长度不能变。",
].join("\n")

// 内置 HTML 规则：约束返回单个完整可离线运行的 HTML 文档
export const htmlRule = [
  "你是 HTML 页面生成器，只输出源码。",
  "输出格式要求（必须严格遵守）：",
  "1. 只输出一个完整的 HTML5 文档，第一行是 <!DOCTYPE html>，最后一行是 </html>。",
  "2. 不要输出 Markdown 代码块、反引号、说明文字、思考过程或 HTML 之外的任何内容。",
  "3. 文档必须包含成对的 <html>、<head>、<body> 标签，<head> 内包含 <meta charset=\"utf-8\"> 和 <title>。",
  "4. CSS 与 JavaScript 全部内联写在文档内，不要引用任何外部资源（CDN、外链脚本、样式、图片、字体）。",
  "5. 页面在离线环境下双击打开即可正常显示和运行。",
].join("\n")

export const modeLabels = {
  chat: "文本",
  vision: "多模态",
  image: "生图",
  candy: "通用问答",
  svg: "通用 HTML",
} as const

// 思考等级选项：default 不发送参数，其余 tag 直接作为 reasoning_effort 透传（off 映射为 none）
// xhigh / max 为 OpenAI 新增的超高档位，旧模型或部分兼容服务端可能不识别，届时由 400 回退兜底
export const thinkingLevels: { tag: ThinkingLevel; label: string }[] = [
  { tag: "default", label: "默认" },
  { tag: "off", label: "关闭" },
  { tag: "low", label: "低" },
  { tag: "medium", label: "中" },
  { tag: "high", label: "高" },
  { tag: "xhigh", label: "极高" },
  { tag: "max", label: "最高" },
]
