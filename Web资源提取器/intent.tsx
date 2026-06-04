import { Intent, Script, Navigation } from "scripting"
import { pageURL, MainView } from "./index"

function resolveInputURL(): string | null {
  // 优先从 Share Sheet 传入的链接获取
  if (Intent.urlsParameter?.length) {
    return Intent.urlsParameter[0]
  }

  if (Intent.textsParameter?.length) {
    for (const text of Intent.textsParameter) {
      const match = text.match(/https?:\/\/[^\s]+/)
      if (match) return match[0]
    }
  }

  const shortcut = Intent.shortcutParameter
  if (shortcut?.type === "fileURL" && typeof shortcut.value === "string") {
    return shortcut.value
  }
  if (shortcut?.type === "text" && typeof shortcut.value === "string") {
    const match = shortcut.value.match(/https?:\/\/[^\s]+/)
    if (match) return match[0]
  }

  return null
}

async function run() {
  const url = resolveInputURL()

  if (!url) {
    Script.exit(Intent.text("未接收到有效的 URL"))
    return
  }

  pageURL.setValue(url.trim())

  await Navigation.present(<MainView />)
  Script.exit()
}

run()
