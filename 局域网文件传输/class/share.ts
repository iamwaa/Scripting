import { Path } from "scripting"
import type { AppEvent, Broadcast, ChatMessage, IncomingPacket } from "../types"
import { chatPageHtml } from "./html"

// 生成随机短 id
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

// 大小写不敏感地读取请求头
function headerValue(headers: Record<string, string>, key: string): string | undefined {
  for (const k in headers) if (k.toLowerCase() === key) return headers[k]
  return undefined
}

// 本机局域网 IPv4：优先 Wi-Fi（en0），个人热点主机走 bridge100
function lanIPv4(): string | undefined {
  const interfaces = Device.networkInterfaces()
  return (
    interfaces?.en0?.filter((i) => i.family === "IPv4")[0]?.address ??
    interfaces?.bridge100?.filter((i) => i.family === "IPv4")[0]?.address
  )
}

/**
 * 本机服务端：既是 HTTP 静态文件/上传服务，也是 WebSocket 文字中转。
 * App UI 与本类同进程，无需自身作为 WS 客户端：
 * WS 事件（文字/连接状态）经 setListener 注入的回调直达 UI；
 * /upload 收到的事件先入 inbox 队列，由页面定时 drainInbox 拉取。
 */
export class Share {
  ip = lanIPv4()
  port: number | null = null
  uploadDir = Path.join(FileManager.documentsDirectory, "uploads")

  private server = new HttpServer()
  private sessions: WebSocketSession[] = []
  private listener: ((e: AppEvent) => void) | null = null
  private started = false
  // 上传收到的事件队列：registerAsyncHandler 的上下文里直接回调 UI（observable setValue）
  // 会导致整个进程崩溃，因此这里只入队，由页面在自己的定时器里 drainInbox 后再刷新
  private inbox: AppEvent[] = []

  /** 注入 App UI 的事件回调（连接状态、收到消息） */
  setListener(fn: ((e: AppEvent) => void) | null) {
    this.listener = fn
  }

  private emit(e: AppEvent) {
    this.listener?.(e)
  }

  /** 页面定时拉取上传收到的事件，取走后队列清空 */
  drainInbox(): AppEvent[] {
    if (this.inbox.length === 0) return []
    const out = this.inbox
    this.inbox = []
    return out
  }

  private broadcast(packet: Broadcast) {
    const text = JSON.stringify(packet)
    for (const session of this.sessions) session.writeText(text)
  }

