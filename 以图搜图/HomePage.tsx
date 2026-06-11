import {
  Button,
  Form,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useState,
} from "scripting"

import { SauceNaoResultPage } from "./SauceNaoResultPage"
import { TraceMoeResultPage } from "./TraceMoeResultPage"
import { uploadToBaiduGraph } from "./baiduService"
import { buildSearchURL, searchEngines } from "./searchEngines"
import { uploadImageForSearch } from "./uploadService"

const selectedEngineStorageKey = "selected-engine-name"
const mobileSafariUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

type AppProps = {
  initialImage?: UIImage | null
}

export function App({ initialImage = null }: AppProps) {
  const [image, setImage] = useState<UIImage | null>(initialImage)
  const [imageURL, setImageURL] = useState<string | null>(null)
  const [selectedEngineIndex, setSelectedEngineIndex] = useState(() => readLastSelectedEngineIndex())
  const [toastMessage, setToastMessage] = useState(
    initialImage ? "已接收分享图片。选择搜索引擎后点击“搜索”。" : "请选择一张图片开始搜索。",
  )
  const [isToastPresented, setIsToastPresented] = useState(Boolean(initialImage))
  const [isBusy, setIsBusy] = useState(false)
  const selectedEngine = searchEngines[selectedEngineIndex] ?? searchEngines[0]
  const dismiss = Navigation.useDismiss()

  function showToast(message: string) {
    setToastMessage(message)
    setIsToastPresented(true)
  }

  function selectEngine(index: number) {
    setSelectedEngineIndex(index)
    const engine = searchEngines[index]
    if (engine) {
      Storage.set(selectedEngineStorageKey, engine.displayName)
    }
  }

  async function pickImage() {
    setIsBusy(true)
    showToast("正在打开相册…")
    try {
      const results = await Photos.pick({
        filter: PHPickerFilter.images(),
        limit: 1,
        mode: "default",
      })
      const pickedImage = await results[0]?.uiImage()
      if (!pickedImage) {
        showToast("未选择图片。")
        return
      }
      applyImage(pickedImage, "已选择图片。选择搜索引擎后点击“搜索”。")
    } catch (error) {
      showToast(`选图失败：${String(error)}`)
    } finally {
      setIsBusy(false)
    }
  }

  async function takePhoto() {
    setIsBusy(true)
    showToast("正在打开相机…")
    try {
      const capturedImage = await Photos.takePhoto()
      if (!capturedImage) {
        showToast("未拍摄照片。")
        return
      }
      applyImage(capturedImage, "已拍摄照片。选择搜索引擎后点击“搜索”。")
    } catch (error) {
      showToast(`拍照失败：${String(error)}`)
    } finally {
      setIsBusy(false)
    }
  }

  function applyImage(nextImage: UIImage, nextStatus: string) {
    setImage(nextImage)
    setImageURL(null)
    showToast(nextStatus)
    void Pasteboard.setImage(nextImage)
  }

  async function searchImage() {
    if (!image) {
      showToast("请先选择图片。")
      return
    }

    setIsBusy(true)
    showToast(`正在准备图片并使用 ${selectedEngine.displayName} 搜索…`)
    try {
      if (selectedEngine.kind === "baidu") {
        showToast("正在上传到百度识图并打开结果页…")
        const baiduURL = await uploadToBaiduGraph(image)
        showToast("已在全屏移动端网页中打开百度识图搜索结果。")
        await presentMobileWebResult(baiduURL, selectedEngine.displayName, { adaptsBaiduLayout: true })
        return
      }

      const uploadedURL = await uploadImageForSearch(image)
      setImageURL(uploadedURL)
      await Pasteboard.setString(uploadedURL)

      if (selectedEngine.kind === "tracemoe") {
        showToast("正在打开 TraceMoe 原生结果页…")
        await Navigation.present(<TraceMoeResultPage imageURL={uploadedURL} />)
        return
      }

      if (selectedEngine.kind === "saucenao") {
        showToast("正在打开 SauceNAO 原生结果页…")
        await Navigation.present(<SauceNaoResultPage imageURL={uploadedURL} />)
        return
      }

      showToast(`已在全屏移动端网页中打开 ${selectedEngine.displayName} 搜索结果。`)
      await presentMobileWebResult(buildSearchURL(selectedEngine.template, uploadedURL), selectedEngine.displayName)
    } catch (error) {
      showToast(`搜索失败：${String(error)}`)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="以图搜图"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button action={dismiss}>
                <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
        toast={{
          message: toastMessage,
          isPresented: isToastPresented,
          onChanged: setIsToastPresented,
          position: "top",
          duration: 2,
        }}
      >
        <Section
          footer={
            <Text>
              选择图片和搜索引擎后点击“搜索”，图片会即时上传并在项目内显示搜索结果。
              {imageURL ? ` 最近一次搜索链接：${imageURL}` : ""}
            </Text>
          }
        >
          {image ? (
            <VStack alignment="center" spacing={10} padding={{ vertical: 10 }} frame={{ maxWidth: Infinity }}>
              <Image image={image} resizable scaleToFit frame={{ maxHeight: 260 }} clipShape="rect" />
              <Text>{`${Math.round(image.width)} × ${Math.round(image.height)} px`}</Text>
            </VStack>
          ) : (
            <VStack alignment="center" spacing={10} padding={{ vertical: 24 }} frame={{ maxWidth: Infinity }}>
              <Image systemName="photo.badge.plus" font={54} foregroundStyle="gray" />
              <Text>还没有选择图片</Text>
            </VStack>
          )}

          <Button action={() => void pickImage()}>
            <ActionRow systemImage="photo.on.rectangle" title="从相册选择" />
          </Button>
          <Button action={() => void takePhoto()}>
            <ActionRow systemImage="camera" title="拍照搜索" />
          </Button>
          <Picker
            label={<ActionRow systemImage="magnifyingglass" title="搜索引擎" />}
            value={selectedEngineIndex}
            onChanged={selectEngine}
          >
            {searchEngines.map((engine, index) => (
              <Text tag={index} lineLimit={1} minScaleFactor={0.72} allowsTightening>
                {engine.displayName}
              </Text>
            ))}
          </Picker>
          <Button action={() => void searchImage()} disabled={isBusy}>
            <ActionRow systemImage="magnifyingglass.circle.fill" title={isBusy ? "搜索中…" : "搜索"} />
          </Button>
        </Section>
      </Form>
    </NavigationStack>
  )
}

type MobileWebResultOptions = {
  adaptsBaiduLayout?: boolean
}

async function presentMobileWebResult(url: string, navigationTitle: string, options: MobileWebResultOptions = {}) {
  const webView = new WebViewController()
  webView.setCustomUserAgent(mobileSafariUserAgent)
  await webView.loadHTML(buildLoadingPageHTML(navigationTitle))

  void (async () => {
    try {
      await webView.loadURL(url)
      await applyMobileViewport(webView)
      await applyResponsiveWidthLimit(webView, Boolean(options.adaptsBaiduLayout))
    } catch (error) {
      await webView.loadHTML(buildLoadFailedPageHTML(navigationTitle, String(error)))
    }
  })()

  try {
    await webView.present({ navigationTitle })
  } finally {
    webView.dispose()
  }
}

function buildLoadingPageHTML(title: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      background: Canvas;
      color: CanvasText;
    }
    .card {
      width: min(100%, 320px);
      padding: 0;
      text-align: center;
    }
    .spinner {
      width: 42px;
      height: 42px;
      margin: 0 auto 18px;
      border: 4px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-top-color: #0a84ff;
      border-radius: 999px;
      animation: spin 0.85s linear infinite;
    }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 15px; line-height: 1.5; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="card">
    <div class="spinner"></div>
    <h1>正在打开${escapeHTML(title)}</h1>
    <p>网页结果加载中，请稍候…</p>
  </main>
</body>
</html>`
}

function buildLoadFailedPageHTML(title: string, message: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; background: Canvas; color: CanvasText; }
    .card { width: min(100%, 340px); padding: 24px 20px; border-radius: 22px; background: color-mix(in srgb, CanvasText 7%, Canvas); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHTML(title)}加载失败</h1>
    <p>${escapeHTML(message)}</p>
  </main>
</body>
</html>`
}

