# IP检测 · 项目记忆

小组件展示 IP 归属地与纯净度；点击脚本进入设置页选择数据来源。

## 架构

- `index.tsx`：App 内运行入口，调 `presentSettings()` 打开设置页（`script.json` 的 `runInApp` 必须为 `true`，否则脚本后台运行不进 App）。
- `widget.tsx`：小组件渲染入口；`getWidgetProps()` 取 IP 后并行下载国旗、查询对比出口，仅 `systemMedium` 加载地图；末尾 `renderIPWidget().then(Widget.present)` 供预览/正式渲染。
- `types/widget.ts`：共用展示数据，含可选 `mapImages: DynamicImageSource<UIImage>`；组件不引用带自动执行副作用的 `widget.tsx`。
- `components/MediumIPWidget.tsx`：中号专用左信息右地图布局；`mediumMapSize()` 同时供快照与显示使用。
- `services/mapSnapshot.ts`：Apple MapKit 快照、明暗图片缓存、坐标校验与失败降级。
- `components/RiskColorBar.tsx`：IPPure 风格风险色度条（分段色带 + 气泡指针 + 刻度）。
- `utils/riskScale.ts`：风险分段常量与 `locateRisk` 定位算法。
- `api/ip.ts`：网络层。`fetchIPInfo(settings)` 按首选接口取数、失败按开关降级；`parseIPInfo` 严格校验；`fetchChinaIP` 取对比出口。
- `utils/ip.ts`：纯本地判定。`detectConnectionStatus` 用出口对比 + 本地隧道接口得出连接状态；`calculateRiskValue` 按来源分流（IPPure 用官方分数，ip-api 用关键词估算）。
- `utils/ipAddress.ts`：IP 校验（`isIPv4` / `isIPAddress` / `isPublicIPv4`）。
- `services/settings.ts`：`Storage` 私有域持久化，键 `ipDetection.settings.v1`，默认 `{ preferredProvider: "ippure", fallbackEnabled: true }`。
- `pages/SettingsPage.tsx`：系统 `insetGroup` 列表，Picker 选接口 + Toggle 备用；改动即存 + `Widget.reloadAll()`。Picker 带 `labelsHidden`（标题与 Section 头「数据来源接口」重复），`title` 保留供无障碍读取，不要删。

## 接口与字段

- **IPPure（首选）**：`GET https://my.ippure.com/v1/info`，无鉴权，查请求方出口 IP，测试阶段可能变动。
  - `fraudScore` 0–100 直接作纯净度风险值；`isResidential:true→家宽 / false→机房`；`isBroadcast:false→原生 / true→广播`。
  - 返回 `asn`(number) + `asOrganization`；组织名同时填 `isp` 和 `org`。
  - 坐标字段 `latitude/longitude` 常为字符串；ip-api 对应 `lat/lon` 通常为数字。统一存 `IPInfo.latitude/longitude`，整串严格解析并校验有限值与范围；空串、混杂文本、越界丢弃，保留 0，缺坐标不导致整份 IP 失败。
- **ip-api（备用）**：`http://ip-api.com/json/?lang=zh-CN`，仅归属地，无纯净度分数，风险由 `utils/ip.ts` 本地估算，UI 标注「本地估算」。
- **对比出口**（`fetchChinaIP`）：`ip.3322.net` / `api.ipify.org` / `checkip.amazonaws.com`，仅接受公网 IPv4。

## 风险色度条

对齐 IPPure 官网 `ColorMap` 组件（源码在其前端 chunk `IPDataTable.*.js`），改动前先核对线上版本：

- 断点 `[0,15,25,40,50,70,100]`，颜色 `#166534 #22c55e #84cc16 #eab308 #f97316 #dc2626`，文案「极度纯净/纯净/中性/轻度风险/中度风险/极度风险」。
- 每段在条上等宽（各占 1/6），段内再按数值比例插值——不是按数值线性映射，所以 0–15 和 70–100 在视觉上一样宽。
- 色块之间为**渐变过渡**：`buildRiskGradientStops()` 把每段颜色放在自己的中点（`(i+0.5)/count`），首尾颜色补 0 和 1，因此相邻色在边界处混合而非硬切。
- 边界值归属下一段起点（`segment.end >= value`，如 15 判为「极度纯净」），与官网一致，勿擅自改成左闭右开。
- 所有 family 都用完整气泡（`compact={false}`，形如 `26% 中性`），**风险等级只在气泡里出现，不再占状态标签行**；`systemSmall`、`systemMedium` 隐藏底部刻度数字，其余 family 保留。组件的 `compact`（只显百分比）仍保留但目前无调用方。

