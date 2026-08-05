import {
  Button,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationStack,
  QRImage,
  Rectangle,
  ScrollView,
  ScrollViewReader,
  Script,
  Text,
  TextField,
  VStack,
  ZStack,
  useEffect,
  useKeyboardVisible,
  useObservable,
  useRef,
  type ScrollViewProxy,
} from "scripting"
import { Bubble } from "../components/Bubble"
import { share } from "../class/share"
import type { AppEvent, ChatMessage } from "../types"

const pageColor = { light: "#ffffff", dark: "#000000" } as const
const barColor = { light: "#f2f2f7", dark: "#1c1c1e" } as const

export function ChatPage({ initialFiles }: { initialFiles?: string[] }) {
  const dismiss = Navigation.useDismiss()
  const messages = useObservable<ChatMessage[]>([])
  const input = useObservable<string>("")
  const online = useObservable<boolean>(false)
  const qr = useObservable<boolean>(false)
  const keyboardVisible = useKeyboardVisible()
  const proxyRef = useRef<ScrollViewProxy | null>(null)

  // 绑定服务端事件：状态 + 收到的消息
  useEffect(() => {
    share.setListener((e: AppEvent) => {
      if (e.type === "status") online.setValue(e.online)
      else if (e.type === "incoming") messages.setValue([...messages.value, e.message])
    })
    return () => share.setListener(null)
  }, [])

  // 定时拉取上传收到的事件（上传 handler 不直接触达 UI，见 share.inbox）
  useEffect(() => {
    let disposed = false
    let timer = 0
    const tick = () => {
      if (disposed) return
      const events = share.drainInbox()
      const incoming = events.flatMap((e) => (e.type === "incoming" ? [e.message] : []))
      if (incoming.length > 0) messages.setValue([...messages.value, ...incoming])
      timer = setTimeout(tick, 500)
    }
    timer = setTimeout(tick, 500)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [])

  // 初始待发文件（intent 传入）
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) void sendFiles(initialFiles)
  }, [])

  // 新消息滚到底
  useEffect(() => {
    const list = messages.value
    const last = list[list.length - 1]
    if (last) proxyRef.current?.scrollTo(last.id, "bottom")
  }, [messages.value.length])

  async function sendFiles(paths: string[]) {
    if (paths.length === 0) return
    const msgs = await share.sendFiles(paths)
    if (msgs.length) messages.setValue([...messages.value, ...msgs])
  }

  function sendText() {
    const t = input.value.trim()
    if (!t) return
    messages.setValue([...messages.value, share.sendText(t)])
    input.setValue("")
  }

  async function onPickPhotos() {
    await sendFiles(await pickFromPhotos())
  }

  async function onCapture() {
    await sendFiles(await captureMedia())
  }

  async function onPickFiles() {
    const paths = await DocumentPicker.pickFiles({ allowsMultipleSelection: true })
    await sendFiles(paths)
  }

  // 从相册选取图片/视频，逐项读出并复制到沙盒后返回文件路径
  async function pickFromPhotos(): Promise<string[]> {
    const results = await Photos.pick({ limit: 9 })
    const paths: string[] = []
    for (const r of results) {
      const p = (await r.imagePath()) ?? (await r.videoPath())
      if (p) paths.push(p)
    }
    return paths
  }

  async function captureMedia(): Promise<string[]> {
    const info = await Photos.capture({ mode: "photo", mediaTypes: ["public.image", "public.movie"] })
    const p = info?.imagePath ?? info?.mediaPath
    return p ? [p] : []
  }

  return (
    <ZStack
      frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      navigationTitle="文件传输"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: [<Button title="关闭" systemImage="xmark" tint="red" action={dismiss} />],
        topBarTrailing: [
          <Button title="二维码" systemImage="qrcode" action={() => qr.setValue(true)} />,
          <Button title="最小化" systemImage="chevron.down" action={() => Script.minimize()} />,
        ],
      }}
      sheet={{
        isPresented: qr,
        content: <QRSheet link={share.link} onClose={() => qr.setValue(false)} />,
      }}
      safeAreaInset={{
        bottom: {
          spacing: 0,
          content: <Composer input={input} keyboardVisible={keyboardVisible} onSend={sendText} onPickPhotos={onPickPhotos} onCapture={onCapture} onPickFiles={onPickFiles} />,
        },
      }}>
      <Rectangle fill={pageColor} frame={{ maxWidth: Infinity, maxHeight: Infinity }} />
      <VStack frame={{ maxWidth: Infinity, maxHeight: Infinity }} spacing={0}>
        <HStack spacing={6} padding={{ horizontal: 14, top: 8, bottom: 6 }}>
          <Image systemName={online.value ? "circle.fill" : "circle"} foregroundStyle={online.value ? "systemGreen" : "tertiaryLabel"} font={10} />
          <Text font={13} foregroundStyle="secondaryLabel">{online.value ? "浏览器已连接" : "等待浏览器连接…"}</Text>
        </HStack>
        <ScrollViewReader>
          {(proxy) => {
            proxyRef.current = proxy
            return (
              <ScrollView
                frame={{ maxWidth: Infinity, maxHeight: Infinity }}
                scrollDismissesKeyboard="interactively">
                <VStack spacing={10} padding={14}>
                  {messages.value.map((m) => (
                    <Bubble key={m.id} message={m} />
                  ))}
                </VStack>
              </ScrollView>
            )
          }}
        </ScrollViewReader>
      </VStack>
    </ZStack>
  )
}

