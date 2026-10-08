# MEMORY.md

跨工作区长期约定。本文件每轮完整注入，只写技能和官方文档没有覆盖的触发条件、短规则与用户偏好，细节交给对应技能；体积大、只在特定场景用得上的长内容（如组件完整实现）拆到 `memories/`，正文只留一行指针，需要时再读。过时或被新决策取代的内容及时改删。

结构：**工作流程**（任务开始到交付的动作）→ **代码与 UI**（写码时的硬约束）→ **踩坑记录**（跨项目通用的实测经验，随时追加）。

---

# 工作流程

## 项目记忆

项目专属且长期有效的记忆写入 `scripts/<项目名>/PROJECT_MEMORY.md`：

- 开始项目相关任务时，若该文件存在，先读它再分析或修改项目。
- 用它沉淀项目架构、关键约束、长期决策、稳定命令、已知陷阱、维护约定；优先修订已有条目，不重复追加。
- 不写一次性进度、临时调试结果、日志、生成物、密钥和 Token。
- 跨项目通用的用户偏好和长期约定留在本文件，不复制进各项目。
- 它是下文「文件落盘」中「项目目录只存项目所需源码与资产」的明确例外，允许留在项目根目录。

## 编辑流程

修改 `scripts/<项目名>/` 下的项目文件时，按需依次使用技能（各自细节读其 SKILL.md）：

1. `project-auto-backup`：编辑前备份。
2. `karpathy-guidelines`：先明确约束、假设与最窄成功标准，再做局部改动。
3. `project-file-organization`：新建文件、扩展结构、重组项目，或本次修改的源文件达到 `300+` 行时，按其目录规范与单文件行数分档做结构审查（可运行该技能目录下的 `scripts/check.py`，注意不是项目根 `scripts/`；结果仅作审查输入）。
4. `project-code-cleanup`：源码修改后、交付前清理并执行最窄有效检查。

只读、仅修改记忆、用户明确不编辑，以及仅处理生成物/vendor/锁文件时，可跳过上述流程。

## 实测探针

需要用项目真实 Storage 配置或项目模块做实测时，按 [项目内探针](memories/project-storage-probe.md) 用临时 `intent.tsx` + `run_intent`，不要用独立文件 `scripting-ts run`（读不到项目 Storage 域）。

## 文件落盘

项目目录只存项目所需源码与资产。以下内容默认放当前 agent 工作区，不得写入 `scripts/<项目名>/`：

- 下载、网页/API 抓取内容：`downloads/` 或 `tmp/downloads/`
- 测试探针、一次性脚本、调试 dump：`tmp/tests/` 或 `scratch/`
- 抓包、导出、日志：`tmp/captures/` 或 `tmp/logs/`
- 外部 bundle、构建产物、压缩包、大体积无关资产：`tmp/reference/`

硬规则：

- 用户未指定下载/测试路径时，默认使用工作区，并在回复中说明实际路径。
- 项目中不放 `node_modules` 片段、整站镜像、`*.chunk.js`、`*.min.js` 等构建产物，以及与 `script.json` entry 同名的无关文件（尤其 `index.js`/`index.ts` 旁路假入口）。
- 项目根出现异常大文件或疑似构建垃圾时，先隔离到工作区或删除，并清理对应 AppGroup `.build/<项目名>/` 脏缓存，再编辑。
- 下载内容先在工作区处理，只将必要的小型结果按项目结构合入源码；备份时可排除已知垃圾。

---

# 代码与 UI

## 代码偏好

- 必要的代码注释使用中文；许可证、生成声明、文档格式和外部项目约定除外。
- 优先根因修复与小范围变更，不顺手改无关问题。

## UI 通则

修改页面、组件、小部件、Live Activity 或通知时：

