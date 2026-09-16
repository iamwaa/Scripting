# PROJECT_MEMORY.md — 中转账号管理

AI 中转站账号管理脚本：多站点余额查询、接口/网页签到、连通性检测。目录按 `pages / components / hooks / services / utils` + 根 `types.ts` `constants.ts` 划分。

## 平台适配层（改平台相关代码先读这一节）

支持 6 个平台，分两个协议族：

- `family: "newapi"` — `newapi` / `oneapi` / `onehub` / `donehub` / `veloera`，走 `/api/user/*` + `{ success, message, data }` 信封，共用 `apiRequestWithMeta` 链路。
- `family: "sub2api"` — `sub2api`，走 `/api/v1/*` + `{ code, message, data }` 信封，`services/api.ts` 里有独立实现（`sub2ApiRequest` 等）。

单一事实源是 `constants.ts` 的 `PLATFORMS: Record<AccountPlatform, PlatformCapability>`（`label` / `family` / `userIdHeaders` / `checkin` / `checkinHistory`）与 `PLATFORM_KEYS`（展示顺序 + 标识白名单）。NewAPI 系只在两处按平台分发：

1. 用户 ID 头 — `services/api.ts` 按 `userIdHeaders` 逐个写入。`newapi=["New-Api-User"]`、`veloera=["Veloera-User","New-Api-User"]`，其余为空（只认 Authorization/Cookie）。`userIdHeaders` 为空时不再抛「缺少用户 ID」。
2. 签到端点 — `checkin.statusPath(month)` / `checkin.doPath`。NewAPI 系默认 `GET|POST /api/user/checkin`；Veloera 是下划线的 `/api/user/check_in_status` + `/api/user/check_in`。

**新增平台的最小改动面**：`types.ts` 的 `AccountPlatform` 加值 → `PLATFORMS` 加一项 → `PLATFORM_KEYS` 加顺序 → 需要自动识别时在 `services/platform.ts` 补探测规则。其余代码不应再出现平台字面量判断，统一用 `getPlatformCapability` / `isSub2ApiAccount` / `getPlatformText`。

`utils/format.ts` 的 `normalizePlatform` 把 `undefined`/旧值/未知值兜底成 `newapi`，Picker 的 `value` 和读旧账号数据都必须经过它，否则 `tag` 找不到。

## 自动探测（services/platform.ts）

`detectPlatform(baseUrl)` 三段式：站点地址关键字 → `/api/status` 字段特征 → Sub2API 信封探测。

- URL 关键字里 `one-api` / `new-api` 的正则**必须带 `(^|[^a-z])` 前缀**，否则 `done-api`、`xxxone-api` 之类域名会误命中。
- 上游各分支的 `/api/status` 都返回 `success` + `system_name` + `version` + `quota_per_unit`，靠 `system_name` 有无无法区分（metapi 的 `!data.system_name` 判 one-api 不可靠）。实际区分点是各分支新增字段：new-api 有 `setup` `chats` `quota_display_type` `checkin_enabled`；done-hub 有 `chat_links` `linuxDo_oauth` `lark_login`；one-api 系有 `oidc_well_known` `top_up_link` `chat_link`。认不出分支但有信封时回落 `newapi`。
- Sub2API：未登录 `GET /api/v1/auth/me` 返回带 `code` 且无 `success` 的信封。

## 余额读取链路

`fetchSelf`（`services/auth.ts`）三条分支：sub2api 走 `fetchSub2ApiSelf` → 存了 API Key（sk-）的账号优先走 `fetchApiKeyBalance` → 其余走 `/api/user/self`。

- API Key 存在 secrets 里，存储键 `apiKeyKey`（`getApiKeyKey` / `getAccountApiKey` 对老账号做确定性推导），编辑页「API Key 查余额」一栏填写。
- `fetchApiKeyBalance` 串行打 `/v1/dashboard/billing/subscription` 与 `/v1/dashboard/billing/usage`，换算：剩余 = `hard_limit_usd − total_usage/100`，已用 = `total_usage/100`，再乘 `QUOTA_PER_USD` 写回 `quota` / `used_quota`（实测对得上站点页面的 $397.94 / $4.06）。`hard_limit_usd >= 1e8` 是无限额度令牌的哨兵值，此时 `quota` 置空只保留已用量。
- 计费接口的 401 只代表 API Key 无效，**不能标 `authExpired`**，否则会误触发账号重登（走密码登录、覆写 Cookie）。令牌无效时若账号没有其他凭据就直接报「API Key 查余额失败」，有凭据才回落 `/api/user/self`。
- 计费接口只能读额度，返回结果会合并旧 `lastSelf` 保留用户名/分组；因此这类账号拿不到用户 ID，编辑页不再提示「未能解析用户 ID」。

