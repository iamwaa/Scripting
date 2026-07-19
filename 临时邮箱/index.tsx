import { Script, Navigation, NavigationStack } from "scripting"
import { HomePage } from "./pages/HomePage"
import { startPolling } from "./utils/polling"

function View() {
  return (
    <NavigationStack>
      <HomePage />
    </NavigationStack>
  )
}

let presenting = false

async function presentMainView() {
  if (presenting) {
    return
  }
  presenting = true
  try {
    await Navigation.present(<View />)
  } finally {
    presenting = false
    // UI 关闭后保留脚本进程，开启后台轮询
    startPolling()
    Script.minimize()
  }
}

// 从通知或外部触发时重新打开 UI
Script.onResume(() => {
  presentMainView()
})

presentMainView()