- 必须适配 Light/Dark：优先系统语义色，自定义颜色分别提供 light/dark 值，禁止只适合浅色的硬编码配色。
- 字号一律用数字（如 `font={16}`），不用 `title`、`headline`、`body`、`caption` 等语义字号名。
- 创建页面/可见 UI 默认读取并遵循 `create-ios-page`（普通系统风格），不主动使用液态玻璃；仅当用户明确要求 Liquid Glass / 液态玻璃风格时，改为读取 `liquid-glass-ui` 并严格照其版本回退、tokens/目录与交付自检执行，不自行复制双套玻璃分支。
- 列表行距（含独立玻璃卡片行需用负 `listRowSpacing`）按 `liquid-glass-ui`「行距」一节，不凭直觉回避负值。
- List / 设置页的文本输入用 FormRow（实现与用法读 [FormRow](memories/formrow.md)，不凭记忆重写）；玻璃页表单用 `liquid-glass-ui` 的 `GlassInput` / `glassControlProps`，按场景择一。

## Dialog 对话框

`Dialog` 是运行时注入的全局命名空间，调用必须保留 `Dialog.` 前缀，不要写成裸 `alert/confirm/prompt/actionSheet`，也不要从 `"scripting"` 导入；SDK 已自带全局类型声明，不需要再补 `declare const Dialog` 或用 `any`。需要标题、自定义按钮文案等任何额外参数时，必须用**对象**形式：`confirm({ message, title })`；只传一个字符串的 `confirm("文本")` 合法但无法带标题，不存在 `confirm(message, title)` 这种位置参数重载（写了标题不会生效）。完整签名查 `scripting_reference` 的 `Dialog` 文档。

- 在 `actions` 中自带「取消」项时设置 `cancelButton: false`，避免系统额外添加取消按钮导致索引或交互错位。
- 先保存并明确判断返回值（`confirm` 严格为 `true`、`prompt` 判 `null`、`actionSheet` 按数组实际顺序取索引），再执行删除、覆盖、清空、还原、提交等操作；取消或未知返回值默认不执行。
- 仅危险操作按钮设置 `destructive: true`。封装通用确认函数时，由 helper 自己维护 actions 与索引映射，或显式返回语义化结果；对话框只负责收集用户选择，实际操作、异常处理、Toast 和数据刷新留给调用方。

---

# 踩坑记录

## 记录规则

**本节只收通用坑：**换个项目、换个功能同样会撞上的平台级行为——Scripting SDK / 组件渲染与动画、iOS 原生 API 语义、参数形式陷阱、运行时与构建限制、iOS 版本差异。判据：这条经验能否原样用在一个还不存在的新项目上。

**项目功能内的坑写该项目 `PROJECT_MEMORY.md`：**业务逻辑边界、接口/字段/配置怪癖、项目自有数据与状态流程的陷阱、只在这一个项目复现的问题——即使当时排查很痛也不入全局。业务/数据层拿不准时先当项目专属处理，等第二个项目再撞上时提升到本节；已能定位到 SDK / 组件 / 系统 API 层的，直接记本节，不用等第二例。

遇到「文档和技能都没写、试出来才知道」的通用行为坑，定位或规避后立刻写，不等用户提醒：

- 格式：**现象 → 触发条件 → 规避写法**，一条一段，尽量给可直接照抄的正确写法；与官方文档冲突时写明「实测以本条为准」。
- 可复现、未来还会遇到才记；一次性环境故障、自己的笔误、已被新版修复的不记。
- 写入前先扫本节，命中已有条目就修订；被官方修复或被更好写法取代时删除。
- 坑天然属于上文某一节（如「Dialog 对话框」「UI 通则」）时并入该节，不在本节重复。

## 已知坑

- [Python 会话模块缓存](memories/python-session-module-cache.md) — 连续 `python3` 可能仍复用旧 import；改模块后按依赖顺序 reload 再测。

- [预览外观与透明渐变](memories/preview-color-scheme.md) — `preferredColorScheme="dark"` 不保证静态截图切到暗色，须核对实图；视图 mask 的准确类型位置。

