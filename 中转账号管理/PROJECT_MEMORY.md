# 中转账号管理 - 项目记忆

只记录项目专属、长期有效的架构与约束。一次性进度、日志、密钥不写这里。

## 架构分层

- `types.ts` 类型；`constants.ts` 常量；`storage.ts` 账号/密钥读写（secrets 存文件，key 由 `secretKey(id, kind)` 生成）。
- `services/`：`auth.ts`（统一登录/签到入口，兼容旧导出）、`api.ts`（NewAPI + Sub2API 请求层）、`webAuth.ts`（WebView 网页登录/签到）、`webSession.ts`（WebView 会话注入/回收）、`antiBot.ts`（阿里云 WAF 挑战刷新）、`account.ts`（账号 CRUD、视图数据）。
- 账号有两个平台：`newapi`（cookie + localStorage.user）、`sub2api`（JWT，`/api/v1/*`，localStorage 存 auth_token）。`isSub2ApiAccount()` 判定。

## Sub2API 站点的 Turnstile + refresh_token（关键）

部分 Sub2API 站点（如 k40.shengqainbang.cn / 「林夕」公益站）在**登录接口** `/api/v1/auth/login` 加了 **Cloudflare Turnstile**（invisible 模式，真实 WebView 里自动过，无需点选）。特征：服务器是自建 nginx，**不是** CF 边缘防护，没有 `cf_clearance`。

- 纯 `fetch` 密码登录会因缺 `turnstile_token` 被拒 → 必须用 **WebView 网页登录**过一次 Turnstile。
- 站点用 **JWT + refresh_token**：localStorage 存 `auth_token` / `refresh_token` / `token_expires_at` / `auth_user`。access_token 约一天过期。
- 前端拦截器：401 且非 login/register/refresh 时自动 `POST /api/v1/auth/refresh {refresh_token}` 换新 token，**不经过 Turnstile**。
- 登录请求体：`{ email, password, turnstile_token? }`；登录响应含 `access_token` / `refresh_token` / `expires_in` / `user`。

本项目对应实现（已完成）：

- `types.ts`：`Account.refreshTokenKey`、`WebLoginCookieResult.refreshToken`。
- `storage.ts`：`secretKey` 增加 `"refreshToken"`；`getRefreshTokenKey(account)` 对老账号按确定性规则推导 key（无需重存账号即可用）。
- `account.ts`：`upsertAccount` 分配 `refreshTokenKey`。
- `api.ts`：`refreshSub2ApiToken(account)` 用 refresh_token 换新 access_token（存回 `account.cookieKey`，轮换的 refresh_token 也更新）；`sub2ApiRequest` 增加 `refreshRetried` 参数，遇 authExpired（含 401）先 refresh 再重试一次；`removeAccountSecrets` 一并清理 refresh key。
- `webAuth.ts`：`extractSub2ApiRefreshToken(items)` 从 localStorage 抽 refresh_token；`getWebLoginCookie` 返回 refreshToken；`loginByWebView` / `openManualCheckinWebView` 关闭后回收时传入。
- `webSession.ts`：`recycleSub2ApiWebSession` 增加可选 `refreshToken` 参数并存下。

使用流程：**WebView 登录一次**（Turnstile 自动过）拿到并存 refresh_token → 之后签到走 API，access_token 过期时自动 refresh，**不再碰 Turnstile**。只有 refresh_token 本身失效（通常数周~数月）才需再 WebView 登录一次。配合 iOS 快捷指令定时自动化调用签到 intent 可近乎全自动。

## 已知陷阱

- `sub2ApiRequest` 有两层重试：`challengeRetried`（阿里云 WAF）+ `refreshRetried`（JWT 刷新），递归调用时都要正确透传，避免死循环。
- `api.ts` 里 authExpired 判定出现在两处（Sub2API line ~139、NewAPI line ~318），改动时锚点要区分，别改错分支。
