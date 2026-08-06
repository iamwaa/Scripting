import {
  ProgressView,
  VStack,
  WebView,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"

// 图片查看器页面：缩放、双击放大与惯性平移交给 WebKit 原生处理
function buildHTML(url: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #000;
    -webkit-user-select: none;
    user-select: none;
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  img {
    max-width: 100%;
    max-height: 100%;
    -webkit-touch-callout: none;
    /* 加载完成前不显示，避免出现半张图 */
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  img.ready {
    opacity: 1;
  }
  .spinner {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 32px;
    height: 32px;
    margin: -16px 0 0 -16px;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .spinner.hidden {
    display: none;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .failed {
    color: #fff;
    font: 15px -apple-system;
  }
</style>
</head>
<body>
<div class="stage" id="stage">
  <img id="photo" src="${url}" alt="">
</div>
<div class="spinner" id="spinner"></div>
<script>
  var photo = document.getElementById("photo")
  var stage = document.getElementById("stage")
  var spinner = document.getElementById("spinner")

  function hideSpinner() {
    spinner.classList.add("hidden")
  }

  function showPhoto() {
    hideSpinner()
    photo.classList.add("ready")
  }

  // 缓存命中时 load 可能已错过，靠 complete 补一次
  if (photo.complete && photo.naturalWidth > 0) {
    showPhoto()
  } else {
    photo.addEventListener("load", showPhoto)
  }

  photo.addEventListener("error", function () {
    hideSpinner()
    stage.innerHTML = '<div class="failed">图片加载失败</div>'
  })

  // 仅在未缩放且未发生位移时把单击视为关闭
  var startX = 0
  var startY = 0
  document.addEventListener("touchstart", function (event) {
    var touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY
  }, { passive: true })

  document.addEventListener("touchend", function (event) {
    if (event.touches.length > 0) {
      return
    }
    var touch = event.changedTouches[0]
    var moved = Math.abs(touch.clientX - startX) > 8 || Math.abs(touch.clientY - startY) > 8
    var zoomed = window.visualViewport && window.visualViewport.scale > 1.01
    if (moved || zoomed) {
      return
    }
    window.webkit.messageHandlers.closeViewer.postMessage(null)
  }, { passive: true })
</script>
</body>
</html>`
}

export function ImageViewer({
  url,
  onClose,
}: {
  url: string
  onClose: () => void
}) {
  // 控制器随图片地址重建，避免复用已 dispose 的实例
  const controller = useMemo(() => new WebViewController(), [url])
  const [webViewReady, setWebViewReady] = useState(false)

  useEffect(() => {
    let disposed = false

    async function setup() {
      await controller.addScriptMessageHandler("closeViewer", () => {
        onClose()
      })
      if (!disposed) {
        await controller.loadHTML(buildHTML(url))
      }
      // WebView 自身初始化期间是黑屏，就绪后再撤掉原生指示器
      if (!disposed) {
        setWebViewReady(true)
      }
    }

    setup()

    return () => {
      disposed = true
      controller.dispose()
    }
    // url 变化时必须重新加载，否则多张图片只会显示首次打开的那张
  }, [url])

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
      ignoresSafeArea={{ regions: "all", edges: "all" }}
    >
      {webViewReady ? null : <ProgressView progressViewStyle="circular" tint="white" />}
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <WebView controller={controller} />
      </VStack>
    </ZStack>
  )
}
