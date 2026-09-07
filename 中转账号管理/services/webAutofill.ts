// WebView 账号密码自动填写 / 保存
// 注入页内代理脚本：把账号已保存的用户名密码写入登录表单（走原型 setter，兼容 React/Vue 受控组件），
// 同时监听提交与输入变化，通过消息桥把用户新输入的账号密码回传原生，关页后询问是否保存。
import type { Account, WebViewAutofill } from "../types"
import { showConfirm } from "../utils/error"
import { getSecret, setSecret, secretKey, patchAccount } from "./storage"

export type WebLoginCredential = { username: string, password: string }
export type CapturedWebLogin = WebLoginCredential & { url?: string }

// WebView 侧句柄：inject / scheduleInject 供网页链路在导航后重新注入，save 供工具栏菜单手动保存
export type LoginAutofillHandle = WebViewAutofill & {
  inject: () => Promise<void>
  scheduleInject: () => void
  getCaptured: () => CapturedWebLogin | undefined
}

type AgentResult = {
  captured?: { username?: string, password?: string } | null
  url?: string
}

// 页内消息桥名称：与 webAuth 的 newapiNavigate 同风格，避免与站点自有 handler 冲突
const CAPTURE_HANDLER = "newapiSaveLogin"

// 构造页内代理脚本；captureOnly 时只读取当前输入，不改动表单
function buildLoginAgentScript(options: {
  credential: WebLoginCredential
  captureOnly: boolean
}) {
  const credential = {
    username: options.credential.username ?? "",
    password: options.credential.password ?? "",
  }
  return `
    const CRED = ${JSON.stringify(credential)};
    const CAPTURE_ONLY = ${options.captureOnly ? "true" : "false"};
    const HANDLER = ${JSON.stringify(CAPTURE_HANDLER)};
    const S = window.__newapiLoginAgent || (window.__newapiLoginAgent = { hooked: false, filledKey: "", lastSent: "", timer: 0 });

    const visible = (el) => !!el && !el.disabled && !el.readOnly && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const allInputs = () => Array.prototype.slice.call(document.querySelectorAll('input')).filter(visible);
    const passwordInputs = (list) => list.filter((el) => (el.getAttribute('type') || '').toLowerCase() === 'password');
    const attrText = (el) => [el.name, el.id, el.getAttribute('autocomplete'), el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();

    // 用户名输入框打分：语义属性 + 与密码框同表单 + 位于密码框之前且更靠近
    const findUserInput = (pwd, list) => {
      const pwdIndex = list.indexOf(pwd);
      let best = null;
      let bestScore = 0;
      list.forEach((el, index) => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type !== 'text' && type !== 'email' && type !== 'tel') return;
        const text = attrText(el);
        let score = 0;
        if (/user|name|email|mail|account|login|mobile|phone/.test(text)) score += 6;
        if (/search|captcha|verif|code|otp|token|invite|aff|2fa/.test(text)) score -= 8;
        if (el.form && el.form === pwd.form) score += 3;
        if (index < pwdIndex) score += 4 - Math.min(3, pwdIndex - index - 1);
        if (score > bestScore) { best = el; bestScore = score; }
      });
      return best;
    };

    // 受控组件必须走原型上的 value setter 再派发 input 事件，直接赋值不会触发框架状态更新
    const setValue = (el, value) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        el.focus();
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        return el.value === value;
      } catch (e) {
        return false;
      }
    };

    const collect = () => {
      const list = allInputs();
      const pwds = passwordInputs(list);
      const pwd = pwds.filter((el) => el.value)[0] || pwds[0];
      if (!pwd || !pwd.value) return null;
      const user = findUserInput(pwd, list);
      return { username: user && user.value ? String(user.value).trim() : '', password: String(pwd.value) };
    };

    // 去重用哈希：避免把明文密码留在页面全局对象里
    const hash = (text) => {
      let h = 5381;
      for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
      return String(h);
    };

    const send = (payload) => {
      const key = hash(payload.username + '|' + payload.password);
      if (S.lastSent === key) return;
      S.lastSent = key;
      try {
        window.webkit.messageHandlers[HANDLER].postMessage({
          username: payload.username,
          password: payload.password,
          url: location.href,
        });
      } catch (e) {}
    };
    const tap = () => { const value = collect(); if (value) send(value); };

    // 没有密码框或有多个密码框（注册 / 改密表单）都不填，避免把密码写进错误的表单
    const fill = () => {
      const list = allInputs();
      const pwds = passwordInputs(list);
      if (pwds.length !== 1) return false;
      const pwd = pwds[0];
      const key = location.origin + '|' + CRED.username;
      if (S.filledKey === key && pwd.value) return false;
      const user = findUserInput(pwd, list);
      let filled = false;
      if (user && CRED.username && !user.value && setValue(user, CRED.username)) filled = true;
      if (CRED.password && !pwd.value && setValue(pwd, CRED.password)) filled = true;
      if (filled) S.filledKey = key;
      return filled;
    };

    // 捕获监听每个文档只装一次；页面导航后 window 状态重置，会随重新注入再装
    if (!S.hooked) {
      S.hooked = true;
      document.addEventListener('submit', tap, true);
      document.addEventListener('click', tap, true);
      document.addEventListener('keydown', (event) => { if (event.key === 'Enter') tap(); }, true);
      const poll = () => { tap(); setTimeout(poll, 900); };
      setTimeout(poll, 900);
    }

    if (CAPTURE_ONLY) {
      return { captured: collect(), url: location.href };
    }

    // 登录表单常随 SPA 延迟渲染，未填成功时在有限次数内重试
    if (!fill() && (CRED.username || CRED.password)) {
      if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
      let tries = 0;
      const retry = () => {
        tries += 1;
        if (fill() || tries >= 20) { S.timer = 0; return; }
        S.timer = setTimeout(retry, 500);
      };
      S.timer = setTimeout(retry, 400);
    }
    return { captured: null, url: location.href };
  `
}

