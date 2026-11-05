import { Script, Path, fetch } from "scripting"

declare const Data: any
declare const Crypto: any
declare const FileManager: any

// --- 数据结构定义 ---
export type CustomField = { id: string; key: string; value: string }
export type AccountItem = { id: string; name: string; createdAt: string; apiKey?: string; username?: string; password?: string; email?: string; notes?: string; url?: string; tags?: string[]; avatarUrl?: string; customFields?: CustomField[]; isPinned?: boolean; groupId?: string }
export type BookmarkItem = { id: string; title: string; createdAt: string; url: string; tags?: string[]; notes?: string; iconUrl?: string; customFields?: CustomField[]; isPinned?: boolean; groupId?: string }
export type SyncBackupPayload = { accounts: AccountItem[]; bookmarks: BookmarkItem[]; settings?: BackupSettings }
export type WebDAVConfig = { url: string; username: string; password: string }
// 备份携带的项目设置项：安全设置、WebDAV 配置、图标库订阅
// 图标库订阅保持原始数据，恢复时由 icons 模块的 normalizeIconLibraries 校验
export type BackupSettings = { launchBiometricsEnabled?: boolean; webdavConfig?: WebDAVConfig; iconLibraries?: unknown[] }
// 分组数据结构
export type GroupItem = { id: string; name: string; createdAt: string; isCollapsed?: boolean }

// --- 存储路径 ---
export const DATA_DIR = Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', '账号管理数据')
const ACCOUNTS_FILE = Path.join(DATA_DIR, 'accounts.json')
const BOOKMARKS_FILE = Path.join(DATA_DIR, 'bookmarks.json')
const WEBDAV_FILE = Path.join(DATA_DIR, 'webdav.json')
const FILE_PASSWORD_FILE = Path.join(DATA_DIR, 'file_password.json')
const GROUPS_FILE = Path.join(DATA_DIR, 'groups.json')
const ACCOUNT_GROUPS_FILE = Path.join(DATA_DIR, 'account_groups.json')
const BOOKMARK_GROUPS_FILE = Path.join(DATA_DIR, 'bookmark_groups.json')
const SECURITY_SETTINGS_FILE = Path.join(DATA_DIR, 'security_settings.json')

export const LOCAL_APP_SECRET = "Scripting_App_Local_Shield_2024!@#"
const PAYLOAD_SIGNATURE = "SCRIPTING_SECURE_PAYLOAD_V1"

// --- 确保数据目录存在 ---
const ensureDataDir = async (): Promise<void> => {
  if (!(await FileManager.exists(DATA_DIR))) {
    await FileManager.createDirectory(DATA_DIR, true)
  }
}

// --- 加密与安全工具 ---
export const deriveKey = (password: string) => {
  const pwdData = Data.fromRawString(password)
  if (!pwdData) throw new Error("密码转换为 Data 失败")
  return Crypto.sha256(pwdData)
}

export const encryptString = (str: string, password: string): string => {
  const key = deriveKey(password)
  const strData = Data.fromRawString(str)
  if (!strData) throw new Error("明文转换为 Data 失败")
  const encrypted = Crypto.encryptAESGCM(strData, key)
  if (!encrypted) throw new Error("AES 加密失败")
  const base64Str = encrypted.toBase64String()
  if (base64Str === null) throw new Error("转换为 Base64 失败")
  return base64Str
}

export const decryptString = (base64Str: string, password: string): string => {
  const key = deriveKey(password)
  const encryptedData = Data.fromBase64String(base64Str)
  if (!encryptedData) throw new Error("无效的 Base64 数据")
  const decrypted = Crypto.decryptAESGCM(encryptedData, key)
  if (!decrypted) throw new Error("AES 解密失败：密钥错误或数据损坏")
  const rawStr = decrypted.toRawString()
  if (rawStr === null) throw new Error("转换为明文字符串失败")
  return rawStr
}

export const encryptPayload = <T,>(data: T, password: string): string => {
  const payload = JSON.stringify({ verify: PAYLOAD_SIGNATURE, data })
  return encryptString(payload, password)
}

