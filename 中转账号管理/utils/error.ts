import type { Account } from "../types"

// 错误消息中文翻译规则
export const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  // API 兼容性
  [/can'?t\s+find\s+variable:\s*alert/i, "弹窗 API 不可用，请升级 Scripting 或重新运行脚本"],
  
  // 认证错误
  [/invalid\s+username\s+or\s+password|invalid\s+credentials|incorrect\s+password/i, "用户名或密码错误，请检查账号信息"],
  [/invalid\s+password/i, "密码错误，请重新输入"],
  [/invalid\s+email/i, "邮箱格式错误"],
  [/email\s+not\s+found|user\s+not\s+found|account\s+not\s+found/i, "账号不存在，请检查用户名/邮箱"],
  [/account\s+(is\s+)?(disabled|suspended|banned|blocked)/i, "账号已被禁用或封禁，请联系站点管理员"],
  [/unauthorized|not\s+logged\s+in|no\s+access\s+token|permission\s+denied|access\s+denied|forbidden|authentication\s+(is\s+)?required/i, "未登录或权限不足，请重新登录或检查 Cookie"],
  [/token\s+(has\s+)?expired|session\s+(has\s+)?expired|cookie\s+(has\s+)?expired|login\s+expired/i, "登录状态已过期，请重新获取 Cookie 或登录"],
  [/invalid\s+token|token\s+invalid|malformed\s+token/i, "登录令牌无效，请重新获取"],
  [/missing\s+token|no\s+token/i, "缺少登录令牌，请先登录"],
  [/access.?token\s+(has\s+)?expired|访问令牌已过期/i, "访问令牌已过期，请重新获取"],
  [/invalid\s+access.?token|访问令牌无效|access.?token\s+invalid/i, "访问令牌无效，请检查输入是否正确"],
  [/requires?\s+2fa|two.?factor|需要.*验证码/i, "该账号需要二步验证，请使用\"网页登录\""],
  
  // 限流和配额
  [/too\s+many\s+requests|rate\s+limit(ed)?|请求.*频繁/i, "请求过于频繁，请稍后再试（建议等待 1-5 分钟）"],
  [/quota\s+exceeded|额度.*不足|余额不足/i, "账号额度不足，请充值后再试"],
  [/daily\s+limit|daily\s+quota/i, "已达到每日请求限制"],
  [/concurrency\s+limit/i, "并发请求数超限，请稍后再试"],
  
  // 资源错误
  [/not\s+found|404/i, "请求的资源不存在，请检查站点地址或 API 路径"],
  [/already\s+exists|duplicate/i, "资源已存在或重复"],
  [/invalid\s+request|bad\s+request|400/i, "请求参数错误"],
  [/method\s+not\s+allowed|405/i, "请求方法不支持"],
  
  // 网络错误
  [/network\s+request\s+failed|failed\s+to\s+fetch|fetch\s+failed/i, "网络请求失败，请检查网络连接"],
  [/timed?\s*out|timeout|请求超时/i, "请求超时，站点响应过慢或网络不稳定"],
  [/connection\s+(refused|reset)|ECONNREFUSED|ECONNRESET/i, "无法连接到站点，请检查站点地址和网络"],
  [/dns\s+resolution\s+failed|getaddrinfo\s+ENOTFOUND/i, "域名解析失败，请检查站点地址"],
  [/ssl|certificate|cert/i, "SSL 证书错误，站点可能不安全或证书过期"],
  
  // 服务器错误
  [/internal\s+server\s+error|server\s+error|500/i, "服务器内部错误，请稍后重试或联系站点管理员"],
  [/bad\s+gateway|502/i, "网关错误，站点服务可能暂时不可用"],
  [/service\s+unavailable|503/i, "服务暂不可用，站点可能正在维护"],
  [/gateway\s+timeout|504/i, "网关超时，站点响应过慢"],
  
  // 验证和防护
  [/turnstile|签名|signature|challenge/i, "站点启用了 Cloudflare Turnstile 验证，请使用\"网页签到\"或\"网页登录\""],
  [/captcha|验证码/i, "需要验证码，请使用\"网页登录\"完成验证"],
  [/cloudflare|cf.?ray/i, "站点触发了 Cloudflare 防护，请使用\"网页登录\"通过验证"],
  [/响应不是 JSON.*<html|<script>var\s+arg1=/i, "站点返回了网页而非 API 数据，可能触发了验证或重定向"],
  
  // 功能和配置
  [/签到.*未开启|check.?in.*(disabled|not\s+enabled)|sign.?in.*(disabled|not\s+enabled)/i, "该站点未启用签到功能"],
  [/功能.*关闭|feature.*disabled/i, "该功能已关闭"],
  [/maintenance|维护中/i, "站点正在维护中，请稍后再试"],
  
  // 数据格式
  [/unexpected\s+token|json\s+parse|invalid\s+json/i, "服务器返回了无效的数据格式"],
  [/syntax\s+error/i, "数据解析错误"],
  
  // Sub2API 特定
  [/缺少 Sub2API 登录令牌/i, "缺少 Sub2API 登录令牌，请使用\"网页登录获取 Cookie\"或粘贴 auth_token"],
  [/未获取到 Sub2API auth_token/i, "未获取到登录令牌，请确认已登录后再关闭页面"],
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

export function getCheckinDisabledPatch(message: any): Partial<Account> {
  const text = String(message ?? "")
  if (/签到功能未开启|签到.*未开启|check-?in.*(disabled|not\s+enabled)|sign-?in.*(disabled|not\s+enabled)/i.test(text)) {
    return { lastCheckin: { enabled: false } }
  }
  return {}
}

export async function showConfirm(options: string | { title?: string, message: string, confirmLabel?: string, cancelLabel?: string }) {
  const fn = (globalThis as any).confirm
  if (typeof fn === "function") return await fn(options)
  console.log(typeof options === "string" ? options : `${options.title ?? "确认"}: ${options.message}`)
  return true
}