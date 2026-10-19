# Pong — Komari 探针面板

参照 [vPings](https://apps.apple.com/us/app/vpings/id6479573031) 实现的 Scripting (iOS) 应用：在 3D 世界地图上展示 Komari 探针的节点实时状态、负载指标与地理分布。原 Demo 的「哪吒探针」已替换为 **Komari 探针**。

## 功能

- **地图视图**：按节点 GeoIP 地区在 3D 卫星地图上打点，在线绿色、离线灰色，同地区节点自动散开避免重叠。
- **实时数据**：通过 WebSocket `ws(s)://host/api/clients` 每 2 秒拉取一次实时指标，断线自动重连。
- **节点列表**：所有节点按在线优先排序，行内显示 CPU / 内存环形仪表与上下行速率。
- **节点详情**：实时负载仪表（CPU/内存/磁盘/交换）、网络速率、连接数、进程数、运行时间，以及硬件与计费信息。
- **多探针管理**：在设置里添加/编辑/删除/切换多个 Komari 面板地址，支持「测试连接」（读取 `/api/version`）。

## Komari API 契约

| 用途 | 端点 |
|---|---|
| 静态节点列表 | `GET {baseUrl}/api/nodes` → `{status, data: NodeBasicInfo[]}` |
| 实时数据 | WebSocket `{ws}://{host}/api/clients`，连接后每 2s 发送文本 `get`，回 `{status, data:{online[], data:{[uuid]: LiveRecord}}}` |
| 版本探测 | `GET {baseUrl}/api/version` |

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
  server.ts               Komari 数据访问：fetchNodes / fetchVersion / buildPins / LiveClient(WebSocket)
  config.ts               探针配置持久化（Storage）
  geo.ts                  region(ISO码/旗帜emoji/中英名) → 经纬度
  coords_data.ts          ISO-3166 国家质心坐标表（自动生成）
  format.ts               纯展示格式化（字节/速率/百分比/计费…）
```

- **S** 单一职责：每个模块只做一件事（网络/配置/地理/格式化/状态/各页面）。
- **U** 单向数据流：`server.ts` → `Monitor` observables → 各视图（只读），视图从不直接碰 fetch/WebSocket。
- **P** 接口先行：所有跨模块数据走 `types.ts` 契约；视图依赖 `useMonitor()` 而非实现。
- **E** 无硬编码：探针地址全部来自用户配置（`Storage`），代码内无任何固定 URL。
- **R** 可替换：`LiveClient` 可整体换成 SSE/轮询而不影响 UI；坐标表/格式化均可独立替换。

## 验证

- `tsc --strict` 对纯逻辑层（class/*.ts）零错误；全量（含 .tsx）零错误。
- 运行时单测覆盖：格式化、地理解析（旗帜 emoji/ISO/中英名）、`buildPins`（跳过无法解析地区、在线/离线着色、同地区散开）、实时帧解析。

## 导入方式

将 `Pong.scripting` 用 Scripting App 打开导入，或把 `Pong/` 目录整体放进 Scripting 的脚本目录。首次运行进入「设置」添加你的 Komari 面板地址即可。