export const decryptPayload = <T,>(base64Str: string, password: string): T => {
  const rawStr = decryptString(base64Str, password)
  const parsed = JSON.parse(rawStr)
  if (parsed.verify !== PAYLOAD_SIGNATURE) {
    throw new Error("数据校验失败：内容可能被篡改")
  }
  return parsed.data as T
}

export const isEncryptedFormat = (str: string): boolean => { try { JSON.parse(str); return false; } catch { return true; } }

// --- 文件密码管理 ---
export const loadFilePassword = async (): Promise<string | null> => {
  try {
    if (!(await FileManager.exists(FILE_PASSWORD_FILE))) return null
    const raw = await FileManager.readAsString(FILE_PASSWORD_FILE)
    return decryptString(raw, LOCAL_APP_SECRET)
  } catch { return null }
}

export const saveFilePassword = async (pwd: string): Promise<void> => {
  await ensureDataDir()
  const encrypted = encryptString(pwd, LOCAL_APP_SECRET)
  await FileManager.writeAsString(FILE_PASSWORD_FILE, encrypted)
}

export const clearFilePassword = async (): Promise<void> => {
  if (await FileManager.exists(FILE_PASSWORD_FILE)) {
    try { await FileManager.remove(FILE_PASSWORD_FILE) } catch {}
  }
}

// --- 数据读写 ---
export const loadAccounts = async (): Promise<AccountItem[]> => {
  try {
    if (!(await FileManager.exists(ACCOUNTS_FILE))) return []
    const raw = await FileManager.readAsString(ACCOUNTS_FILE)
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === "string") return decryptPayload<AccountItem[]>(raw, LOCAL_APP_SECRET)
    return []
  } catch { return [] }
}

export const saveAccounts = async (accounts: AccountItem[]): Promise<void> => {
  await ensureDataDir()
  await FileManager.writeAsString(ACCOUNTS_FILE, encryptPayload(accounts, LOCAL_APP_SECRET))
}

export const loadBookmarks = async (): Promise<BookmarkItem[]> => {
  try {
    if (!(await FileManager.exists(BOOKMARKS_FILE))) return []
    const raw = await FileManager.readAsString(BOOKMARKS_FILE)
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === "string") return decryptPayload<BookmarkItem[]>(raw, LOCAL_APP_SECRET)
    return []
  } catch { return [] }
}

export const saveBookmarks = async (bookmarks: BookmarkItem[]): Promise<void> => {
  await ensureDataDir()
  await FileManager.writeAsString(BOOKMARKS_FILE, encryptPayload(bookmarks, LOCAL_APP_SECRET))
}

// --- 分组数据读写 ---
const loadGroupFile = async (filePath: string): Promise<GroupItem[]> => {
  try {
    if (!(await FileManager.exists(filePath))) return []
    const raw = await FileManager.readAsString(filePath)
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === "string") return decryptPayload<GroupItem[]>(raw, LOCAL_APP_SECRET)
    return []
  } catch { return [] }
}

const saveGroupFile = async (filePath: string, groups: GroupItem[]): Promise<void> => {
  await ensureDataDir()
  await FileManager.writeAsString(filePath, encryptPayload(groups, LOCAL_APP_SECRET))
}

export const loadAccountGroups = () => loadGroupFile(ACCOUNT_GROUPS_FILE)
export const saveAccountGroups = (groups: GroupItem[]) => saveGroupFile(ACCOUNT_GROUPS_FILE, groups)
export const loadBookmarkGroups = () => loadGroupFile(BOOKMARK_GROUPS_FILE)
export const saveBookmarkGroups = (groups: GroupItem[]) => saveGroupFile(BOOKMARK_GROUPS_FILE, groups)

// 兼容旧版：迁移 groups.json 到 account_groups.json
export const migrateOldGroups = async (): Promise<void> => {
  try {
    if (await FileManager.exists(GROUPS_FILE)) {
      const oldGroups = await loadGroupFile(GROUPS_FILE)
      if (oldGroups.length > 0 && !(await FileManager.exists(ACCOUNT_GROUPS_FILE))) {
        await saveGroupFile(ACCOUNT_GROUPS_FILE, oldGroups)
      }
      await FileManager.remove(GROUPS_FILE)
    }
  } catch {}
}