// 读取账号已保存的登录凭据，供 WebView 自动填写
export function getAccountLoginCredential(account: Account): WebLoginCredential {
  return {
    username: account.username ?? "",
    password: getSecret(account.passwordKey),
  }
}

// 把网页里的账号密码写回账号（密码进 secrets，用户名进账号记录）
export function saveAccountLoginCredential(account: Account, credential: WebLoginCredential) {
  const passwordKey = account.passwordKey ?? secretKey(account.id, "password")
  const password = credential.password.trim()
  if (!password) return "未获取到密码，未保存"
  setSecret(passwordKey, password)
  const patch: Partial<Account> = {}
  if (!account.passwordKey) patch.passwordKey = passwordKey
  const username = credential.username.trim()
  if (username && username !== account.username) patch.username = username
  if (Object.keys(patch).length) patchAccount(account.id, patch)
  return "账号密码已保存"
}

// 关页后询问是否保存网页里输入的账号密码；与已保存凭据一致时静默跳过
export async function maybeSaveCapturedLogin(account: Account, captured?: CapturedWebLogin) {
  const password = (captured?.password ?? "").trim()
  if (!password) return false
  const username = (captured?.username ?? "").trim()
  const savedPassword = getSecret(account.passwordKey)
  const sameUsername = !username || username === (account.username ?? "")
  if (password === savedPassword && sameUsername) return false
  const confirmed = await showConfirm({
    title: savedPassword ? "更新账号密码？" : "保存账号密码？",
    message: `检测到网页里登录的账号：${username || account.username || "未识别用户名"}\n\n保存后打开网页会自动填写，也可用于接口登录。`,
    confirmLabel: savedPassword ? "更新" : "保存",
    cancelLabel: "暂不保存",
    destructive: false,
  })
  if (!confirmed) return false
  saveAccountLoginCredential(account, { username, password })
  return true
}

// 在 WebView 上装好自动填写与捕获能力；onSave 为空时只记录捕获结果由调用方回填
export async function installLoginAutofill(webView: WebViewController, options: {
  credential?: WebLoginCredential
  onSave?: (credential: WebLoginCredential) => Promise<string> | string
} = {}): Promise<LoginAutofillHandle> {
  const credential: WebLoginCredential = {
    username: (options.credential?.username ?? "").trim(),
    password: options.credential?.password ?? "",
  }
  let captured: CapturedWebLogin | undefined

  try {
    await webView.addScriptMessageHandler(CAPTURE_HANDLER, (payload: any) => {
      const password = typeof payload?.password === "string" ? payload.password : ""
      if (!password) return false
      captured = {
        username: typeof payload?.username === "string" ? payload.username.trim() : "",
        password,
        url: typeof payload?.url === "string" ? payload.url : undefined,
      }
      return true
    })
  } catch {}

  const run = async (captureOnly: boolean) => {
    try {
      return await webView.evaluateJavaScript<AgentResult>(buildLoginAgentScript({ credential, captureOnly }))
    } catch {
      return undefined
    }
  }

  const handle: LoginAutofillHandle = {
    inject: async () => { await run(false) },
    scheduleInject: () => {
      setTimeout(() => { void handle.inject() }, 300)
      setTimeout(() => { void handle.inject() }, 1200)
    },
    save: async () => {
      const result = await run(true)
      const password = (result?.captured?.password ?? "").trim()
      if (!password) return "未在页面中找到已填写的账号密码"
      const value: WebLoginCredential = { username: (result?.captured?.username ?? "").trim(), password }
      captured = { ...value, url: result?.url }
      if (options.onSave) return await options.onSave(value)
      return "账号密码已记录，关闭页面后回填"
    },
    getCaptured: () => captured,
  }
  return handle
}
