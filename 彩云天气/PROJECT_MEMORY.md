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
pages/HomePage.tsx            # 入口壳：TabView page 模式聚合 WeatherPage
pages/WeatherPage.tsx         # 单个地点天气页（独立加载+渲染，复用当前样式）
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

- 启动：请求当前位置 → 逆地理地名 → 500 米内最近 POI 名称（仅借用名称，坐标始终保留真实定位）→ 失败则回退 `lastPlace`；无 Token 时提示去设置
- 搜索/收藏选点：`loadForPlace(..., { asCurrent: false })`，并用 `placeRef` 持有最新地点
- **禁止**在 `Navigation.present` 返回后用闭包捕获的旧 `place` 再 `setPlace`（会把选点盖回当前位置）
- 工具栏：关闭 / 收藏星标 / 定位 / 搜索 / 设置
- 首页使用 TabView（`tabViewStyle: "page"`）左右滑动切换地点；tab 0 = 当前位置，tab 1..N = 收藏地址
- **关键布局（合并式：单一根层全屏背景 + 单一根层工具栏/标题）**：HomePage = `NavigationStack > ZStack(alignment:top){ WeatherBackground(单一全屏背景) + TabView(page) }`。**背景**：ZStack 根层挂唯一一个 `<WeatherBackground>` 作为**子节点**（默认 `showEffects=true`，跟随当前选中 tab 的 `selectedSkycon` 渲染动态天气效果；各页经 `onSkyconLoaded` 上报按地点 id 存 `skyconMap`，用 `key={selectedSkycon}` 触发切换）。**内嵌分页页透明、不再自绘背景**——从根本上消除顶部接缝与色差空隙。**全屏背景必须作为 ZStack 的子节点，绝不能挂到 `background=` 修饰符上**：`background=` 会把背景约束在内容布局框内（受安全区裁剪），即便内部 Rectangle 自带 `ignoresSafeArea` 也会被裁一道，顶/底渲染成发雾的带（真机实测）；作为子节点时子视图 `ignoresSafeArea` 完整生效，真正铺到屏幕边缘。**ZStack 根层不要写 `ignoresSafeArea top`**：背景 Rectangle 自己铺满即可；ZStack 本身遵守安全区，`List` 内容才会正常内缩到导航栏下方，不会顶进导航栏。**工具栏/标题**：始终由 ZStack 根层挂一份系统 `toolbar`（`components/WeatherToolbar.tsx` 的 `createWeatherToolbar`：左红色关闭键；右定位/搜索/设置，设置走 `NavigationLink`），`navigationTitle` 取 `selectedTitle`（`selectedPlace.isCurrent ? "当前位置" : placeDisplayName`，`inline`）。**内嵌分页页绝不各自挂 toolbar/navigationTitle**——否则滑动时相邻两页同时向同一系统导航栏挂 toolbar，出现双份按钮错乱（这是曾出现的 bug 根因）。**已废弃的实验（勿重蹈）**：曾试过 `navigationBarVisibility="hidden"` 隐藏系统栏 + 自绘玻璃悬浮 `FloatingToolbar` + 分页态 `protectsPagedContent`（透明 List + `showsBackground=false` + `scrollEdgeEffectHidden` + `contentMargins` top56/bottom84），已整体回退删除；`FloatingToolbar.tsx` 已删。`toolbarBackgroundVisibility`/`contentMargins`/`safeAreaInset`/`GeometryReader` 实测 topInset 这些绕行都不再使用。List key 必须包含提醒状态，使天气加载后从无提醒切换为有提醒时重建滚动容器并重置首帧锚点。搜索结果详情页（`toolbarMode="detail"`）同样自绘全屏背景，保留自己的 `navigationTitle` 与 detail toolbar（返回/当前位置）。`fetchWeather` 以完整 URL 做 60 秒响应缓存与并发 Promise 合并。不要给每个 tab 嵌套 NavigationStack
- **TabView page 模式稳定约束（务必遵守，真机实测）**：分页选择使用 `useObservable(0)`，TabView 传 `selection={pageSelection}`，每个 WeatherPage 传数字 `tag={index}`，样式使用 `pageAutomaticDisplayIndex`。原生横向分页、圆点选中态、当前地点和根动态背景必须共用这一份 Observable selection；不要混用 React `tabIndex + onTabIndexChanged`，该组合在真机可能出现卡片已滑动但圆点和背景仍停留上一页。地点组合变化或定位回到首个页面时，通过地点 id 与 `tabsVersion` 组成 key 整体重挂载 TabView，并在定位时 `pageSelection.setValue(0)`。首页只有一个外层 NavigationStack 和一份系统 `toolbar`（`createWeatherToolbar`，挂在 ZStack 根层），以及一个根层全屏背景；内嵌分页页透明不自绘背景、不挂 toolbar。搜索页由首页根 `navigationDestination` 原生 push；搜索结果天气详情再经 SearchPage 内**第二层** `navigationDestination`（由 `previewPlace != null` 触发）原生 push `WeatherPage`（`toolbarMode="detail"`），系统自动提供返回按钮与**右滑返回手势**；其 `onChanged(false)` 清空 `previewPlace` 并 `loadFavorites` 刷新收藏。`WeatherPage` 未传 `onBack` 时显示系统返回按钮，与右滑手势配套（不要改回自绘返回或 sheet）。“当前位置”直接调用 HomePage 关闭唯一的搜索 destination，待其 `onChanged(false)` 后执行 `handleLocate` 回到第 0 页，禁止恢复为连续 pop + setTimeout。设置使用 NavigationLink 原生 push
- **地点列表按 id 去重**：收藏了当前坐标时收藏项 `placeId`（按坐标生成）会与 `currentPlace` 相同，`places` 出现重复 id/tag 会让 TabView 选中与页面绑定错乱（表现为多个 tab 显示同一地点）；构建 `places` 时必须去重，当前位置优先保留
- 导航栏标题动态显示当前 tab 地点名称；**当前位置标题固定为「当前位置」**（`place.isCurrent ? "当前位置" : placeDisplayName(place)`），不显示逆地理地名，与收藏地点区分
- 每个 WeatherPage 独立加载天气数据；地点切换时 useEffect([place.id]) 重新请求
- 天气卡右侧：AQI → 紫外线(desc) → 降水概率(local.intensity) → 湿度
- 地点搜索使用全局 `MapSearch.locate`，结果类型为 `pointOfInterest` + `address`；无需彩云 Token
- 搜索有定位时把当前位置作为 `region` 传给 MapKit，再按距当前位置近→远排序；无定位回退普通搜索
- 地点显示名：**仅收藏地点**可编辑（当前位置不可）；副标题始终为**地址**，不显示「原名」
- 地址副标题格式化：清洗 `MapSearch.formattedAddress`，去掉与 `name` 重复的前缀、尾部“中国”等国家级后缀，按**行政区划从大到小**（省 → 市 → 区 → 街道/POI）用“·”连接，避免冗长格式
- 收藏若存在则合并 `displayName` 到非当前位置展示
- 搜索页：搜索胶囊 + 热门城市 + 结果/收藏列表
- **收藏行改名/删除去掉行内按钮，改为左滑菜单**：天气页也去掉了改名铅笔入口（`WeatherPage` 不再传 `onEditDisplayName`，`RealtimeCard`/`PlaceHeader` 已无 `onEditName` 参数）。改名/删除仅在搜索页收藏列表左滑触发
- **收藏行必须是原生列表行（`native` 分支），且必须单层背景**：左滑菜单/拖动排序依赖系统原生行 chrome。玻璃只放在自撑满的 `listRowBackground` Shape（`FavoriteRowBackground` = `RoundedRectangle` + `favoriteSurfaceFill` + `shadow.card`），内容 HStack **不再** surfaceFill——**禁止**叠两层玻璃（曾用 inset 独立背景层 + 行内 surfaceFill）：那是左滑菜单重复 + 拖动露白底的根因（inset 层不覆盖整格，drag 快照露出默认白底；叠层 + 行内 Button + swipe 三者叠加会重复 swipe chrome）。点击用行 HStack 的 `onTapGesture`，**不要**在左滑行内再套 `Button`。`trailingSwipeActions`（删除 + 改名，`allowsFullSwipe:false`）挂在行 HStack 上
- **收藏行紧凑布局 + 左右不贴边**：参数集中在 `tokens.favoriteRowLayout`（`insetX:24` / `paddingY:12` / `iconSize:32` / `iconRadius:9` / `iconFont:14` / `textSpacing:2`）。**不要依赖 `listRowInsets` 做视觉留白**——它只缩内容，`listRowBackground` 玻璃仍铺满整行（真机表现为「还是贴边」）。正确做法：`listRowBackground` = 外层 `Rectangle fill="clear"` 自撑满整格（拖动不露白底）+ 内层 `RoundedRectangle` 用 `padding={{ horizontal: insetX }}` 做玻璃视觉内缩；内容 HStack 同步 `padding={{ horizontal: insetX, vertical: paddingY }}`。表面用 `favoriteSurfaceFill`（`surfaceFill` 版本感知：iOS 26+ `glassEffect`，低版本 Material；圆角 16 continuous）。**不必自建排序组件**：继续 `ForEach data + editActions="move"` 原生拖动。搜索结果行仍走 `weatherCardProps` 悬浮卡 + 原大图标 40
- **收藏区必须用 data 模式 `ForEach`（`data={favorites观察量}` + `builder` + `editActions="move"`），禁止用废弃的 `count/itemBuilder`**：`count/itemBuilder` 缺少稳定 id diff，真机上会**重复挂载行**——左滑菜单出现两套按钮（改名/删除各两个），拖动浮起露出系统默认**白色行底**。data 模式是官方推荐（正确 diff、承载 move），但**单靠 data 模式并不能修复左滑重复/白底**——真正根因是上面的叠层背景，需配合单层背景才彻底消失。因此 `favorites` 存为 `useObservable<Place[]>`，读 `favorites.value`、写 `favorites.setValue(...)`；拖动排序由 `editActions="move"` 原地改写 Observable，用**顺序签名副作用**（`favorites.value.map(p=>p.id).join("|")` 作 useEffect 依赖，跳过首帧）`saveFavorites` 持久化
- **收藏左滑删除按钮禁止 `role="destructive"`**：会触发系统自动移除行动画，与确认 `Dialog.confirm` 弹窗叠加导致行闪动；改用 `tint="systemRed"`（改名用 `tint="systemBlue"`），实际删除交给确认弹窗
- 收藏行右侧挂常驻 `line.3.horizontal` 拖动手柄图标提示可长按拖动排序；搜索结果行仍用悬浮玻璃卡片 `weatherCardProps` + 行内星标
- **`listRowBackground` 必须是能自撑满 frame 的 Shape**（如 `RoundedRectangle` fill=Material），不能用「空容器只挂 `surfaceFill`/`background` 修饰符」——空容器会塌缩、行底不渲染。曾用悬浮玻璃卡片承载左滑导致左滑菜单按钮重复渲染、长按拖动露出系统深色行底；改原生行后由系统统一 lift 整行玻璃底解决
- **Material/玻璃在 `preview_ui` 快照里不合成（透明背景无可折射内容）**：验证 `listRowBackground` 结构时先用不透明纯色 fill 确认布局，真机才看得到 Material 磨砂
- Storage：`caiyun_weather_favorites` / `caiyun_weather_last_place` / `caiyun_weather_api_token`
- UI：`liquid-glass-ui`；天气页用 `weatherListChrome` + `weatherCardProps`
- 首页内嵌 WeatherPage（`toolbarMode="home"`，默认）只渲染透明 `List` 天气内容，不自绘背景、不挂 toolbar、不设 navigationTitle；背景/工具栏/标题全由 HomePage 在 ZStack 根层统一负责（`createWeatherToolbar`：关闭/定位/搜索/设置）。搜索结果 `toolbarMode="detail"` 才自绘全屏背景、走系统栏含返回 + 当前位置按钮，并设自己的 navigationTitle

## 已知注意点

- `fetch` 需从 `"scripting"` 导入
- `Dialog.*` 为运行时全局，类型见 `types/dialog.d.ts`，不要从 scripting 导入
- `ContentUnavailableView` 的 `actions` 仅在 label 形态可用
- 搜索胶囊 TextField 使用 `title=""` + `textFieldStyle="plain"`，不要用 FormRow 的 label 形态
- 设置页 Token 输入用 FormRow + secure；无 Token 时天气请求直接报错引导去设置
- 不要在高大天气卡片上使用 `glassRowProps.maxHeight: infinity`
- **加载/错误态不放进 Section 行**：使用 `List.overlay` 覆盖可用内容区域；加载 `VStack` 设 `maxWidth/maxHeight: infinity` 并居中。这样既不会出现 List 默认白色行背景，也不会只在顶部留出 40pt 的伪居中区域

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