export const loadWebDAVConfig = async (): Promise<WebDAVConfig | null> => {
  try {
    if (!(await FileManager.exists(WEBDAV_FILE))) return null
    const raw = await FileManager.readAsString(WEBDAV_FILE)
    if (!raw) return null
    return JSON.parse(decryptString(raw, LOCAL_APP_SECRET)) as WebDAVConfig
  } catch { return null }
}

export const saveWebDAVConfig = async (config: WebDAVConfig): Promise<void> => {
  await ensureDataDir()
  await FileManager.writeAsString(WEBDAV_FILE, encryptString(JSON.stringify(config), LOCAL_APP_SECRET))
}

export const clearWebDAVConfigFile = async (): Promise<void> => {
  if (await FileManager.exists(WEBDAV_FILE)) {
    try { await FileManager.remove(WEBDAV_FILE) } catch {}
  }
}

export const loadLaunchBiometricsEnabled = async (): Promise<boolean> => {
  try {
    if (!(await FileManager.exists(SECURITY_SETTINGS_FILE))) return false
    const raw = await FileManager.readAsString(SECURITY_SETTINGS_FILE)
    if (!raw || typeof raw !== "string") return false
    const settings = JSON.parse(decryptString(raw, LOCAL_APP_SECRET)) as { launchBiometricsEnabled?: boolean }
    return settings.launchBiometricsEnabled === true
  } catch { return false }
}

export const saveLaunchBiometricsEnabled = async (enabled: boolean): Promise<void> => {
  await ensureDataDir()
  const encrypted = encryptString(JSON.stringify({ launchBiometricsEnabled: enabled }), LOCAL_APP_SECRET)
  await FileManager.writeAsString(SECURITY_SETTINGS_FILE, encrypted)
}

// --- 基础工具函数 ---
// 校验备份中的设置项，丢弃结构不正确的部分
export const normalizeBackupSettings = (value: unknown): BackupSettings | undefined => {
  if (!value || typeof value !== "object") return undefined
  const settings = value as BackupSettings
  const webdav = settings.webdavConfig
  return {
    launchBiometricsEnabled: settings.launchBiometricsEnabled === true,
    webdavConfig: webdav && typeof webdav.url === "string" && typeof webdav.username === "string" && typeof webdav.password === "string" ? webdav : undefined,
    iconLibraries: Array.isArray(settings.iconLibraries)
      ? settings.iconLibraries.filter((lib): boolean => !!lib && typeof lib === "object" && typeof (lib as { url?: unknown }).url === "string")
      : [],
  }
}

export const normalizeSyncPayload = (data: unknown): SyncBackupPayload => {
  if (Array.isArray(data)) return { accounts: data as AccountItem[], bookmarks: [] }
  if (data && typeof data === "object") {
    const payload = data as Partial<SyncBackupPayload>
    return {
      accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
      bookmarks: Array.isArray(payload.bookmarks) ? payload.bookmarks : [],
      settings: normalizeBackupSettings(payload.settings),
    }
  }
  throw new Error("格式错误")
}

