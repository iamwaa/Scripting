// WebView 宿主页面：左上角关闭、右上角「更多」菜单、底部悬浮居中工具栏
// 悬浮栏放 后退 / 前进 / 刷新 / 回首页，更多菜单收纳 Safari 打开、复制链接、分享
import { useState, useEffect, Navigation, NavigationStack, Toolbar, ToolbarItem, Button, HStack, VStack, Image, Menu, WebView } from "scripting"

// 关闭页面：优先让 WebView 控制器 dismiss（呈现模式下无效则跳过），再弹出当前导航栈
function closeWebViewPage(controller: WebViewController, dismiss: () => void) {
  try { controller?.dismiss?.() } catch {}
  dismiss()
}

// 刷新当前网页
function reloadWebViewPage(controller: WebViewController) {
  try { controller?.reload?.() } catch {}
}

// 读取当前网页地址；页面未就绪或取值失败时回退到首页地址
async function getCurrentURL(controller: WebViewController, homeURL?: string) {
  try {
    const url = await controller.evaluateJavaScript<string>("return location.href")
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url
  } catch {}
  return homeURL ?? ""
}

export function WebViewPage({ controller, title, homeURL }: {
  controller: WebViewController
  title: string
  homeURL?: string
}) {
  const dismiss = Navigation.useDismiss()
  // WebView 没有加载完成回调，只能轮询前进/后退可用状态
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    let stopped = false
    const sync = () => {
      if (stopped) return
      try {
        setCanGoBack(controller.canGoBack())
        setCanGoForward(controller.canGoForward())
      } catch {}
      setTimeout(sync, 600)
    }
    sync()
    return () => { stopped = true }
  }, [controller])

  function toast(message: string) {
    setToastMessage(message)
    setShowToast(true)
  }

  // 在系统浏览器打开当前页面，用于内嵌 WebView 过不去安全验证时的兜底
  async function openInSafari() {
    const url = await getCurrentURL(controller, homeURL)
    if (!url) return toast("未获取到当前网页地址")
    await Safari.openURL(url)
  }

  async function copyCurrentURL() {
    const url = await getCurrentURL(controller, homeURL)
    if (!url) return toast("未获取到当前网页地址")
    await Pasteboard.setString(url)
    toast("网页地址已复制")
  }

  async function shareCurrentURL() {
    const url = await getCurrentURL(controller, homeURL)
    if (!url) return toast("未获取到当前网页地址")
    await ShareSheet.present([url])
  }

  // 回到账号主站首页，避免连点后退
  async function goHome() {
    if (!homeURL) return toast("当前页面没有可返回的首页")
    try { await controller.loadURL(homeURL) } catch {}
  }

  // 悬浮工具栏：胶囊形 material 底自适应浅/深色；底部仅保留少量间距
  const floatingBar = (
    <VStack padding={{ bottom: 8 }}>
      <HStack
        spacing={26}
        padding={{ horizontal: 22, vertical: 12 }}
        background="regularMaterial"
        clipShape="capsule"
        shadow={{ color: "rgba(0,0,0,0.18)", radius: 10, y: 4 }}
      >
        <Button action={() => { try { controller.goBack() } catch {} }} disabled={!canGoBack}>
          <Image systemName="chevron.backward" font={18} fontWeight="semibold" />
        </Button>
        <Button action={() => { try { controller.goForward() } catch {} }} disabled={!canGoForward}>
          <Image systemName="chevron.forward" font={18} fontWeight="semibold" />
        </Button>
        <Button action={() => reloadWebViewPage(controller)}>
          <Image systemName="arrow.clockwise" font={18} fontWeight="semibold" />
        </Button>
        <Button action={() => { void goHome() }} disabled={!homeURL}>
          <Image systemName="house" font={18} fontWeight="semibold" />
        </Button>
      </HStack>
    </VStack>
  )

  return (
    <NavigationStack>
      <WebView
        controller={controller}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        bottomBarVisibility="hidden"
                 ignoresSafeArea={{ edges: "bottom" }}
         overlay={{ alignment: "bottom", content: floatingBar }}
        toast={{ message: toastMessage, isPresented: showToast, onChanged: setShowToast, position: "top" }}
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => closeWebViewPage(controller, dismiss)}>
              <Image systemName="xmark" foregroundStyle="systemRed" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Menu label={<Image systemName="ellipsis" foregroundStyle="tintColor" fontWeight="semibold" />}>
              <Button title="在 Safari 中打开" systemImage="safari" action={() => { void openInSafari() }} />
              <Button title="复制链接" systemImage="doc.on.doc" action={() => { void copyCurrentURL() }} />
              <Button title="分享链接" systemImage="square.and.arrow.up" action={() => { void shareCurrentURL() }} />
            </Menu>
          </ToolbarItem>
        </Toolbar>}
      />
    </NavigationStack>
  )
}

// 以工具栏模式呈现 WebView（替代 webView.present），页面关闭后 Promise resolve
export async function presentWebViewWithToolbar(controller: WebViewController, title: string, homeURL?: string) {
  await Navigation.present(<WebViewPage controller={controller} title={title} homeURL={homeURL} />)
}
