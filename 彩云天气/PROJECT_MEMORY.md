# 彩云天气 项目记忆

## 项目结构

- `index.tsx`：运行入口，`Navigation.present(<HomePage />)` 全屏弹出，dismiss 后 `Script.exit()`。
- `home_screen_default_ui.tsx`：App 首页常驻 Tab（Show Home Tab 开启后显示），只读单地点天气首页。
- `widget.tsx`：主屏幕小组件。
- `pages/`：HomePage（根页面，翻页容器）、WeatherPage、SearchPage、SettingsPage。
- `components/`：WeatherBackground、weatherEffects、WeatherToolbar、PageIndicatorBar、glass/tokens 等。
- `services/`：favoritesService（Storage 收藏）、locationService（Location/MapSearch）、settingsService（Token）。
- `api/`：彩云天气 API 请求层。

## 维护约定

- HomePage（多地点跟手翻页容器）仅通过 `index.tsx` 全屏弹出（`showsDismissButton=true`），不接入 Home Tab；Home Tab 走独立的 `home_screen_default_ui.tsx` 精简单地点首页，二者互不复用。
- 项目位于 iCloud，首次加载若遇文件未本地化可能构建失败，重新运行即可。

## home_screen_default_ui.tsx 首页 Tab

- 默认导出函数组件 `HomeScreenTab`；直接 `return` 视图，禁止 `Navigation.present` / `Script.exit()`（Tab 常驻，退出会卡死需 Reload）。运行时 `Script.env === "home_screen"`。
- 薄壳：初始地点取 `loadLastPlace()`，无历史则 `useEffect` 自动 `getCurrentPlace(true)` 定位一次并 `saveLastPlace`。
- 有地点时复用 `WeatherPage` 的 `toolbarMode="detail"`（自绘背景 + 工具栏 + 自加载天气），`onLocate` 回切当前位置；不动 HomePage。
- 空态/定位中/失败：自绘 `WeatherBackground skycon={null}` 时段渐变 + `ContentUnavailableView`，含无 Token 提示。
- 改代码不热重载，需 Reload（导航栏菜单或长按 Tab 栏 Home 图标）。

## widget.tsx 首页小组件

- 复用 App 数据层：`loadApiToken`（无 Token → 占位）、`loadLastPlace`（favoritesService，无地点 → 占位）、`peekCachedWeather` 缓存优先直出、`fetchWeather` 回退；异常 → `no-data` 占位。
- 支持全部 family：small/medium/large(含 extraLarge)/accessoryRectangular/Inline/Circular，按 `Widget.family` 分发。
- 配色简化自 `WeatherBackground` 的 skycon+昼夜渐变（双色停靠），通过根视图 `widgetBackground` 上色；文字用语义 `label`/`secondaryLabel` 自动适配 Light/Dark，不硬编码白字。
- widget 渲染一次、无 hooks 生命周期；数据必须在 `Widget.present` 前备好，present 后代码不执行。reloadPolicy 用 `{ policy: "after", date }` 约 30 分钟刷新。
- 该文件密集声明式多尺寸 UI，虽 300+ 行但为单一 widget 能力、视图变体高内聚，保持不拆。

## HomePage 跟手翻页实现约束

- 屏幕宽度用全局 `Device.screen`（weatherEffects 同例）；全局 `screen` 常量运行时存在但 SDK 类型未声明，类型检查会报错，勿用。
- 拖动跟手是 60Hz setState：`WeatherPage`/`PageIndicatorBar`/`WeatherBackground` 均靠 useMemo 元素引用缓存 + useCallback 稳定 props 跳过重渲染，改动这些 props 传递时不得引入每帧新引用。
- 手势闭包里的 state 可能是旧渲染快照，偏移判断一律走 `dragOffsetRef`；`dragOffsetX` state 只负责渲染。
- 换页必须经 `animateToPage`（同事务提交偏移归零 + `pageSelection.setValue`）；绕过它直接 setValue 的路径（如 handleLocate）必须先手动清零偏移，否则新页会卡在屏外。
