import { Script, Navigation } from "scripting"
import { RootView } from "./src/pages/RootView"

async function run() {
  await Navigation.present(<RootView />)
  // 页面关闭后退出，避免内存泄漏
  Script.exit()
}

run()