export const generateId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
export const maskPassword = (pwd?: string): string => pwd ? "••••••••" : ""
export const maskApiKey = (key?: string): string => {
  if (!key) return ""
  const len = key.length
  if (len <= 4) return "•".repeat(len)
  if (len <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

// --- 排序工具 ---
const PINYIN_MAP = [
  { l: 'A', c: '阿' }, { l: 'B', c: '八' }, { l: 'C', c: '嚓' },
  { l: 'D', c: '搭' }, { l: 'E', c: '蛾' }, { l: 'F', c: '发' },
  { l: 'G', c: '噶' }, { l: 'H', c: '哈' }, { l: 'J', c: '击' },
  { l: 'K', c: '喀' }, { l: 'L', c: '垃' }, { l: 'M', c: '妈' },
  { l: 'N', c: '拿' }, { l: 'O', c: '哦' }, { l: 'P', c: '啪' },
  { l: 'Q', c: '期' }, { l: 'R', c: '然' }, { l: 'S', c: '撒' },
  { l: 'T', c: '塌' }, { l: 'W', c: '挖' }, { l: 'X', c: '昔' },
  { l: 'Y', c: '压' }, { l: 'Z', c: '匝' }
]

const getSortKey = (str: string): string => {
  const input = (str || "").trim().toUpperCase()
  let res = ""
  for (const char of input) {
    if (/[A-Z0-9]/.test(char)) {
      res += char
    } else if (/[\u4e00-\u9fa5]/.test(char)) {
      let found = "#"
      for (let i = PINYIN_MAP.length - 1; i >= 0; i--) {
        if (char.localeCompare(PINYIN_MAP[i].c, 'zh-Hans-CN') >= 0) {
          found = PINYIN_MAP[i].l
          break
        }
      }
      res += found
    } else {
      res += char
    }
  }
  return res
}

export const sortByDisplayTitle = (a: string, b: string): number => {
  const keyA = getSortKey(a)
  const keyB = getSortKey(b)
  const res = keyA.localeCompare(keyB, 'en', { numeric: true })
  return res !== 0 ? res : a.localeCompare(b, 'zh-Hans-CN')
}

export const getGroupLetter = (name: string): string => {
  if (!name || name.trim() === "") return "#"
  const firstChar = name.trim().charAt(0).toUpperCase()
  if (/[A-Z]/.test(firstChar)) return firstChar
  if (/[\u4e00-\u9fa5]/.test(firstChar)) {
    for (let i = PINYIN_MAP.length - 1; i >= 0; i--) {
      if (firstChar.localeCompare(PINYIN_MAP[i].c, 'zh-Hans-CN') >= 0) {
        return PINYIN_MAP[i].l
      }
    }
  }
  return "#"
}

export const processUrl = (input?: string): string | null => {
  if (!input) return null
  let url = input.trim()
  if (!url) return null
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) url = "https://" + url
  const urlRegex = /^(https?:\/\/)?([\w\-]+(\.[\w\-]+)+|localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i
  if (urlRegex.test(url)) return url
  return null
}

// --- 站点信息拓取工具 ---
export type SiteInfo = { title: string | null; iconUrl: string | null }

export const fetchSiteInfo = async (url: string): Promise<SiteInfo> => {
  const processed = processUrl(url)
  if (!processed) return { title: null, iconUrl: null }
  try {
    const match = processed.match(/^https?:\/\/([^/?#]+)/)
    if (!match) return { title: null, iconUrl: null }
    const origin = processed.match(/^https?:\/\/[^/?#]+/)?.[0] || `https://${match[1]}`
    const resp = await fetch(origin)
    if (!resp.ok) return { title: null, iconUrl: `${origin}/favicon.ico` }
    const html = await resp.text()
    // 解析 <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : null
    // 解析 <link rel="icon"> 或 rel="shortcut icon"
    const iconMatch = html.match(/<link[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["']/i)
      || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut\s+)?icon["']/i)
    let iconUrl: string | null = null
    if (iconMatch) {
      const href = iconMatch[1]
      if (href.startsWith("http")) iconUrl = href
      else if (href.startsWith("//")) iconUrl = `https:${href}`
      else if (href.startsWith("/")) iconUrl = `${origin}${href}`
      else iconUrl = `${origin}/${href}`
    } else {
      iconUrl = `${origin}/favicon.ico`
    }
    return { title, iconUrl }
  } catch {
    return { title: null, iconUrl: null }
  }
}

// --- WebDAV 同步 ---
// 连接检查结果：除成败外带上可直接展示给用户的原因，以及本次新建的目录名
export type WebDAVCheckResult = { ok: boolean; message: string; created: string[] }

const WEBDAV_SYNC_FILE = "accounts-sync-secure-v1.txt"

const webdavAuthHeader = (config: WebDAVConfig): string => {
  const authData = Data.fromRawString(`${config.username}:${config.password}`)
  if (!authData) throw new Error("无法生成认证信息")
  return `Basic ${authData.toBase64String()}`
}

// 统一去掉地址末尾的斜杠，拼文件路径时不会出现双斜杠
const webdavBaseUrl = (config: WebDAVConfig): string => config.url.trim().replace(/\/+$/, "")

const webdavRequest = (config: WebDAVConfig, url: string, method: string, headers: Record<string, string> = {}, body?: string) =>
  fetch(url, { method, headers: { Authorization: webdavAuthHeader(config), ...headers }, ...(body === undefined ? {} : { body }) })

// 把状态码翻译成可执行的提示，避免一律显示“连接失败”
const webdavStatusText = (status: number): string => {
  if (status === 401) return "用户名或密码不正确"
  if (status === 403) return "服务器拒绝访问，请确认已开启 WebDAV 且账号有权限"
  if (status === 404) return "路径不存在或 WebDAV 未开启"
  if (status === 409) return "上级目录不存在"
  if (status === 507) return "服务器存储空间不足"
  return `请求失败（HTTP ${status}）`
}

// 目录名在 URL 里是百分号编码的，展示时还原成可读文字
const decodeSegment = (segment: string): string => {
  try { return decodeURIComponent(segment) } catch { return segment }
}

// 路径不存在时逐级 MKCOL 补齐目录；返回本次真正创建的目录名
const ensureWebDAVDirectory = async (config: WebDAVConfig): Promise<string[]> => {
  const baseUrl = webdavBaseUrl(config)
  if (!baseUrl) throw new Error("WebDAV 地址为空")

  const probe = await webdavRequest(config, baseUrl, "PROPFIND", { Depth: "0" })
  if (probe.ok) return []
  if (probe.status !== 404) throw new Error(webdavStatusText(probe.status))

  const parsed = new URL(baseUrl)
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length === 0) throw new Error("地址缺少路径，请填写形如 https://域名/webdav/ 的地址")

  // 从深到浅找最深的已存在目录，避免在服务器根路径上乱建目录
  let existingCount = segments.length - 1
  while (existingCount > 0) {
    const ancestorUrl = `${parsed.origin}/${segments.slice(0, existingCount).join("/")}`
    const response = await webdavRequest(config, ancestorUrl, "PROPFIND", { Depth: "0" })
    if (response.ok) break
    if (response.status === 401 || response.status === 403) throw new Error(webdavStatusText(response.status))
    existingCount--
  }

  const created: string[] = []
  for (let index = existingCount; index < segments.length; index++) {
    const directoryUrl = `${parsed.origin}/${segments.slice(0, index + 1).join("/")}`
    const response = await webdavRequest(config, directoryUrl, "MKCOL")
    // 201 表示新建成功；405 表示目录已存在，可继续下一级
    if (response.status === 201) { created.push(decodeSegment(segments[index])); continue }
    if (response.ok || response.status === 405) continue
    throw new Error(`创建目录「${decodeSegment(segments[index])}」失败：${webdavStatusText(response.status)}`)
  }

  const verify = await webdavRequest(config, baseUrl, "PROPFIND", { Depth: "0" })
  if (!verify.ok) throw new Error(`目标路径仍不可用：${webdavStatusText(verify.status)}`)
  return created
}

// 连接测试：目录不存在会自动创建，失败时给出具体原因
export const testWebDAVConnection = async (config: WebDAVConfig): Promise<WebDAVCheckResult> => {
  try {
    const created = await ensureWebDAVDirectory(config)
    return { ok: true, message: created.length > 0 ? `已自动创建目录：${created.join(" / ")}` : "连接正常", created }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "连接失败", created: [] }
  }
}

export const uploadToWebDAV = async (config: WebDAVConfig, encryptedData: string): Promise<void> => {
  try {
    await ensureWebDAVDirectory(config)
  } catch (error) {
    throw new Error(`备份目录不可用：${error instanceof Error ? error.message : "未知错误"}`)
  }
  const fileUrl = `${webdavBaseUrl(config)}/${WEBDAV_SYNC_FILE}`
  const response = await webdavRequest(config, fileUrl, "PUT", { "Content-Type": "text/plain" }, encryptedData)
  if (!response.ok) throw new Error(`上传失败：${webdavStatusText(response.status)}`)
}

export const downloadFromWebDAV = async (config: WebDAVConfig): Promise<string> => {
  const fileUrl = `${webdavBaseUrl(config)}/${WEBDAV_SYNC_FILE}`
  const response = await webdavRequest(config, fileUrl, "GET")
  if (response.status === 404) throw new Error("云端还没有备份文件，请先上传一次")
  if (!response.ok) throw new Error(`下载失败：${webdavStatusText(response.status)}`)
  return await response.text()
}
