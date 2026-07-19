// 智谱视觉分析 — 通过 GLM-4.6V 模型分析图片
// 用法:
//   scripting-ts run zhipu-vision/index.tsx --queryparameters '{"image":"<图片路径>","prompt":"<提示词>"}'
// 或直接运行进入交互模式

import { Script, Navigation, NavigationStack, List, Section, Text, TextField, Button, HStack, VStack, Spacer, Image, ProgressView, useState, useEffect, fetch, Toolbar, ToolbarItem } from "scripting"
import { ConfigData, loadConfig } from "./config"
import { SettingsView } from "./settings"

interface AnalysisResult {
  success: boolean
  content?: string
  error?: string
}

// 将图片文件编码为 base64
async function encodeImageToBase64(filePath: string): Promise<string> {
  const data = await FileManager.readAsData(filePath)
  return data.toBase64String()
}

// 检测图像来源是本地文件还是远程 URL
function isUrl(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://")
}

// 获取文件 MIME 类型
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() || ""
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
  }
  return mimeMap[ext] || "image/jpeg"
}

// 调用智谱 GLM-4.6V 视觉 API
async function analyzeImage(
  imageSource: string,
  prompt: string,
  config: ConfigData
): Promise<AnalysisResult> {
  try {
    let imageContent: Record<string, any>

    if (isUrl(imageSource)) {
      imageContent = {
        type: "image_url",
        image_url: { url: imageSource }
      }
    } else {
      const base64 = await encodeImageToBase64(imageSource)
      const mimeType = getMimeType(imageSource)
      imageContent = {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` }
      }
    }

    const requestBody = {
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            imageContent
          ]
        }
      ],
      stream: false,
      temperature: 0.8,
      top_p: 0.6,
      max_tokens: 32768
    }

    const response = await fetch(`${config.apiBase}chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return { success: false, error: "API 返回内容为空" }
    }

    return { success: true, content }
  } catch (error) {
    return { success: false, error: `分析失败: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// ================ UI 交互界面 ================

function View() {
  const [imagePath, setImagePath] = useState("")
  const [promptText, setPromptText] = useState("请详细描述这张图片的内容")
  const [result, setResult] = useState("")
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadConfig().then(setConfig)
  }, [])

  async function openSettings() {
    await Navigation.present(<SettingsView />)
    const newConfig = await loadConfig()
    setConfig(newConfig)
  }

  // 重置结果与错误状态
  function resetResult() {
    setResult("")
    setIsError(false)
  }

  // 从系统相册选取图片
  async function pickFromPhotos() {
    const results = await Photos.pick({
      filter: PHPickerFilter.images(),
      limit: 1,
    })
    if (results && results.length > 0) {
      const path = await results[0].imagePath()
      if (path) {
        setImagePath(path)
        resetResult()
      }
    }
  }

  // 从文件 App 选取图片文件
  async function pickFromFiles() {
    const files = await DocumentPicker.pickFiles({
      types: ["public.image"],
      allowsMultipleSelection: false,
      shouldShowFileExtensions: true,
    })
    if (files && files.length > 0) {
      setImagePath(files[0])
      resetResult()
    }
  }

  async function handleAnalyze() {
    if (!imagePath.trim()) {
      setIsError(true)
      setResult("请输入图片路径或 URL")
      return
    }
    if (!config?.apiKey) {
      setIsError(true)
      setResult("请在设置中配置 API Key")
      return
    }
    setLoading(true)
    setIsError(false)
    setResult("")
    const res = await analyzeImage(imagePath.trim(), promptText.trim(), config)
    if (res.success) {
      setIsError(false)
      setResult(res.content!)
    } else {
      setIsError(true)
      setResult("错误: " + res.error)
    }
    setLoading(false)
  }

  // 一键复制结果到剪贴板
  async function copyResult() {
    if (!result) return
    await Pasteboard.setString(result)
    Haptics.transient()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 清除当前图片与结果
  function clearAll() {
    setImagePath("")
    resetResult()
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="智谱视觉分析"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem
              placement="topBarTrailing"
            >
              <Button
                title="设置"
                systemImage="gearshape"
                action={openSettings}
              />
            </ToolbarItem>
          </Toolbar>
        }
      >
        {/* 图片输入区 */}
        <Section
          header={<Text>图片输入</Text>}
          footer={
            !config?.apiKey ? (
              <Text>⚠️ 请点击右上角「设置」按钮配置 API Key</Text>
            ) : (
              <Text>支持本地路径与远程 URL· jpg/png/gif/bmp/webp · 使用智谱 GLM-4.6V 模型</Text>
            )
          }
        >
          <TextField
            title="图片路径或 URL"
            prompt="输入图片路径或 URL"
            value={imagePath}
            onChanged={(v) => { setImagePath(v); resetResult() }}
          />
          <HStack>
            <Button
              title="从相册选取"
              systemImage="photo"
              foregroundStyle="systemBlue"
              buttonStyle="plain"
              action={pickFromPhotos}
              disabled={loading}
            />
            <Button
              title="从文件选取"
              systemImage="folder"
              foregroundStyle="systemBlue"
              buttonStyle="plain"
              action={pickFromFiles}
              disabled={loading}
            />
            <Spacer />
            {imagePath.trim() ? (
              <Button
                title="清除"
                systemImage="xmark.circle.fill"
                foregroundStyle="systemRed"
                buttonStyle="plain"
                action={clearAll}
                disabled={loading}
              />
            ) : null}
          </HStack>

          {/* 图片预览缩略图 */}
          {imagePath.trim() ? (
            <VStack alignment="leading">
              {isUrl(imagePath.trim()) ? (
                <Image
                  imageUrl={imagePath.trim()}
                  resizable={true}
                  aspectRatio={{ contentMode: "fit" }}
                  frame={{ width: 200, height: 200 }}
                />
              ) : (
                <Image
                  filePath={imagePath.trim()}
                  resizable={true}
                  aspectRatio={{ contentMode: "fit" }}
                  frame={{ width: 200, height: 200 }}
                />
              )}
            </VStack>
          ) : null}
        </Section>

        {/* 分析提示词 */}
        <Section
          header={<Text>分析提示词</Text>}
        >
          <TextField
            title="提示词"
            prompt="输入对图片的分析要求（可选）"
            value={promptText}
            onChanged={setPromptText}
          />
          <HStack>
            <Button
              title={loading ? "分析中…" : "开始分析"}
              systemImage="sparkles"
              action={handleAnalyze}
              disabled={loading}
            />
            <Spacer />
            {loading ? <ProgressView /> : null}
          </HStack>
        </Section>

        {/* 分析结果 */}
        {loading || result ? (
          <Section
            header={
              <HStack>
                <Text>分析结果</Text>
                <Spacer />
                {copied ? <Text>已复制 ✓</Text> : null}
                {result && !loading && !isError ? (
                  <Button
                    title="复制全文"
                    systemImage="doc.on.doc"
                    foregroundStyle="systemBlue"
                    buttonStyle="plain"
                    action={copyResult}
                  />
                ) : null}
              </HStack>
            }
          >
            {loading ? (
              <Text>正在调用 GLM-4.6V 分析图片…</Text>
            ) : isError ? (
              <Text>⚠️ {result}</Text>
            ) : (
              <Text>{result}</Text>
            )}
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}

// ================ 入口逻辑 ================

async function run() {
  // 检查是否通过 queryParameters 传入了参数
  const params = Script.queryParameters
  if (params && params.image) {
    const imageSource = params.image
    const prompt = params.prompt || "请详细描述这张图片的内容"

    const config = await loadConfig()
    if (!config.apiKey) {
      console.error("错误: 请先在设置中配置 API Key")
      Script.exit({ error: "请先在设置中配置 API Key" })
      return
    }

    console.log("分析图片:", imageSource)
    console.log("提示词:", prompt)

    const result = await analyzeImage(imageSource, prompt, config)
    if (result.success) {
      console.log(result.content)
      Script.exit(result.content)
    } else {
      console.error("错误:", result.error)
      Script.exit({ error: result.error })
    }
    return
  }

  // 无参数时显示交互 UI
  await Navigation.present(<View />)
  Script.exit()
}

run()