  /** 启动 HTTP + WebSocket 服务（幂等） */
  async start() {
    if (this.started) return
    await FileManager.createDirectory(this.uploadDir, true)

    this.server = new HttpServer()
    let error = this.server.start({ port: 66666 })
    if (error) {
      this.server = new HttpServer()
      error = this.server.start({ port: 0 })
    }
    if (error) throw new Error(`HTTP 服务启动失败：${error}`)
    this.port = this.server.port
    if (typeof this.port !== "number") throw new Error("HTTP 服务未能获取端口")
    this.started = true

    // 浏览器聊天页
    this.server.registerHandler("/", () => HttpResponse.ok(HttpResponseBody.html(chatPageHtml())))

    // 文件上传（浏览器 → 本机）：浏览器直传原始字节，文件名走 ?name=，类型走 content-type
    // （parseMultiPartFormData 对浏览器请求返回空 part：filename=null、data=undefined，不可用）
    // 全程同步 + 请求体 base64 深拷贝（服务端给的 Data 缓冲可能随请求释放）
    this.server.registerHandler("/upload", (req) => {
      try {
        const ctype = headerValue(req.headers, "content-type") ?? ""
        if (ctype.indexOf("multipart/") === 0) {
          // 旧版浏览器页面缓存仍会发 multipart，明确拒绝
          return HttpResponse.raw(400, "Bad Request", {
            headers: { "content-type": "application/json" },
            body: Data.fromString(JSON.stringify({ ok: false, error: "浏览器页面是旧版，请刷新" }))!,
          })
        }
        let qname = req.queryParams.filter((q) => q.key === "name")[0]?.value
        if (qname && qname.indexOf("%") >= 0) {
          // 服务端若未解码查询参数则手动解码；含合法 % 的文件名解码会抛错并保留原值
          try {
            qname = decodeURIComponent(qname)
          } catch {}
        }
        const dest = this.uniquePath(this.sanitizeName(qname ?? "未命名"))
        const b64 = req.body.toBase64String()
        if (b64 === "") {
          // 空文件（0 字节）无法 base64 往返，直接写空内容
          FileManager.writeAsStringSync(dest, "")
        } else {
          const data = Data.fromBase64String(b64)
          if (!data) throw new Error("上传数据读取失败")
          FileManager.writeAsDataSync(dest, data)
        }
        const stat = FileManager.statSync(dest)
        const mime = ctype || FileManager.mimeType(dest)
        const message: ChatMessage = {
          id: uid(),
          ts: Date.now(),
          role: "browser",
          kind: "file",
          fileName: Path.basename(dest),
          fileSize: stat.size,
          mime,
          url: dest,
        }
        this.inbox.push({ type: "incoming", message })
        return HttpResponse.raw(200, "OK", {
          headers: { "content-type": "application/json" },
          body: Data.fromString(JSON.stringify({ ok: true }))!,
        })
      } catch (e) {
        // 上传异常不能拖垮整个脚本运行时，返回 500 供浏览器端感知
        return HttpResponse.raw(500, "Internal Server Error", {
          headers: { "content-type": "application/json" },
          body: Data.fromString(JSON.stringify({ ok: false, error: String(e) }))!,
        })
      }
    })

    // WebSocket：双向文字与连接状态
    this.server.registerWebsocket("/ws", {
      onConnected: (session) => {
        this.sessions.push(session)
        this.emit({ type: "status", peer: "browser", online: true })
      },
      onDisconnected: (session) => {
        this.sessions = this.sessions.filter((s) => s !== session)
        if (this.sessions.length === 0) this.emit({ type: "status", peer: "browser", online: false })
      },
      handleText: (_session, text) => this.handlePacket(text),
    })
  }

  private handlePacket(raw: string) {
    let packet: IncomingPacket
    try {
      packet = JSON.parse(raw)
    } catch {
      return
    }
    if (packet.type === "text") {
      this.emit({
        type: "incoming",
        message: { id: packet.id, ts: packet.ts, role: "browser", kind: "text", text: packet.text },
      })
    }
  }

  /** App 端发送文字：广播给浏览器并返回本地消息 */
  sendText(text: string): ChatMessage {
    const id = uid()
    const ts = Date.now()
    this.broadcast({ role: "app", type: "text", text, id, ts })
    return { id, ts, role: "app", kind: "text", text }
  }

  /** App 端发送若干文件：注册下载路由并广播 */
  async sendFiles(paths: string[]): Promise<ChatMessage[]> {
    const out: ChatMessage[] = []
    for (const path of paths) {
      const id = uid()
      const ts = Date.now()
      const fileName = Path.basename(path)
      const stat = await FileManager.stat(path)
      const mime = FileManager.mimeType(path)
      this.server.registerFile(`/dl/${id}`, path)
      const message: ChatMessage = {
        id,
        ts,
        role: "app",
        kind: "file",
        fileName,
        fileSize: stat.size,
        mime,
        url: path,
      }
      this.broadcast({ role: "app", type: "file", fileName, fileSize: stat.size, mime, url: `/dl/${id}`, id, ts })
      out.push(message)
    }
    return out
  }

  get link(): string {
    return `http://${this.ip}:${this.port}`
  }

  private sanitizeName(name: string): string {
    return name.replace(/[\/\\]/g, "_").trim() || "未命名"
  }

  private uniquePath(name: string): string {
    let dest = Path.join(this.uploadDir, name)
    if (!FileManager.existsSync(dest)) return dest
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let i = 1
    for (;;) {
      dest = Path.join(this.uploadDir, `${stem} (${i})${ext}`)
      if (!FileManager.existsSync(dest)) return dest
      i++
    }
  }

  stop() {
    this.server.stop()
    this.sessions = []
    this.inbox = []
    this.started = false
    // 会话结束清空上传目录，避免收到的文件在 Documents 累积；下次 start 会重建
    try {
      if (FileManager.existsSync(this.uploadDir)) FileManager.removeSync(this.uploadDir)
    } catch {
      // 清理失败不影响退出
    }
  }
}

export const share = new Share()
