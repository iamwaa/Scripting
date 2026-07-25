declare const Dialog: {
  actionSheet(options: {
    title: string
    message?: string
    cancelButton?: boolean
    actions: Array<{ label: string, destructive?: boolean }>
  }): Promise<number | null>
}

export const CHECKIN_DISABLED_PATTERN = /签到功能未(开启|启用)|签到.*未(开启|启用)|check-?in.*(disabled|not\s+enabled)|sign-?in.*(disabled|not\s+enabled)/i

// 错误消息中文翻译规则（按顺序匹配，先具体后宽泛）
export const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  // API 兼容性
  [/can'?t\s+find\s+variable:\s*alert/i, "弹窗 API 不可用"],

  // ========== 认证 & 凭据类（明确的令牌/会话错误优先，避免被下面的通用规则覆盖） ==========
  [/invalid\s+(username|email)\s+or\s+password|invalid\s+credentials|incorrect\s+password/i, "用户名或密码错误"],
  [/用户名或密码错误，或用户已被封禁/i, "用户名或密码错误，或账号已被封禁"],
  [/invalid\s+password/i, "密码错误"],
  [/invalid\s+email/i, "邮箱格式错误"],
  [/email\s+not\s+found|user\s+not\s+found|account\s+not\s+found/i, "账号不存在"],
  [/access.?token\s+(has\s+)?expired|访问令牌已过期/i, "访问令牌已过期"],
  [/invalid\s+access.?token|访问令牌无效|access.?token\s+invalid/i, "访问令牌无效"],
  [/token\s+(has\s+)?expired|session\s+(has\s+)?expired|cookie\s+(has\s+)?expired|login\s+expired/i, "登录状态已过期"],
  [/token\s+has\s+been\s+revoked/i, "登录令牌已失效"],
  [/invalid\s+token|token\s+invalid|malformed\s+token/i, "登录令牌无效"],
  [/missing\s+token|no\s+token/i, "缺少登录令牌"],
  // New API 仪表盘鉴权文案（按实际含义区分，不能统一判为登录失效）
  [/无权进行此操作，未登录且未提供\s*access\s*token/i, "未登录，请重新登录"],
  [/无权进行此操作，access\s*token\s*无效/i, "访问令牌无效"],
  [/无权进行此操作，未提供\s*New-Api-User/i, "缺少用户 ID，请重新登录"],
  [/无权进行此操作，New-Api-User\s*格式错误/i, "用户 ID 格式错误"],
  [/无权进行此操作，New-Api-User\s*与登录用户不匹配/i, "用户 ID 与登录身份不匹配"],
  [/无权进行此操作，用户信息无效/i, "用户信息无效，请重新登录"],
  [/无权进行此操作，权限不足/i, "账号权限不足"],
  [/未登录或权限不足|登录状态已过期|令牌无效|令牌已过期/i, "登录状态已失效"],
  // session 失效（需在 not found 规则之前，session not found 属于登录失效而非路径错误）
  [/session\s*(not\s+found|expired|invalid)|no\s+session|session\s+失效/i, "登录会话已失效"],
  [/requires?\s+2fa|two.?factor|需要.*验证码/i, "需要二步验证，请使用网页登录"],

  // ========== 业务错误（先于宽泛的 forbidden 规则，避免 403 业务错误被误译） ==========
  // 账号状态：封禁/暂停/被拉黑
  [/account\s+(is\s+)?(disabled|suspended|banned|blocked)|user\s+(is\s+)?(disabled|suspended|banned|blocked|not\s+active)|账号.*(被封|已封|禁用|停用|拉黑)|用户已被封禁|该用户已被禁用/i, "账号已被禁用或封禁"],
  // IP 限制/白名单
  [/ip.*(not\s+allowed|not\s+in\s+(the\s+)?(allow|white)list|banned|blocked|restricted|forbidden)|ip.*(限制|不允许|未在.*白名单|白名单|封禁|拉黑)|invalid\s+ip/i, "IP 未在白名单或已被限制"],
  // 限流和配额
  [/too\s+many\s+requests|rate\s+limit(ed|\s+exceeded)?|请求.*频繁|达到(总)?请求数限制/i, "请求过于频繁，请稍后再试"],
  // 重复签到（当日已签）
  [/check[-\s]?in.*(already|has\s+been).*(completed|done|checked)|already.*(checked|signed|completed).*(in|today)|today.*(already|has).*(checked|signed)|每日.*已签|今日.*已签|已经.*签到/i, "今日已签到，无需重复签到"],
  [/quota\s+exceeded|额度.*不足|余额不足|insufficient\s+(balance|quota)/i, "账号额度不足"],
  [/daily\s+limit|daily\s+quota/i, "已达到每日请求限制"],
  [/concurrency\s+limit/i, "并发请求超限"],

  // ========== 验证和防护（需在通用 auth 规则之前，避免登录失效被误译为路径错误） ==========
  [/turnstile|cf.?turnstile/i, "站点启用了 Turnstile 验证，请使用网页登录"],
  [/签到.*(签名|signature)|check-?in.*signature|invalid\s+signature|signature\s+(invalid|expired)/i, "签到签名无效，请刷新后重试"],
  [/challenge/i, "站点要求完成安全验证，请使用网页登录"],
  [/captcha|验证码/i, "需要验证码，请使用网页登录"],
  [/cloudflare|cf.?ray/i, "触发 Cloudflare 防护，请使用网页登录"],
  [/响应不是 JSON/i, "站点返回非 JSON，可能是验证或登录失效"],

  // ========== 宽泛的未授权/权限规则（放在业务错误之后，作为兜底） ==========
  [/authorization\s+header\s+format.*bearer/i, "登录令牌格式错误"],
  [/unauthorized|not\s+logged\s+in|not\s+authenticated|user\s+not\s+authenticated|authorization\s+(header\s+)?is\s+required|authorization\s+required|no\s+access\s+token|authentication\s+(is\s+)?required/i, "未登录或登录状态已失效"],
  [/^(HTTP\s*)?401(\s+Unauthorized)?$/i, "未登录或登录状态已失效（HTTP 401）"],
  [/^(HTTP\s*)?403(\s+Forbidden)?$/i, "站点拒绝访问（HTTP 403）"],
  [/^(HTTP\s*)?429(\s+Too\s+Many\s+Requests)?$/i, "请求过于频繁，请稍后再试（HTTP 429）"],
  [/permission\s+denied|access\s+denied|forbidden/i, "无权访问该资源"],

  // ========== 资源错误（登录失效相关已在上面拦截，这里只处理真正的路径错误） ==========
  [/not\s+found|404/i, "资源不存在，请检查站点地址"],
  [/already\s+exists|duplicate/i, "资源已存在或重复"],
  [/invalid\s+request|bad\s+request|400/i, "请求参数错误"],
  [/method\s+not\s+allowed|405/i, "请求方法不支持"],

  // ========== 网络错误 ==========
  [/network\s+request\s+failed|failed\s+to\s+fetch|fetch\s+failed/i, "网络请求失败"],
  [/timed?\s*out|timeout|请求超时/i, "请求超时"],
  [/connection\s+(refused|reset)|ECONNREFUSED|ECONNRESET/i, "无法连接到站点"],
  [/dns\s+resolution\s+failed|getaddrinfo\s+ENOTFOUND/i, "域名解析失败"],
  [/ssl|certificate|cert/i, "SSL 证书错误"],

  // ========== 服务器错误 ==========
  [/internal\s+server\s+error|server\s+error|500/i, "服务器内部错误"],
  [/bad\s+gateway|502/i, "网关错误"],
  [/service\s+unavailable|503/i, "服务暂不可用"],
  [/gateway\s+timeout|504/i, "网关超时"],

  // ========== 功能和配置 ==========
  [CHECKIN_DISABLED_PATTERN, "该站点未启用签到功能"],
  [/功能.*关闭|feature.*disabled/i, "该功能已关闭"],
  [/maintenance|维护中/i, "站点正在维护中"],

  // ========== 数据格式 ==========
  [/unexpected\s+token|json\s+parse|invalid\s+json/i, "服务器返回数据格式无效"],
  [/syntax\s+error/i, "数据解析错误"],

  // ========== Sub2API 特定 ==========
  [/缺少 Sub2API 登录令牌/i, "缺少 Sub2API 登录令牌，请使用网页登录"],
  [/未获取到 Sub2API auth_token/i, "未获取到登录令牌"],
]

export function translateErrorMessage(message: any) {
  const text = String(message ?? "未知错误")
  const hit = ERROR_TRANSLATIONS.find(([pattern]) => pattern.test(text))
  if (hit) return hit[1]
  return text
}

export function getErrorMessage(e: any) {
  const msg = translateErrorMessage(e?.message ?? e)
  const lines = msg.split('\n')
  if (lines.length > 2) {
    return lines.slice(0, 2).join('\n') + '...'
  }
  if (msg.length > 60) {
    return msg.slice(0, 60) + '...'
  }
  return msg
}

export async function showConfirm(options: string | { title?: string, message: string, confirmLabel?: string, cancelLabel?: string }) {
  const dialogOptions = typeof options === "string" ? { message: options } : options
  const selectedIndex = await Dialog.actionSheet({
    title: dialogOptions.title ?? "请确认",
    message: dialogOptions.message,
    cancelButton: false,
    actions: [
      { label: dialogOptions.cancelLabel ?? "取消" },
      { label: dialogOptions.confirmLabel ?? "确认", destructive: true },
    ],
  })
  return selectedIndex === 1
}