- **`trailingSwipeActions` 的数组顺序与看到的左右顺序相反。** 数组第一项贴屏幕右缘（滑动起始侧），所以 `[A, B]` 在屏幕上从左到右显示为 `B A`；leading（右滑）同理镜像。想要视觉上“删除 排除”就得写 `actions: [排除, 删除]`。写完先按目标视觉顺序反向排列，不要按阅读顺序直接填。

- **推入页面所在的列表行被移除后，该页面的返回按钮失效。** NavigationLink 的 destination 由列表行持有，子页面里改数据导致父列表重新过滤、该行消失（如归档后移出当前范围、删除后不存在）时，已推入的页面留在屏幕上但 `Navigation.useDismiss()` 不再生效。规避：子页面的数据变更只改自身状态，缓存一个待通知标记，等页面退出时（自定义返回按钮 + 卸载 `useEffect` 兜底）再通知父列表刷新，不要在页面还在栈上时让父列表移除该行。

- **子页面需要自己隐藏底部标签栏。** TabView 里用 NavigationLink 推入的页面默认仍显示 tab bar。在子页面根视图（如 `<List>`）上加 `tabBarVisibility="hidden"` 即可；同类还有 `navigationBarVisibility` / `bottomBarVisibility`，取值 `"automatic" | "hidden" | "visible"`。

- **在 `evaluateJavaScript` 里先调 `window.scrollTo` 再读几何值，会得到归零的视口。** 同一段脚本里 `window.scrollTo(...)` 之后读 `window.innerHeight` / `visualViewport.height` / `clientHeight` 全为 `0`，`getBoundingClientRect()` 也跟着退化（`position:fixed;bottom:20px` 的 48px 元素会报 `top:-68, bottom:-20`，正是按 0 高视口算出来的）。连采 5 次都稳定为 0，不是时序竞争；去掉 `scrollTo` 后同一脚本立刻返回真实值。规避：测量脚本只读不写，滚动另开一次 `evaluateJavaScript`；或改用不依赖视口的量（`scrollHeight`、`offsetTop + offsetHeight`）。

- **运行时没有 `setInterval` / `clearInterval`（仅指 Scripting 运行时，不含 WebView 页内 JS）。** 注入到网页里的脚本跑在页面自己的 JS 环境，`setInterval` 正常可用，不要去「修」这类注入代码。Scripting 侧实测 `typeof setInterval === "undefined"`（`setTimeout` 存在），写了只会得到 `Cannot find name 'setInterval'` 类型错误或运行时报错。需要周期任务时用递归 `setTimeout` + 停止标志，并在 `useEffect` 清理里置位：
  ```ts
  useEffect(() => {
    let stopped = false
    const tick = () => {
      if (stopped) return
      // ...周期逻辑
      setTimeout(tick, 600)
    }
    tick()
    return () => { stopped = true }
  }, [])
  ```

- **同一个视图上叠多个 `.sheet` 修饰符，只有最后一个会生效（iOS 15/16，SwiftUI）。** 写了 `.sheet(isPresented: $a)` 又接 `.sheet(item: $b)`，前面的永远不弹。规避：把所有弹窗收进一个 `Identifiable` 枚举，只挂一个 `sheet(item:)`，在 `switch` 里分发内容；`id` 用能区分实例的字符串（如 `"editor-\(source.id)"`）。iOS 17+ 已放宽，但只要还支持 15/16 就按本条写。

- **`GeometryReader` 会吃掉父级全部剩余高度，且它自己的 `frame` prop 无效。** 其 props 只有 `children`，写 `<GeometryReader frame={{height:20}}>` 完全不起作用；放进 VStack 后会把后续兄弟视图挤到容器最底部（实测一个 20pt 的气泡把色带顶到了屏幕底边）。规避：用固定高度的容器包住它，高度写在容器上——`<ZStack alignment="leading" frame={{ maxWidth: "infinity", height: 20 }}><GeometryReader>{p => …}</GeometryReader></ZStack>`（外层换成固定高度的 VStack 同样有效）。内部按 `proxy.size.width` 配合 `offset={{x, y}}` 做百分比定位是可靠的，宽度读数准确。**要把「自适应宽度」的子视图中心对准某个比例位置，用 `position={{x, y}}` 而不是 `offset`**——`position` 定的是视图中心，不必知道它的实际尺寸（`offset` 必须自己减半宽，于是被迫写死 frame）。只有两端防溢出的夹取还需要一个宽度估算值。

