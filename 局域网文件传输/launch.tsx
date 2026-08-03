import { Navigation, NavigationStack, Script } from "scripting"
import { share } from "./class/share"
import { ChatPage } from "./page"

// index 与 intent 两个入口共用的启动流程：启动服务 → 保活 → 弹出聊天页 → 页面关闭后收尾退出
export function runChat(initialFiles?: string[]) {
  const main = async () => {
    if (!share.ip) throw new Error("当前不处于局域网")
    await share.start()
    const started = await BackgroundKeeper.keepAlive()
    await Navigation.present({
      element: (
        <NavigationStack>
          <ChatPage initialFiles={initialFiles} />
        </NavigationStack>
      ),
      modalPresentationStyle: "pageSheet",
    })
    if (started) await BackgroundKeeper.stopKeepAlive()
    share.stop()
  }
  main()
    .catch(async (e) => {
      await Dialog.alert({ title: "错误", message: String(e) })
    })
    .finally(() => Script.exit())
}
