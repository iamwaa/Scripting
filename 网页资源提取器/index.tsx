import { Script, Intent, Navigation } from "scripting"
import { MainView } from "./pages/MainView"
import { getActiveDownloadCount } from "./state/downloadManager"
import { initialViewMode, pageURL } from "./state/appState"
import { extractResources } from "./functions/resourceExtractor"

export { pageURL } from "./state/appState"
export { MainView } from "./pages/MainView"

let isPresenting = false

async function presentMainView() {
  if (isPresenting) return
  isPresenting = true
  await Navigation.present(<MainView />)
  isPresenting = false

  if (getActiveDownloadCount() > 0 && Script.supportsMinimization()) {
    await Script.minimize()
    return
  }

  Script.exit()
}

Script.onResume(() => {
  initialViewMode.setValue("downloads")
  presentMainView()
})

// 入口
async function run() {
  // 从 Safari 插件接收 URL 参数
  const urlParam = Script.queryParameters?.url
  if (urlParam && typeof urlParam === "string") {
    pageURL.setValue(urlParam)
    // 延迟执行以确保 UI 已加载
    setTimeout(() => extractResources(), 100)
  }
  
  await presentMainView()
}

// 仅在非 Intent 模式下自动运行
const _inIntentMode = Intent.urlsParameter !== undefined
  || Intent.textsParameter !== undefined
  || Intent.imagesParameter !== undefined
  || Intent.fileURLsParameter !== undefined
  || Intent.shortcutParameter !== undefined

if (!_inIntentMode) {
  run()
}