// 底部输入栏
function Composer({
  input,
  keyboardVisible,
  onSend,
  onPickPhotos,
  onCapture,
  onPickFiles,
}: {
  input: ReturnType<typeof useObservable<string>>
  keyboardVisible: boolean
  onSend: () => void
  onPickPhotos: () => void
  onCapture: () => void
  onPickFiles: () => void
}) {
  return (
    // 悬浮胶囊输入栏：外层留左右边距，内层整行包在胶囊形容器里
    <HStack padding={{ horizontal: 16, top: 6, bottom: keyboardVisible ? 6 : 10 }} frame={{ maxWidth: Infinity }}>
      <HStack
        spacing={8}
        padding={{ horizontal: 12, vertical: 8 }}
        background={{ style: barColor, shape: "capsule" }}
        frame={{ maxWidth: Infinity }}>
        <Menu label={<Image systemName="paperclip" font={22} foregroundStyle="systemBlue" />}>
          <Button title="选取文件" systemImage="folder" action={onPickFiles} />
          <Button title="照片图库" systemImage="photo.on.rectangle.angled" action={onPickPhotos} />
          <Button title="拍照或录像" systemImage="camera" action={onCapture} />
        </Menu>
        <TextField
          label={<Text>{""}</Text>}
          value={input.value}
          onChanged={(v) => input.setValue(v)}
          prompt="说点什么…"
          textFieldStyle="plain"
          frame={{ maxWidth: Infinity }}
        />
        <Button action={onSend} buttonStyle="plain">
          <Image systemName="arrow.up.circle.fill" font={30} foregroundStyle="systemBlue" />
        </Button>
      </HStack>
    </HStack>
  )
}

function QRSheet({
  link,
  onClose,
}: {
  link: string
  onClose: () => void
}) {
  return (
    <NavigationStack presentationDetents={["medium"]}>
      <VStack
        spacing={16}
        padding={{ horizontal: 24, vertical: 20 }}
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
        navigationTitle="二维码"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="关闭" systemImage="xmark" action={onClose} />,
          topBarTrailing: <Button title="复制链接" systemImage="doc.on.doc" action={() => Pasteboard.setString(link)} />,
        }}>
        <VStack background={{ style: "white", shape: { type: "rect", cornerRadius: 20, style: "continuous" } }} padding={12}>
          <QRImage data={link} size={220} />
        </VStack>
        <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>{link}</Text>
      </VStack>
    </NavigationStack>
  )
}
