import { HStack, Text, ProgressView, WebView, useEffect, useState, fetch } from "scripting"
import type { ResourceItem } from "../types/resource"

export function FontPreview({ resource }: { resource: ResourceItem }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [contentHeight, setContentHeight] = useState(0)
  const [wvController] = useState(() => new WebViewController())

  useEffect(() => {
    let cancelled = false
    let tempDir = ""

    async function loadFont() {
      try {
        // 创建临时目录
        tempDir = FileManager.temporaryDirectory + "/font_preview_" + Date.now()
        await FileManager.createDirectory(tempDir, true)

        // 下载字体文件
        const response = await fetch(resource.url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const fontBytes = await response.bytes()

        // 写入字体文件
        const fontName = resource.name || "font"
        const fontPath = tempDir + "/" + fontName
        await FileManager.writeAsBytes(fontPath, fontBytes)

        // 根据扩展名确定 format 提示
        const ext = fontName.split(".").pop()?.toLowerCase() || ""
        const formatMap: Record<string, string> = {
          "woff": "woff",
          "woff2": "woff2",
          "ttf": "truetype",
          "otf": "opentype",
          "eot": "embedded-opentype",
        }
        const formatHint = formatMap[ext] ? ` format('${formatMap[ext]}')` : ""

        // 生成预览 HTML
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@font-face {
  font-family: 'PreviewFont';
  src: url('./${fontName}')${formatHint};
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  overflow: hidden;
  -webkit-overflow-scrolling: auto;
  background: transparent;
}
::-webkit-scrollbar { display: none; }
#wrapper {
  font-family: 'PreviewFont', -apple-system, sans-serif;
  padding: 6px 8px 12px; 
  color: #1c1c1e;
  width: 100%;
}
.section { margin-bottom: 10px; }
.section:last-child { margin-bottom: 0; }
.section-title { font-size: 11px; color: #8e8e93; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1px; font-family: -apple-system, sans-serif; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  #wrapper { color: #f2f2f7; }
  .section-title { color: #8e8e93; }
}
.chars { font-size: 20px; letter-spacing: 1px; line-height: 1.2; word-break: break-all; }
.sizes .line { margin-bottom: 1px; }
.sentence { font-size: 16px; line-height: 1.3; }
</style>
</head>
<body>
  <div id="wrapper">
    <div class="section">
      <div class="section-title">大写字母</div>
      <div class="chars">ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
    </div>
    <div class="section">
      <div class="section-title">小写字母</div>
      <div class="chars">abcdefghijklmnopqrstuvwxyz</div>
    </div>
    <div class="section">
      <div class="section-title">数字与符号</div>
      <div class="chars">0123456789 !@#$%&amp;*+-=?</div>
    </div>
    <div class="section">
      <div class="section-title">不同字号</div>
      <div class="sizes">
        <div class="line" style="font-size:22px;">22px 字体预览 Font</div>
        <div class="line" style="font-size:17px;">18px 字体预览 Font</div>
        <div class="line" style="font-size:14px;">14px 字体预览 Font</div>
        <div class="line" style="font-size:12px;">12px 字体预览 Font</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">段落示例</div>
      <div class="sentence">The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了懒狗。ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</div>
    </div>
  </div>
</body>
</html>`

        const htmlPath = tempDir + "/preview.html"
        await FileManager.writeAsString(htmlPath, html)

        if (!cancelled) {
          await wvController.loadFile(htmlPath, tempDir)
          if (!cancelled) {
            try {
              const script = "document.getElementById('wrapper').offsetHeight";
              const rawHeight = await wvController.evaluateJavaScript(script);
              
              const height = Number(rawHeight);
              
              if (!cancelled && !isNaN(height) && height > 0) {
                setContentHeight(height + 5);
              }
            } catch (e) {
              console.error("高度获取失败:", e);
            }
            setStatus("ready")
          }
        }
      } catch (e) {
        if (!cancelled) setStatus("error")
      }
    }

    loadFont()

    return () => {
      cancelled = true
      wvController.dispose()
      if (tempDir) {
        FileManager.remove(tempDir).catch(() => {})
      }
    }
  }, [resource.url])

  if (status === "loading") {
    return (
      <HStack spacing={8} padding={{ vertical: 8 }}>
        <ProgressView />
        <Text font="caption" foregroundStyle="secondaryLabel">
          正在加载字体预览...
        </Text>
      </HStack>
    )
  }

  if (status === "error") {
    return (
      <Text font="caption" foregroundStyle="secondaryLabel" padding={{ vertical: 8 }}>
        无法加载字体预览
      </Text>
    )
  }

  return (
    <WebView
      controller={wvController}
      frame={{ maxWidth: "infinity", height: contentHeight > 0 ? contentHeight : 400 }}
    />
  )
}
