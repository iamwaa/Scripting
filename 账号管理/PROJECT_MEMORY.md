# 账号管理 项目记忆

## 架构

| 文件 | 职责 |
| --- | --- |
| `index.tsx` | 入口：Face ID 启动校验 + TabView（账号/书签/搜索/设置），持有 accounts、bookmarks、groups、webdav、安全设置等全局状态 |
| `pages.tsx` | 页面级组件：编辑页、预览页、列表页、分组页、搜索页、设置页 |
| `components.tsx` | 行与通用组件：`LetterIcon`、`AvatarIcon`、`FormRow`、`TagPicker`、`AccountRow`、`BookmarkRow` |
| `utils.ts` | 存储、加密（AES-GCM）、排序、URL 规范化、站点信息拓取、WebDAV |
| `icons.ts` | 图标库订阅 + 图标本地缓存（新增） |
| `IconLibraryPages.tsx` | 图标选择器 `IconPickerPage` 与订阅管理页 `IconLibraryPage`（新增） |

## 数据存储

- 数据目录 `DATA_DIR = Documents/configs/账号管理数据`（`utils.ts` 导出），文件一律用 `encryptPayload` 加密：`accounts.json`、`bookmarks.json`、`account_groups.json`、`bookmark_groups.json`、`webdav.json`、`security_settings.json`、`icon_libraries.json`。
- **图标缓存不放在数据目录**，而是 `FileManager.appGroupDocumentsDirectory/icon_cache`：图片体积大，避免随 iCloud 同步。缓存文件名为 URL 的 FNV 双哈希（无扩展名），不写索引文件，按存在性判断命中。
- 缓存统计用 `FileManager.readDirectory`（返回的是**文件名**，必须 `Path.join` 回目录再 `stat`）。

## 图标库订阅（icons.ts）

- 订阅地址接受两种 JSON：`{ name?, icons: [{ name, url }] }` 或直接是图标数组（元素可为 `{name,url}` 或字符串）。
- **兼容 selfh.st/icons 索引**：条目形如 `{ Name, Reference, PNG: "Yes" }` 且无 url 时，按订阅地址同级目录拼 `<base>/png/<Reference>.png`；`PNG !== "Yes"` 的条目跳过。
- 可用示例地址：`https://cdn.jsdelivr.net/gh/selfhst/icons@main/index.json`（约 2900 个 PNG 图标，实测拉取约 3.4s、约 870KB）。
- 超过 `LIBRARY_STALE_MS`（7 天）或 icons 为空时，打开选择器会自动后台刷新；刷新失败保留旧图标并记 `lastError`。

## 图标显示链路（AvatarIcon）

优先级：本地缓存文件（`UIImage.fromFile`）→ 远程 `imageUrl`（未命中缓存且下载失败时）→ 字母图标。
未命中缓存时会自行下载一次并落盘，因此首次显示图标会有极短暂字母占位；**不要改回直接用 `imageUrl` 渲染**，否则每次渲染都会重新请求，缓存失效。

## 图标下载调度（icons.ts）

所有图标下载都走 `icons.ts` 的调度队列，**不要在页面里直接 `fetch` 图标绕开它**，否则优先级失效：

- 并发上限 `MAX_CONCURRENT_DOWNLOADS`（6），分 `high` / `normal` 两条队列，每次都从 high 出队；按 URL 去重（排队中也共享同一个 Promise），下载带 20s 超时（避免卡死的请求占住并发名额）。
- `resolveIconPath()` 走 normal；`prefetchIcons(urls)` 走 high，返回 `{ cancel() }`（只丢弃本文批创建的、还没开始的排队任务）。已在队列里的任务会被「插队」——提到 high 队列尾部，因此在它前面先入队的可见图标仍然先下载。
- 图标选择器：关键词变化时（防抖 150ms）把命中的前 `MAX_SEARCH_PREFETCH`（60）个图标按 high 预取，旧批次先 cancel；行 `onAppear` 再把可见行的 4 个图标插队。效果是一边输入一边就能看到真实图标，滚动到的图标也不会排在整库下载之后。

## 已知限制

- `UIImage` 无法解析 SVG（`fromData`/`fromFile` 均返回 null），所以图标库只采用 PNG 地址。
- 单张图标超过 `MAX_ICON_BYTES`（2MB）或 Content-Type 非 `image/*` 且文件头不像图片时，不写入缓存。
- 图标选择器里 `searchable` 用 `navigationBarDrawerAlwaysDisplay`；网格按 4 列分块，每块一行 `HStack`（未用 LazyVGrid，保证在 List 内布局稳定）。
