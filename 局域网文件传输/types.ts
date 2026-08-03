// 聊天消息与连接状态的统一类型，App 端与浏览器端共用

/** 消息发送方 */
export type Role = "app" | "browser"

/** 消息类型：纯文字或文件（图片统一归为 file，按 mime 在渲染层区分） */
export type MessageKind = "text" | "file"

/** 统一聊天消息 */
export type ChatMessage = {
  id: string
  /** 时间戳（毫秒） */
  ts: number
  role: Role
  kind: MessageKind
  /** 文字消息内容（kind=text） */
  text?: string
  /** 文件名（kind=file） */
  fileName?: string
  /** 文件字节数（kind=file） */
  fileSize?: number
  /** 文件 MIME（kind=file） */
  mime?: string
  /**
   * 本端可访问的取件地址：
   * - App 发出的文件：URL 相对路径（如 /dl/0），供浏览器下载
   * - 浏览器上传的文件：本机存储的绝对路径，供 App 预览/共享
   */
  url?: string
}

/** 连接到本机的设备类型 */
export type Peer = "app" | "browser"

/** WebSocket 上传输的指令包（仅浏览器→服务端） */
export type IncomingPacket =
  | { type: "text"; text: string; id: string; ts: number }
  | { type: "ping" }

/** HTTPS/WS 服务端→浏览器广播的包 */
export type Broadcast =
  | { type: "status"; peer: Peer; online: boolean }
  | { role: "app"; type: "text"; text: string; id: string; ts: number }
  | { role: "app"; type: "file"; fileName: string; fileSize: number; mime?: string; url: string; id: string; ts: number }

/** App 端注入页面的本地事件 */
export type AppEvent =
  | { type: "status"; peer: Peer; online: boolean }
  | { type: "incoming"; message: ChatMessage }
