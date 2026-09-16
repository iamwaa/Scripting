# PROJECT_MEMORY

局域网文件传输：本机跑 HttpServer + WebSocket，浏览器打开 `http://<局域网IP>:<port>` 与 App 互传文字和文件。

## 结构

- `index.tsx` / `intent.tsx`：两个入口，都只调用 `launch.tsx` 的 `runChat(files?)`。
- `launch.tsx`：启动服务 → 保活 → present 聊天页 → 关闭后停服并 `Script.exit()`。
- `class/share.ts`：单例 `share`，HTTP 路由（`/`、`/upload`、`/dl/<id>`）+ WS `/ws`。
- `class/html.ts`：浏览器端聊天页 HTML。
- `page/index.tsx`：App 聊天页；`components/Bubble.tsx` 气泡。

## 关键约定

- **intent 入口必须在任何 `await` 之前用同步 API 把共享文件拷进沙箱**（`intent.tsx` 的 `stageSync`，用 `existsSync` / `createDirectorySync` / `copyFileSync`），之后全程用副本路径。原因：共享路径的安全作用域只在 intent 启动的同步阶段可靠。`.json` / `.zip` / 图片这类系统会预先拷进收件箱的类型，晚点读也正常；`.exe` 等未识别类型给的是原位置路径，等聊天页挂载（已跨过 `share.start()` 等多个 await）再 `stat` 就抛「没有查看它的权限」。
  - 注意：**不是**「入口保持极简、原始值直传」——那个版本对 `.exe` 依然失败，已实测推翻。
  - 也不要用 `async` 的 `FileManager.copyFile` 做暂存，`await` 一旦跨过作用域就晚了。
  - `stageSync` 失败时回退原始路径，交给 `share.sendFiles` 统一报错，不在入口中断整批。
- **不要用 `FileManager.getAllFileBookmarks()` 按文件名兜底找路径**：该列表是全局的（含其他项目、.Trash 里的无关文件），按 basename 匹配会解析到错误文件。另：`addFileBookmark` / `bookmarkedPath` 在当前构建里可能是 `undefined`。
- 文件内容本身无需按扩展名特殊处理：`.exe` 实测 `stat` / `mimeType`（`application/x-msdownload`）/ `registerFile` / HTTP GET 全部正常，问题只在路径权限时效。
- `sendFiles(paths, onFailed?)` 单个文件失败不中断整批，失败项回调给页面提示，并引导用 App 内「选取文件」重选（`DocumentPicker` 路径权限正常）。
- `/upload` 的 handler 里不能直接回调 UI（observable setValue 会崩进程），只能 push 到 `inbox`，由页面定时 `drainInbox`。
- `/upload` 走原始字节 + `?name=`，不用 `parseMultiPartFormData`（对浏览器请求返回空 part）。