## 布局约定

- **中号左信息右地图，小号居中纵向流**；中号组件按信息 60% / 地图 40% 分配；小中号统一字号层级，IP 与地区紧邻、不插入弹性空白；「状态来源 / IP+地区 / 运营商 / 标签 / 风险条」五组之间用 4 个 `Spacer minLength={0}` 均分剩余高度，不叠加各行固定顶部 padding。大号及其他 family 保留原布局和间距。
- 小中号上下留白统一为 12（小号仍用 `safeAreaPadding`，中号信息高 `height - 24`），通过收紧 IP 与地区间距腾出边缘留白；地区 `Text` 与所在 `HStack` 都设 `fixedSize={{ horizontal:false, vertical:true }}`，ISP 换行只减少空白、不挤小地区字。地区保留 `minScaleFactor={0.7}` 仅应对横向长地名，IP 也固定竖向理想尺寸。
- 中号按 **信息 60% / 渐变 10% / 清晰地图 30%（6:1:3）** 分配：信息区宽 `width * 0.6`（含左边距 14，实际内容宽 `width * 0.6 - 14`）；地图快照与显示为 `width * 0.4`，右对齐且裁切，**地图绝不能延伸到左侧信息区**。渐变使用 `MAP_FADE_RATIO = 0.1` 按整体宽度计算，覆盖 60%–70% 区间；地图 alpha 在该区间内从 0 单调变为 1，仅首尾各 15% 做短缓入缓出，中间 70% 近似匀速（最大斜率约为原线性的 1.18 倍），避免起止处形成竖直衔接边，也不使用中段陡变的完整 S 曲线。70%–100% 为清晰地图，不用固定点数调整渐变宽度。保留纯 alpha mask（色标 RGB 固定、仅透明度变化），让信息背景向右过渡到地图，不用固定白色蒙层，适配明暗及透明/模糊背景。
- 地图下方的「Apple 地图 · IP 近似位置」标签在整块右侧 40% 地图（60%–100%，包含渐变区）内水平居中，中心为 `width - mapWidth / 2`（整体 80% 处）；用户明确要求不额外右移，不为避让内置 Apple 标识改成仅清晰地图区居中。竖向中心与左侧色带中心一致：`height - INFO_VERTICAL_INSET - (RISK_BAR_HEIGHT + 5) / 2`，其中 `+ 5` 来自 `RiskColorBar` 的指针行高。保留原字号与明暗背景，不修改地图快照内置的 Apple 水印。
- 小中号字号统一：IP 25 / 归属地 17 / 运营商 8 / 状态 11 / 来源 9 / 标签 10；国旗 15×15、标签内边距横 6 竖 2、色带高 6，完整气泡不变且无底部刻度。中号 IPv6 保留 13 号、最多两行且不缩字的特殊处理；其他 family 仍为 IP 30 / 地区 17，原字号与刻度不变。
- 气泡尺寸自适应文字：`padding={2}` + `fixedSize` 使宽高 = 文字 + 4，圆角 3.5，`font={8}`；定位用 `position={{ x: centerX, y: 行高/2 }}` 把中心直接放到分值处，**不再需要真实宽度**，所以也不要回头改回 `offset` + 定宽 frame。两端防溢出靠 `estimateLabelWidth()` 的估算半宽夹取（8 号字：CJK 8 / `%` 7 / 数字与拉丁 5 / 空格 2.5），气泡文案格式改动时要同步核对这张估算表。
- 国旗必须用 `UIImage.fromFile(path)` + `<Image image={...}>` 渲染；直接用 `filePath` 在小组件里会空白（已实测）。
- 运营商名靠 `lineLimit={2}` + `frame={{maxWidth:"infinity"}}` + `fixedSize={{horizontal:false,vertical:true}}` 换行；**不能加 `minScaleFactor`**，否则只缩字不折行。
- 国旗已表达国家，国名与城市重复时（IPPure 返回英文名，常出现 `Hong Kong · Hong Kong`）只保留一份。

## 地图快照与降级

