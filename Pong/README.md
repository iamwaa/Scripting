# Pong — 探针面板

参照 [vPings](https://apps.apple.com/us/app/vpings/id6479573031) 实现的 Scripting (iOS) 应用：在 3D 世界地图上展示探针节点的实时状态、负载指标与地理分布。支持三种探针后端：**Komari**、**哪吒（Nezha）** 与 **[CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)**（Cloudflare Workers 面板）。

## 功能

- **地图视图**：按节点 GeoIP 地区在 3D 卫星地图上打点，在线绿色、离线灰色，同地区节点自动散开避免重叠；拿到节点后自动把视野定位/缩放到节点所在区域（每个探针实例只定位一次，不打断用户拖拽）。
- **实时数据**：通过 WebSocket `ws(s)://host/api/clients` 每 2 秒拉取一次实时指标，断线自动重连；私有站点下自动附带 `?token=<节点令牌>` 通过认证。
- **节点列表**：所有节点按在线优先排序，行内显示 CPU / 内存环形仪表与上下行速率。
- **节点详情**：实时负载仪表（CPU/内存/磁盘/交换）、网络速率、连接数、进程数、运行时间，以及硬件与计费信息。
- **多探针管理**：在设置里添加/编辑/删除/切换多个面板地址，可选三种探针类型，支持「测试连接」（读取版本信息）。

## Komari API 契约

| 用途 | 端点 |
|---|---|
| 静态节点列表 | `GET {baseUrl}/api/nodes` → `{status, data: NodeBasicInfo[]}` |
| 实时数据 | WebSocket `{ws}://{host}/api/clients`，连接后每 2s 发送文本 `get`，回 `{status, data:{online[], data:{[uuid]: LiveRecord}}}` |
| 私有站点实时凭证 | `GET {baseUrl}/api/admin/client/{uuid}/token` → 取 `token` 拼成 `/api/clients?token=…` |
| 版本探测 | `GET {baseUrl}/api/version` |

### 私有站点（KOMARI 设置里的 Private Site）

开启后所有未登录的 `/api` 请求都会被 401 拦截，而 WebSocket 端点 `/api/clients` 不在服务端公开白名单里（白名单只有带尾斜杠的 `/api/clients/`）。Scripting 的 `WebSocket` 只能传 URL、无法附加 Cookie / `Authorization` 头，因此：

- REST（`/api/nodes`、`/api/records/*`、`/api/admin/*`）继续用 Cookie 或 API Key 访问，不受影响。
- 实时通道用管理员接口按节点取一个 agent 令牌，拼成 `.../api/clients?token=<token>`；服务端把它识别为 agent 身份，同时满足私有站点拦截与缺失 Origin 头时的来源校验。令牌按 baseUrl 缓存，连续握手失败两次后作废并重新获取（令牌轮换、节点重建都不会卡死）。
- 该方案需要**管理员**凭证：普通用户拿不到节点令牌，此时实时通道仍会失败，只能靠 REST 与历史曲线。

## CF-Server-Monitor API 契约

面板 = Cloudflare Worker（D1 存历史、Durable Object 推 WS），完整文档见其仓库 `API.md`。

| 用途 | 端点 |
|---|---|
| 站点配置 / 版本 | `GET {baseUrl}/api/config`（公开，含运营商名称、版本） |
| 服务器列表 + 最新指标 | `GET {baseUrl}/api/servers` → `{servers[], stats, regionStats, sysConfig}` |
| 单台详情 / 编辑前置 | `GET {baseUrl}/api/server?id={uuid}` |
| 历史指标 | `GET {baseUrl}/api/history/all?id={uuid}&hours={0.167\|0.5\|1\|6\|12\|24\|48\|96\|168}` → `HistoryRow[]` |
| 实时推送 | WebSocket `{ws}://{host}/api/ws?subscribe=all[&token=<jwt>]` |
| 管理操作 | `POST {baseUrl}/admin/api`，body 里 `action` 路由 |

### 关键差异（与 Komari / 哪吒不同）

- **单位**：`ram_*` / `swap_*` / `disk_*` 是 **MB**，网速是 B/s；适配器统一换算成字节（规范模型用字节）。
- **主键**：服务器用 UUID 字符串，没有数字 id，因此 `NodeBasicInfo.id` 固定为 0。
- **排序**：`sort_order` 越小越靠前，规范模型是权重越大越靠前，映射为负值；编辑接口不支持改排序（只能整表 `save_order`）。
- **WS 订阅**：`subscribe=all` 默认**不推任何服务器**，必须先 `GET /api/servers` 拿到 id，再发 `{type:"subscribe",scope:"all",ids:[…]}`；`batchUpdate` 的 `samples[].data` 只带变化字段，必须按字段合并。
- **私有站点**：`is_public=false` 时 `/api/servers`、`/api/history/all`、`/api/ws` 都要 JWT。登录用 `POST /admin/api {action:"login"}` 换 7 天 JWT；脚本无法过 Turnstile，开启人机验证时只能关闭或粘贴现成 JWT。
- **历史窗口**：只接受白名单时长，未登录 `hours > 24` 直接 401，所以页面上限 1 小时 / 6 小时 / 1 天。
- **不提供**：真实 IP（公共接口只有 `ip_v4`/`ip_6` 可达性标志）、温度历史、告警/通知/定时任务/用户/令牌/会话等管理资源。
- **测速**：三网与自定义节点的时延/丢包直接存在历史行里（`ping_ct`… / `loss_*`），适配器合成 4+4 个固定任务；`null` 视为超时（-1，计入丢包率），`false` 视为未配置。

## 架构（S.U.P.E.R）

```
index.tsx                 入口：Navigation.present(<View/>)
page/
  index.tsx               根布局：MonitorProvider > MapSelectionProvider > ZStack(Map + Sheet)
  map.tsx                 地图 + Marker（消费 Monitor context）
  sheet.tsx               悬浮控件：状态总览 + 选中节点入口
  list.tsx                节点列表（在线优先，行内仪表）
  detail.tsx              单节点详情（实时仪表 + 硬件/计费）
  settings.tsx            探针 CRUD + 测试连接
context/
  Monitor.tsx             唯一数据源：节点列表 + 实时记录 + 连接状态（单向流）
  MapSelection.tsx        地图选中态绑定
class/                    纯逻辑层（无 UI），已通过 tsc 类型检查 + 运行时单测
  types.ts                所有数据契约（Port）
  backend.ts              Backend 端口 + 各后端 capability 描述 + 工厂/注册表
  server.ts               门面：按 instance.kind 分发到适配器（UI 只 import 这里）
  komari.ts               Komari 适配器（REST + WS）
  nezha.ts                哪吒适配器（REST + WS/轮询）
  nezha_transforms.ts     哪吒的纯变换（无 I/O，可单测）
  cfsm.ts                 CF-Server-Monitor 适配器（REST + WS + REST 对账）
  cfsm_transforms.ts      CF 面板的纯变换（单位换算、增量合并、历史/测速映射）
  config.ts               探针配置持久化（Storage）
  geo.ts                  region(ISO码/旗帜emoji/中英名) → 经纬度
  coords_data.ts          ISO-3166 国家质心坐标表（自动生成）
  format.ts               纯展示格式化（字节/速率/百分比/计费…）
```

- **S** 单一职责：每个模块只做一件事（网络/配置/地理/格式化/状态/各页面）。
- **U** 单向数据流：`server.ts` → `Monitor` observables → 各视图（只读），视图从不直接碰 fetch/WebSocket。
- **P** 接口先行：所有跨模块数据走 `types.ts` 契约；视图依赖 `useMonitor()` 而非实现。
- **E** 无硬编码：探针地址全部来自用户配置（`Storage`），代码内无任何固定 URL。
- **R** 可替换：`LiveClient` 可整体换成 SSE/轮询而不影响 UI；坐标表/格式化均可独立替换；新增探针后端只需加一个适配器 + 一次 `registerBackend`。

## 验证

- `tsc --strict` 对纯逻辑层（class/*.ts）零错误；全量（含 .tsx）零错误。
- 运行时验证：对公开演示面板（`mock.dashdeep.dpdns.org`）跑通 12 台节点的 REST 列表、6 类历史曲线（CPU/内存/网络/连接/进程/GPU）、三网测速与 20 秒实时 WS（每秒 `batchUpdate` 持续到达）。

## 导入方式

将 `Pong.scripting` 用 Scripting App 打开导入，或把 `Pong/` 目录整体放进 Scripting 的脚本目录。首次运行进入「设置」添加你的面板地址并选择探针类型即可。