- **左滑/右滑菜单按钮不要用 `role`。** `leadingSwipeActions` / `trailingSwipeActions` 的 `<Button>` 一旦设 `role`（如 `role="destructive"`），触发时滑动行会闪动/跳动重绘。改用 `tint` 表达危险语义（如 `tint="red"`）并保持 `title` + `action`，不设 `role`；官方 Swipe Actions 文档的示例用了 `role="destructive"`，实测以本条为准。危险操作的确认交给 `Dialog`。

- **`webView.getCookies(url)` 按 domain + path 双重匹配，路径受限的 cookie 用站点根地址取不到。** 实测（ephemeral WebView + 假域名）：`Path=/api/user/auth` 的 cookie 在 `getCookies("https://host")` 结果里不出现，URL 写成 `https://host/api/user/auth/refresh` 才返回；`getAllCookies()` 无视路径全部返回（含 HttpOnly）。要完整回收登录态就用 `getAllCookies()` 自己按域名过滤，别把 `getCookies(baseUrl)` 当成「这个站的全部 cookie」。

- **Agent shell 不能 chdir：`cd`、`tar -C`、以及 tar 解压到子目录全部失败。** 实测 `cd tmp/downloads` 报 `can't cd to`（路径存在也一样），`tar x -C <dir>` 报 `could not chdir`，不带 `-C` 解压时每个条目都报 `Could not chdir <entry>`——是沙箱禁用 chdir，不是路径写错。规避：命令始终用相对工作区的路径直接读写，不要试图切目录；需要解包时用 Python `tarfile` / `zipfile` 遍历成员并 `open(dst,"wb")` 落盘（`os.makedirs` 可用，也可直接在内存里 grep），或用 `tar xzOf pkg.tgz <member>` 流式取单个文件。包进 `sh -c 'cd … && …'` 也没用（dash 同样报 `can't cd`）。

- **简单命令不过 shell：`>`、`|`、`;` 会被当成普通参数。** 实测 `python3 x.py … > out.json` 报 `unrecognized arguments: > out.json`，`… | head` 同理，`;` 被当文件名。需要重定向 / 管道 / 多命令串联时整条包进 `sh -c '…'`（内层用双引号包带空格的路径，实测正常），或让程序自己写文件（如 `--report <path>`）再用 file_tool 读。

- **本机 ffmpeg 缺 `boxblur` / `eq` 滤镜。** 做模糊用 `avgblur` / `gblur`，做亮度对比度拉伸用 `lutrgb` / `lutyuv`（如 `lutyuv=y=clip((val-128)*8+128\,0\,255)`）；`filter_complex` 里表达式的逗号必须写成 `\,`，否则被当滤镜分隔符。另外这个构建没有 libx264/libx265，要编 H.264/HEVC 用 VideoToolbox。

- **拉 GitHub 仓库快照走 `github.com/<owner>/<repo>/archive/<sha>.tar.gz`。** 实测 `codeload.github.com` 在本机不可达（`Bad hostname` / `Empty reply from server`），未认证的 `api.github.com`（含 `git/trees?recursive=1`）几下就 `API rate limit exceeded`；`raw.githubusercontent.com` 单文件正常，目录树和批量内容用 GitHub MCP（已认证）。GitHub 代码搜索 `search_code` 对未索引仓库返回 `total_count:0, incomplete_results:true`，别据此断定「仓库里没有」，改为下载快照本地检索。

