import { Script, Intent, Navigation } from "scripting"
import { MainView } from "./pages/MainView"

export { pageURL } from "./state/appState"
export { MainView } from "./pages/MainView"

// 入口
async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
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