- 使用全局 `MapSnapshotter.take`，不需要密钥或设备定位权限；坐标只来自当前 `IPInfo`，不请求 GPS、不用对比出口补坐标。标记表示 IP 的近似归属位置，不是设备精确位置。
- 地图 `standard + flat`、隐藏兴趣点、跨度 `0.22`，蓝色 network 标记；分别生成 light/dark，通过 `<Image image={{ light, dark }}>` 随环境切换。取数在 `Widget.present` 前完成，组件内无异步 hooks。
- 缓存在 AppGroup `ip_detection_maps_v1/`，不放 iCloud 源码目录。键含来源、完整坐标、尺寸、样式和版本，文件名为 SHA-256 前 32 位；同坐标同来源可跨 IP 复用，但绝不拿上一位置缓存兜底新位置。改快照样式/跨度/标记时升级 `CACHE_VERSION`。
- TTL 7 天，最多 6 组（12 张）明暗 PNG；元数据为毫秒时间戳，验证文件尺寸与 UIImage 解码。重新写入后淘汰超额旧图及孤立 PNG。
- 明暗两版齐全才显示；最多等 4 秒，超时仅结束等待、不能取消 MapKit 底层任务。失败只回退同键过期图；无有效图则显示「地图暂不可用」，缺双坐标显示「暂无 IP 坐标」，左侧信息照常展示。写缓存失败仍显示已生成的图。

## 连接状态判定（左上角）

`detectConnectionStatus(ipInfo, chinaIP)`（`utils/ip.ts`）**不再打分**，按证据分支直接出状态，文案只有 `直连 / 分流 / 全局代理 / 代理 / 未知`；widget 顶部直接显示该文案（不加 `VPN ` 前缀），隧道类为绿色 + `lock.shield.fill`，直连为灰色 + `globe`。

真值表（2026-09-11 真机逐条实测通过）：

| chinaIP 可比（双方都是 IPv4） | 条件 | 状态 | confidence |
| --- | --- | --- | --- |
| 是 | 两出口不同 | 分流 | 95 |
| 是 | 出口相同且海外 | 全局代理 | 90 |
| 是 | 出口相同且国内 | 直连 | 85 |
| 否 | 有隧道接口 或 海外 IP | 代理（分不出分流/全局） | 75 / 60 |
| 否 | 都不成立 | 直连 | 55 |

- 出口对比是主证据，本地接口只兜底：`getLocalNetworkInfo()` 只认 `utun/tun/tap/ppp/wg` 前缀且带非内网 IPv4 的接口，排除 `192.0.0.0/29`（464XLAT）与 `169.254/16`；落在 `198.18.0.0/15` 的记为 Fake-IP 强信号（本机 `utun3 = 198.19.0.1`）。**`ipsec*` 一律不计**——本机 `ipsec4/6` 常驻 `192.0.0.6`，旧逻辑据此常年误报「已连接」。代价是漏掉系统 IKEv2 VPN，属有意取舍。
- `method` 字段保留证据链（如 `Fake-IP隧道+出口分流`），排查时先看它。
- **Scripting SDK 没有现成的 VPN / 代理状态 API**（已核实，详见全局踩坑记录），只能 `Device.networkInterfaces()` 推断 + 出口对比，不要再去找 `Device.isVPNConnected` 之类。

## 关键约束

- **绝不跨来源拼装**：归属地、运营商、纯净度、经纬度只用单个接口的整份响应；`fetchChinaIP()` 的结果**仅供连接状态判定**，不得进入任何展示字段（IPPure 分支的 `riskValue` 依旧只取 `fraudScore`）。真机实测两处出口 IP 常不同，混用会张冠李戴。
- 连接状态需要出口对比，因此 `widget.tsx` 对两种来源都会调 `fetchChinaIP()`（每次刷新多一个 2s 超时的请求，失败自动降级到接口判定）。
- 出口对比只比同为 IPv4 的地址，避免双栈网络误判为分流。
- `calculateRiskValue` 的 `riskValue` 在无分数时为 `null`，widget 需按 `null` 显示「--」。

## 实测命令

- 真机验证接口/降级/解析：项目内临时 `intent.tsx` + `scripting-ts run_intent "IP检测"`，用完即删（否则被当 Shortcuts 入口）。
- 实机预览中号：`scripting-ts widget "IP检测" --family systemMedium --screenshot`，并用 `systemSmall` / `systemLarge` 回归。
- 深色预览注意静态截图的环境限制，详见全局记忆 `preview-color-scheme`；不要把仍为浅色的截图算作完整深色通过。