- **`addScriptMessageHandler` 注册的消息桥跨页面导航存活，`evaluateJavaScript` 注入的脚本不存活。** 实测同域与跳到另一个域后，页内 `window.webkit.messageHandlers.<name>.postMessage(...)` 仍然回到最初注册的 handler（桥挂在 controller 上，全程有效，只需装一次）；而注入的函数、事件监听、`window.__flag` 都随旧文档销毁。规避：桥在创建 WebView 后只注册一次，注入脚本在每次导航后重新注入（如在 `shouldAllowRequest` 里排 300ms / 1200ms 两次），并用 `window.__xxx` 标记保证重复注入幂等。

- **`Text` 在小组件等紧凑容器里不换行，只会截断或缩字。** 写了 `lineLimit={2}` 依然显示为单行尾部 `…`。两个独立原因：（1）同时设了 `minScaleFactor`，系统会**优先缩字而不换行**；（2）父级有 `Spacer` 或弹性布局时，文本拿不到确定的宽度约束。规避：去掉 `minScaleFactor`，并同时加 `frame={{ maxWidth: "infinity" }}` 与 `fixedSize={{ horizontal: false, vertical: true }}`——后者是关键，让文本竖向取理想高度、横向服从父宽，实测才真正折行。

- **小组件里 `Image` 的 `filePath` 加载本地图片不稳定，改用 `UIImage.fromFile`。** 实测文件确实存在、字节正常（PNG 头 `89504e47`），`<Image filePath={p}>` 却渲染为空白；`resizable` / `scaleToFit` / `scaleToFill` / `clipShape` 各种组合都救不回来。规避：`const img = UIImage.fromFile(path)`，再用 `<Image image={img} resizable={true} frame={{...}} />`，并对 `img` 为 `null` 做降级。另：`clipShape="circle"` 对非正方形图（如 4:3 国旗）会裁成两边削平的怪形状，需要圆形就先 `renderedInCircle()` 或配 `scaleToFill`。

- **`Data` 是原生对象，没有 `byteLength`。** 写 `data.byteLength > 0` 恒为 `false`（值是 `undefined`），用它做校验会静默地把正常数据当成空数据丢掉。实测其原型方法为：`slice/append/getBytes/toIntArray/toUint8Array/toArrayBuffer/toBase64String/toHexString/toRawString/toDecodedString/compressed/decompressed/resetBytes/advanced/replaceSubrange/size`。取长度用 `data.toArrayBuffer().byteLength`（或 `size`），校验文件类型用 `data.toHexString().slice(0,8)` 看 magic number。

- **SDK 没有 VPN / 代理状态 API，判隧道只能靠 `Device.networkInterfaces()` 自己推。** 实测（scripting_reference 全量检索 + 运行时枚举）`Device` 原型上与网络相关的只有 `networkInterfaces`，不存在 `isVPNConnected` / `networkType` / `connectionType` / `proxySettings` 之类；Python 侧 `Device` 更少（无网络项）。`NetworkInterface` 字段为 `address/netmask/family/mac/isInternal/cidr`。推断规则：`utun*` / `tun*` / `ppp*` / `wg*` 带非内网 IPv4 才是用户隧道（代理软件 Fake-IP 常见 `198.18.0.0/15`，如 `utun3 = 198.19.0.1/24`）；**`ipsec*` 上的 `192.0.0.4/6`（RFC 7335 `192.0.0.0/29`）是蜂窝 464XLAT，不是 VPN**，把「名字含 ipsec 且有非内网 IPv4」当 VPN 会常年误报。另：原生命名空间成员不可枚举，`Object.keys(Device)` 返回空数组，要探测得用 `Object.getOwnPropertyNames(Object.getPrototypeOf(Device))`。

- **`FileManager` / `HttpServer.registerFile` 只吃纯路径，不接受 `file://` URL；但 `Intent.fileURLsParameter` 实际给的就是纯路径。** 前半段实测确凿：`FileManager.stat("file:///var/.../a.txt")` 抛「未能打开文件…因为它不存在」，`registerFile(route, "file://…")` 注册不报错但请求返回 **404**，换纯路径则 `stat` / `mimeType` / `registerFile` 全部正常。**但不要据此推断 intent 传的是 URL**——文档措辞是 "file URLs"，实测真机分享给的是纯路径（老版本代码把原始值直接透传给 `stat` 一直工作正常）。所以归一化只当防御写（`file://` 前缀才处理，纯路径原样透传），不要把「分享失败」归因到这里。