- 仅记录账号填了 API Key 后也参与余额查询（`canQueryAccountBalance`）：`fetchSelf` 对它只走计费接口、失败直接报错，不回落 `/api/user/self`（平台本来不兼容）；批量查余额用 `getBalanceQueryAccounts`，批量签到仍用 `getApiOperableAccounts`（永远排除仅记录）；详情页对它以 `balanceOnly` 模式刷新，不碰签到接口。

## 网页签到后的刷新链路

`openManualCheckinWebView`（`services/webAuth.ts`）关页后：先在 WebView 存活时页内预查（`refreshNewApiDataInWebView`，只支持有月历的平台），再由 `pages/AccountListView.tsx` 的 `quickOpenSite` 把缺失部分降级到原生 `fetchSelf` / `fetchCheckinStatus`。

- 降级请求一律带 `failFast`（`services/api.ts` 的 `ApiRequestOptions`）：跳过 WebView 验证回退、超时 25→10 秒、现场登录子请求同样透传。理由：用户刚手动关页，再弹「完成安全验证后关闭页面」只会困惑；失败站点（未开启签到、CF 硬拦、错误信封）原本会在验证回退 + 多重 25 秒超时上空耗数十秒到分钟级。失败直接写 `lastError` 并 Toast。
- `failFast` 只用于这一条链路；其他链路（批量查询、接口签到、详情页刷新）仍保留验证回退与完整超时，因为那里自动恢复有价值。

## 网页账号密码自动填写（services/webAutofill.ts）

`installLoginAutofill(webView, { credential, onSave })` 给 WebView 装两样东西：页内代理脚本 + 消息桥 `newapiSaveLogin`；返回的 handle 直接作为 `WebViewPage` 的 `autofill` prop（类型 `WebViewAutofill` 在 `types.ts`），更多菜单据此显示「保存账号密码」。填写全程自动，没有手动填写入口（强制填写已按用户要求删除）。

- 已接入三条链路：`getWebLoginCookie`（编辑页取 Cookie、详情页网页登录）与 `openManualCheckinWebView` 的 sub2api / newapi 分支。注入脚本不跨导航存活（消息桥存活），因此每条链路都在 `shouldAllowRequest` 里调 `autofill.scheduleInject()`，首屏加载完再 `inject()` 一次。
- 填写规则：只填空字段，绝不覆盖用户手输；密码框数量不等于 1（无表单、注册/改密表单）整体跳过。用户名输入框按语义属性 + 同表单 + 位于密码框之前打分，search / captcha / code / otp 等负分排除。已知直角：登录失败后站点清空密码框、或 SPA 内部路由过了重试窗口（约 10 秒）才进登录页时，需用户自己输入或刷新页面重新触发注入。
- 受控组件必须走 `HTMLInputElement.prototype` 上的 value setter 再派发 `input` + `change`，直接 `el.value = x` React/Vue 不认。
- 捕获：页内监听 submit / click / Enter 加 900ms 轮询，密码非空且与上次哈希不同才 postMessage；原生侧只留最后一份。关页后 `maybeSaveCapturedLogin` 与已存凭据比对，不同才 `showConfirm` 询问保存（写 `passwordKey` secret + 回填 `username`）。编辑页没有账号实体，走 `onCaptured` 把账号密码回填草稿字段，保存账号时才落盘。
- 询问时机有讲究：网页登录链路放在取完 Cookie / storage 之后、抛「未获取到 Cookie」之前；网页签到链路放在 cookie 回收与页内取数之后——弹窗期间会话可能失效。

## 已知陷阱

