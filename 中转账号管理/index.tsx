// 中转账号管理 - 入口文件
import { Script, Navigation } from "scripting"
import { MainView } from "./pages/MainView"

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