- **共享表单传入的文件路径，安全作用域只在 intent 启动的同步阶段有效；未识别类型必须在第一个 `await` 之前同步拷进沙箱。** 现象：分享 `.exe` 报「未能打开文件…因为你没有查看它的权限」，而同一份代码分享 `.json` / `.zip` / 图片全部正常。原因不是扩展名，而是 iOS 对**已识别类型**会先把文件拷到 App 收件箱（给的是沙箱内副本路径，之后随便读），对**未识别类型**直接给原位置路径（`/private/var/mobile/.../File Provider Storage/...`），这种路径的访问权在脚本跨过 `await`（启动服务、present 页面）后就失效，等页面挂载再 `stat` 必然失败。注意「没有查看权限」与「不存在」是两种不同错误，前者是作用域问题、后者才是路径问题。

  **不要把这条误记成「路径只能读一次、入口必须极简」**——极简入口对未识别类型同样失败（实测），因为问题在时机而非次数。规避：入口在任何 `await` 之前用**同步** API 立刻落盘，后续全程用副本；`imagePathsParameter` 已是沙箱路径，不用处理：
  ```tsx
  const stageDir = Path.join(FileManager.temporaryDirectory, "lan-share")
  function stageSync(raw: string): string {
    try {
      if (!FileManager.existsSync(stageDir)) FileManager.createDirectorySync(stageDir, true)
      const dest = Path.join(stageDir, Path.basename(raw))
      if (FileManager.existsSync(dest)) FileManager.removeSync(dest)
      FileManager.copyFileSync(raw, dest) // 必须是 Sync 版本
      return dest
    } catch {
      return raw // 失败回退原路径，交给下游统一报错，不中断整批
    }
  }
  runChat([...(Intent.fileURLsParameter ?? []).map(stageSync), ...(Intent.imagePathsParameter ?? [])])
  ```
  另：文档里的 `FileManager.addFileBookmark` / `bookmarkedPath` / `removeFileBookmark` **在实际构建里是 `undefined`**（文档超前于 App），照文档直接调会抛 `is not a function`，需先 `typeof` 探测。`getAllFileBookmarks()` 存在但是**全局**列表（含其他项目、`.Trash` 里的无关文件），按 basename 兜底匹配会解析到错误的文件，不要这么用。真遇到不可读的文件时，引导用户用 `DocumentPicker.pickFiles` 在 App 内重选（该路径权限正常），并保证单个文件失败不中断整批流程。

  归一化参考写法（`imagePathsParameter` 本身是纯路径，不用处理）：
  ```ts
  function toFilePath(s: string): string {
    const p = s.startsWith("file://") ? s.slice(7) : s.startsWith("file:") ? s.slice(5) : s
    if (p === s) return s // 已是纯路径，避免误解码文件名里的 %
    try { return decodeURIComponent(p) } catch { return p }
  }
  ```

- **SF Symbol 图标与同字号文字放一行时，图标视觉上大一圈。** `<Image systemName=... font={N}>` 与 `font={N}` 的 Text 同处一个 HStack 时，符号包围盒按字体 point size 设计，填充类圆形符号（`checkmark.circle.fill`、`doc.on.doc` 等）明显高于文字字面。规避：加 `imageScale="small"` 并把 `font` 取得比目标文字小 1–2 号——探针实测（`tmp/tests/icon-size-probe.tsx`）：17 号标题配 `font={15} imageScale="small"` 最贴合，11 号小字配 `font={11} imageScale="small"` 即基本等高；只加 `imageScale` 不降字号仍偏大。`imageScale` 是相对缩放，可与 `fixedSize` 同用。
