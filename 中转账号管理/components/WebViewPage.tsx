// 带「关闭 / 刷新」原生工具栏的 WebView 宿主页面
// 刷新按钮位于右上角 topBarTrailing，替代之前悬浮注入的 JS 刷新按钮
import { Navigation, NavigationStack, Toolbar, ToolbarItem, Button, Image, WebView } from "scripting"

// 关闭页面：优先让 WebView 控制器 dismiss（呈现模式下无效则跳过），再弹出当前导航栈
function closeWebViewPage(controller: WebViewController, dismiss: () => void) {
  try { controller?.dismiss?.() } catch {}
  dismiss()
}

// 刷新当前网页
function reloadWebViewPage(controller: WebViewController) {
  try { controller?.reload?.() } catch {}
}

// 宿主页面组件：WebView 填满屏幕，顶部导航栏左侧关闭、右侧刷新
export function WebViewPage({ controller, title }: { controller: WebViewController, title: string }) {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <WebView
        controller={controller}
        navigationTitle={title}
        navigationBarTitleDisplayMode="inline"
        toolbar={<Toolbar>
          <ToolbarItem placement="topBarLeading">
            <Button action={() => closeWebViewPage(controller, dismiss)}>
              <Image systemName="xmark" foregroundStyle="systemRed" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Button action={() => reloadWebViewPage(controller)}>
              <Image systemName="arrow.clockwise" foregroundStyle="tintColor" fontWeight="semibold" />
            </Button>
          </ToolbarItem>
        </Toolbar>}
      />
    </NavigationStack>
  )
}

// 以工具栏模式呈现 WebView（替代 webView.present），页面关闭后 Promise resolve
export async function presentWebViewWithToolbar(controller: WebViewController, title: string) {
  await Navigation.present(<WebViewPage controller={controller} title={title} />)
}