function escapeHTML(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

async function applyMobileViewport(webView: WebViewController) {
  await webView.evaluateJavaScript(`
    const viewport = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
    if (!viewport.parentNode) document.head.appendChild(viewport);
    document.documentElement.style.maxWidth = '100vw';
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.maxWidth = '100vw';
    document.body.style.overflowX = 'hidden';
    document.body.style.webkitTextSizeAdjust = '100%';
    true;
  `)
}

async function applyResponsiveWidthLimit(webView: WebViewController, preferSingleColumn = false) {
  await webView.evaluateJavaScript(`
    const styleId = 'scripting-responsive-width-limit';
    const screenWidth = () => Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
    const pageWidth = () => Math.max(
      document.documentElement.scrollWidth || 0,
      document.body?.scrollWidth || 0,
      ...Array.from(document.body?.children || []).map(element => Math.ceil(element.getBoundingClientRect().right))
    );
    const ensureStyle = () => {
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = \`
        html, body {
          width: 100vw !important;
          min-width: 0 !important;
          max-width: 100vw !important;
          overflow-x: hidden !important;
        }
        body { margin-left: 0 !important; margin-right: 0 !important; }
        body > *, #app, #root, .app, .main, .container, .wrapper,
        [class*="container"], [class*="wrapper"], [class*="content"] {
          min-width: 0 !important;
          max-width: 100vw !important;
          box-sizing: border-box !important;
        }
        img, video, canvas, table, iframe {
          max-width: 100% !important;
        }
        [style*="min-width"], [style*="width"] {
          min-width: 0 !important;
          max-width: 100vw !important;
        }
        ${preferSingleColumn ? `
        [class*="grid"], [class*="list"], [class*="waterfall"], [class*="similar"] {
          display: block !important;
          column-count: 1 !important;
          grid-template-columns: 1fr !important;
        }
        [class*="card"], [class*="item"], [class*="result"] {
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          margin-left: 8px !important;
          margin-right: 8px !important;
        }
        ` : ''}
      \`;
    };
    const fixWideElements = () => {
      const viewportWidth = screenWidth();
      if (pageWidth() <= viewportWidth + 8) return false;

      ensureStyle();
      document.querySelectorAll('[style]').forEach(element => {
        const styleText = element.getAttribute('style') || '';
        if (/min-width\s*:\s*\d{3,}|width\s*:\s*\d{3,}/i.test(styleText)) {
          element.style.minWidth = '0';
          element.style.maxWidth = '100vw';
          if (element.getBoundingClientRect().width > viewportWidth) {
            element.style.width = '100%';
          }
        }
      });
      return true;
    };
    fixWideElements();
    setInterval(fixWideElements, 1200);
    true;
  `)
}

function readLastSelectedEngineIndex() {
  const savedName = Storage.get<string>(selectedEngineStorageKey)
  const index = savedName ? searchEngines.findIndex(engine => engine.name === savedName || engine.displayName === savedName) : -1
  return index >= 0 ? index : 0
}

function ActionRow({ systemImage, title }: { systemImage: string; title: string }) {
  return (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Image
        systemName={systemImage}
        frame={{ width: 28, height: 24, alignment: "center" }}
        foregroundStyle="accentColor"
      />
      <Text foregroundStyle="accentColor" frame={{ alignment: "leading" }} lineLimit={1} minScaleFactor={0.75} allowsTightening>
        {title}
      </Text>
      <Spacer />
    </HStack>
  )
}