- **Cloudflare 硬拦拦页会被 `isWebChallengeResponse` 误当成可解挑战，越重试越糟。** 站长自定义的 403 拦截页（如「访问已被拦截」）末尾也带 `__CF$cv$params` 和 `/cdn-cgi/challenge-platform/scripts/precursor/main.js`，命中现有的 `challenge-platform` 正则，但页内无 `document.cookie`/跳转/表单，根本无法“完成验证”；WebView 兼底只会拿到同一张 HTML，重试还会把设备 IP 推到全站 403。辨别：真挑战页有 `_cf_chl_opt` / `cf-mitigated: challenge` / “Just a moment”，硬拦页只有 precursor 脚本 + “Cloudflare事件ID”文案。
- **ai.hybgzs.com（黑与白公益站，OneHub 分支，错误信封 `type: one_hub_error`）在 Cloudflare 边缘单独拦 `/api/user/self`。** 实测净状态下：`/api/status`、`/api/notice` 200，`/api/user/dashboard`、`/api/user/token` 401 JSON，但 `/api/user/self` 直接 403 HTML 拦截页且响应头没有 `X-Oneapi-Request-Id`（请求没到后端）；带 `cf_clearance` 的真 WebView 导航同样被拦。这正是余额监控类工具轮询的接口，所以访问令牌/Cookie 都无效；连续重试会触发全站 IP 级 403「连接已被拒绝」（实测 13 分钟未恢复）。官方 EdgeOne 备用线 `https://eo.ai.hybgzs.com` 对所有 dashboard 路径返 444，不能当备用站点地址。**兼容层没被拦**：清净 IP 下 `/api/status` 200、`/api/user/self` 仍 403，而 `/v1/dashboard/billing/subscription`、`/v1/dashboard/billing/usage`、`/v1/models`（含不带 `/v1` 的形式）都能到后端；用真 API Key 实测返 200：`hard_limit_usd` 与 `total_usage`（=已用 USD × 100）可合成额度，按 one-api `controller/billing.go`，这两个值在 `DisplayTokenStatEnabled`（默认开）下是**令牌维度**（hard=remain+used，无限额度令牌返 1e8），关闭时才是用户剩余额度。项目已据此接入「余额读取链路」一节的 API Key 分支。
- **NewAPI v1.x（QuantumNous/new-api，`/api/status` 的 `version` 形如 `v1.0.0-rc.*`）已经没有会话 Cookie，网页登录取 Cookie 必然失败。** 后台 `middleware/auth.go` 只读 `Authorization`，完全不读 Cookie，也不读 `New-Api-User`：接受 15 分钟的 JWT access token，或长期有效的系统访问令牌（个人设置生成，`GET /api/user/self/token`）。登录只下发 `new_api_refresh`（`HttpOnly; SameSite=Strict; Path=/api/user/auth`，值为 `<sid>.<secret>`，30 天）和非凭据标记 `new_api_has_session=1`（`Path=/`）；`new_api_refresh` 仅能打 `POST /api/user/auth/refresh`（可带 `X-Auth-Session: <sid>`）换 `{access_token, access_expires_at, session, user}`，每次刷新按代次轮转（30s 宽限窗口），重放会吊销整条会话（`AUTH_SESSION_REVOKED`）。此外前端 access token 只存内存（zustand 未 persist），localStorage 里挖不到令牌。这类站点当前只能填访问令牌接入；`/api/user/checkin` 等业务路由仍在。实例：api.justwoker.icu。
- **OneAPI / OneHub / DoneHub 上游没有签到路由**（已核对上游 router）。能力表仍给它们配 NewAPI 签到端点，好处是兼容二开加装签到的站点；没有路由时 404/405 由 `isRouteUnavailable`（`services/api.ts` 导出）降级：`fetchCheckinStatus` 返回 `{ enabled: false }`，`doCheckin` 抛「该站点签到功能未启用」。
- **`utils/error.ts` 里 `CHECKIN_DISABLED_PATTERN` 的译文词序不能改回「该站点未启用签到功能」**。`getCheckinDisabledPatch(message)` 拿到的是已翻译文本，只有译文本身仍能被该正则命中，才能写入 `lastCheckin.enabled=false`，批量签到才会跳过该账号（`hooks/useBatchAccountActions.ts` 依赖 `lastCheckin?.enabled === false`）。旧译文词序反了，这条链路实际不可达。
- **Veloera 的签到状态接口只返回 `can_check_in`**，没有当月历史。`checkinHistory: false` 时走 `services/auth.ts` 的 `normalizeCheckinStatus`：从 `account.lastCheckin.stats.records` 取当月历史，`can_check_in === false` 视为今日已签。`services/webApi.ts` 的 WebView 页内取数也据此跳过签到请求，改走原生归一化。
- **quota 换算全平台一致：`QuotaPerUnit = 500 * 1000`**（含 Veloera，已核对 `common/constants.go`）。metapi 给 veloera 写 `/1000000`、给 done-hub 写 `quota + used_quota` 都是它自己的 bug，别照搬。DoneHub 的 `quota`（剩余）/`used_quota`（已用）语义与 NewAPI 相同。`/api/status` 里有 `quota_per_unit`，站长可改，目前项目仍用固定常量 `QUOTA_PER_USD`，如要支持自定义单位需从这里入手。
- NewAPI 系的 `ValidateAccessToken` 都会 `strip "Bearer "`，令牌带不带前缀都能过。
- `AUTH_EXPIRED_MESSAGE_RE` 只在消息含认证关键词时才判登录失效，403 单独不算（403 常被用作额度/IP/封禁业务错误）。

## 验证

- 类型检查：`get_typescript_diagnostics` 传 `script_name: 中转账号管理`。
- UI 渲染：`scripting-ts preview_ui <file.tsx>`（`AddEditView` 需要 `--props`）。
