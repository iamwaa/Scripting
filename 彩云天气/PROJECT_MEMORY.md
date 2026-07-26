# 彩云天气 — 项目记忆

## 定位

基于彩云天气 v2.5 综合接口的本地天气工具：默认当前位置、地点搜索、收藏地点、收藏显示名、生活指数、用户自备 Token。

## 接口

- Base: `https://api.caiyunapp.com/v2.5/<token>/<经度>,<纬度>/weather`
- **无内置 Token**；必须用户在设置页填写，存 `Storage` key `caiyun_weather_api_token`
- 路径坐标顺序是 **经度,纬度**（与 Location API 的 lat/lng 顺序相反）
- 常用查询参数：`alert=true`、`dailysteps`、`hourlysteps`、`unit=metric`、`lang=zh_CN`
- 关键字段：`result.realtime` / `hourly` / `daily` / `minutely` / `alert` / `daily.life_index`
- 实况右侧标签字段：`life_index.ultraviolet.desc` / `precipitation.local.intensity` / `humidity`

## 架构

```
index.tsx                     # 入口，present HomePage
api/weather.ts                # 彩云 weather 请求（读用户 Token）
services/locationService      # 定位、MapKit 地点搜索、逆地理
services/favoritesService     # 收藏、显示名、上次地点
services/settingsService      # Token 读写（无默认值）
pages/HomePage.tsx            # 主天气页
pages/SearchPage.tsx          # 搜索 + 收藏管理 + 显示名
pages/SettingsPage.tsx        # Token 设置
components/LifeIndexSection   # 生活指数详情
components/FormRow.tsx        # 设置页表单行
components/WeatherBackground  # 首页天气动态背景（装配层：分类+配色+主组件）
components/weatherEffects     # 背景动画效果层（雨/雪/云/雾/光晕/星/闪电，仅被前者引用）
utils/place.ts                # placeDisplayName / placeAddress / withDisplayName
constants.ts / types.ts
```

## 交互约定

- 启动：请求当前位置 → 失败则回退 `lastPlace`；无 Token 时提示去设置
- 搜索/收藏选点：`loadForPlace(..., { asCurrent: false })`，并用 `placeRef` 持有最新地点
- **禁止**在 `Navigation.present` 返回后用闭包捕获的旧 `place` 再 `setPlace`（会把选点盖回当前位置）
- 工具栏：关闭 / 收藏星标 / 定位 / 搜索 / 设置
- 首页顺序：提醒 → 错误提示 → 地点+实况 → 生活指数 → 小时 → 每日
- 天气卡右侧：AQI → 紫外线(desc) → 降水概率(local.intensity) → 湿度
- 地点搜索使用全局 `MapSearch.locate`，结果类型为 `pointOfInterest` + `address`；无需彩云 Token
- 搜索有定位时把当前位置作为 `region` 传给 MapKit，再按距当前位置近→远排序；无定位回退普通搜索
- 地点显示名：**仅收藏地点**可编辑（当前位置不可）；副标题始终为**地址**，不显示「原名」
- 收藏若存在则合并 `displayName` 到非当前位置展示
- 搜索页：搜索胶囊 + 热门城市 + 结果/收藏列表
- Storage：`caiyun_weather_favorites` / `caiyun_weather_last_place` / `caiyun_weather_api_token`
- UI：`liquid-glass-ui`；天气页用 `weatherListChrome` + `weatherCardProps`

## 已知注意点

- `fetch` 需从 `"scripting"` 导入
- `Dialog.*` 为运行时全局，类型见 `types/dialog.d.ts`，不要从 scripting 导入
- `ContentUnavailableView` 的 `actions` 仅在 label 形态可用
- 搜索胶囊 TextField 使用 `title=""` + `textFieldStyle="plain"`，不要用 FormRow 的 label 形态
- 设置页 Token 输入用 FormRow + secure；无 Token 时天气请求直接报错引导去设置
- 不要在高大天气卡片上使用 `glassRowProps.maxHeight: infinity`

## Scripting 动画/绘制运行时陷阱（探针实测）

- `animation={{ animation, value }}` 的 `repeatForever` **不循环**，动画只跑一程；循环须自行驱动：下落类用 key 重建（参考 weatherEffects 的 RainDrop/SnowFlake），往返类用递归 `setTimeout` 交替 state（`usePingPong`）
- **同一视图树上嵌套两个不同 value 的 animation modifier 会互相干扰**（曾致雪花消失）；一个视图只绑一个动画，合并到同一 value
- `blur`、`shadow` 发光对 Shape（Circle/Rectangle）**无效**；柔化用水平/多段渐变与低透明同心圆叠加
- 全局无 `setInterval`，有 `setTimeout`；无 `Animation.easeInOut`，往返动画用 `Animation.smooth`
- `preview_ui --screenshot` 截图时机约为动画开始后 1.5-3s（非标注的 6s），验证动画须用参照物对比
- **全屏背景 + 列表安全区**（对照 SearchPage / PageBackground）：
  - 页面：`NavigationStack > ZStack(alignment: top, frame max infinity) > 背景 + List`
  - 背景根节点必须是**单层** `Rectangle` + `ignoresSafeArea`（与 `PageBackground` 同构）；**不要**给背景根再包一层会参与测量的效果 `ZStack`
  - 雨/云/星等效果只能放在背景 `Rectangle` 的 `overlay` 里；效果层勿再写 `ignoresSafeArea`
  - 效果宿主用 `EffectsStage`：固定 `Device.screen` 宽高 + 透明底图锚定 + `clipped`，保证粒子按整屏坐标分布（无固定尺寸时 overlay ZStack 会收缩到 ideal size，看起来像「只有卡片有雨」）
  - List **不要** `ignoresSafeArea`，由系统保留导航栏/底部安全区；可加 `frame max infinity` 拉满
  - 雨滴 x 须把完整漂移计入边界，避免长期被 `EffectsStage` 裁掉；云朵使用 SF Symbol `cloud.fill` 单一矢量轮廓（勿用透明椭圆拼接，会产生圈和深浅接缝），用渐变 tint、远近尺寸与不对称布局，整朵只绑一个 animation value 往返漂移
  - 背景 `Rectangle` 不得绑定 animation modifier：它是所有效果 overlay 的祖先，会与雨/雪/云/雾/星等后代的 animation value 冲突，表现为动画不动或消失
  - 普通云往返参数约 62–96pt / 8.5–13s，大风云约 105–155pt / 5.5–8s，启动延迟不超过 0.8s；再慢会被误判为静止
  - 雨有远近两层（far 更淡更慢）；暴雨闪电为双闪；晴夜星点约 22 颗
