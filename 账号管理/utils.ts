import { Script, Path, fetch } from "scripting"

declare const Data: any
declare const Crypto: any
declare const FileManager: any

// --- 数据结构定义 ---
export type CustomField = { id: string; key: string; value: string }
export type AccountItem = { id: string; name: string; createdAt: string; apiKey?: string; username?: string; password?: string; email?: string; notes?: string; url?: string; tags?: string[]; avatarUrl?: string; customFields?: CustomField[]; isPinned?: boolean; groupId?: string }
export type BookmarkItem = { id: string; title: string; createdAt: string; url: string; tags?: string[]; notes?: string; iconUrl?: string; customFields?: CustomField[]; isPinned?: boolean; groupId?: string }
export type SyncBackupPayload = { accounts: AccountItem[]; bookmarks: BookmarkItem[] }
export type WebDAVConfig = { url: string; username: string; password: string }
// 分组数据结构
export type GroupItem = { id: string; name: string; createdAt: string; isCollapsed?: boolean }

// --- 存储路径 ---
const DATA_DIR = Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs', '账号管理数据')
const ACCOUNTS_FILE = Path.join(DATA_DIR, 'accounts.json')
const BOOKMARKS_FILE = Path.join(DATA_DIR, 'bookmarks.json')
const WEBDAV_FILE = Path.join(DATA_DIR, 'webdav.json')
const FILE_PASSWORD_FILE = Path.join(DATA_DIR, 'file_password.json')
const GROUPS_FILE = Path.join(DATA_DIR, 'groups.json')
const ACCOUNT_GROUPS_FILE = Path.join(DATA_DIR, 'account_groups.json')
const BOOKMARK_GROUPS_FILE = Path.join(DATA_DIR, 'bookmark_groups.json')

const LOCAL_APP_SECRET = "Scripting_App_Local_Shield_2024!@#"
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

// --- 基础工具函数 ---
export const normalizeSyncPayload = (data: unknown): SyncBackupPayload => {
  if (Array.isArray(data)) return { accounts: data as AccountItem[], bookmarks: [] }
  if (data && typeof data === "object") {
    const payload = data as Partial<SyncBackupPayload>
    return {
      accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
      bookmarks: Array.isArray(payload.bookmarks) ? payload.bookmarks : [],
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
export const testWebDAVConnection = async (config: WebDAVConfig): Promise<boolean> => {
  try {
    const authData = Data.fromRawString(`${config.username}:${config.password}`)
    if (!authData) throw new Error("Auth data invalid")
    const auth = authData.toBase64String()
    const response = await fetch(config.url, { method: "PROPFIND", headers: { "Authorization": `Basic ${auth}`, "Depth": "0" } })
    return response.ok
  } catch { return false }
}

export const uploadToWebDAV = async (config: WebDAVConfig, encryptedData: string): Promise<void> => {
  const authData = Data.fromRawString(`${config.username}:${config.password}`)
  if (!authData) throw new Error("Auth data invalid")
  const auth = authData.toBase64String()
  const baseUrl = config.url.replace(/\/+$/, "")
  const fileUrl = `${baseUrl}/accounts-sync-secure-v1.txt`
  const response = await fetch(fileUrl, { method: "PUT", headers: { "Authorization": `Basic ${auth}`, "Content-Type": "text/plain" }, body: encryptedData })
  if (!response.ok) throw new Error(`上传失败: ${response.status}`)
}

export const downloadFromWebDAV = async (config: WebDAVConfig): Promise<string> => {
  const authData = Data.fromRawString(`${config.username}:${config.password}`)
  if (!authData) throw new Error("Auth data invalid")
  const auth = authData.toBase64String()
  const baseUrl = config.url.replace(/\/+$/, "")
  const fileUrl = `${baseUrl}/accounts-sync-secure-v1.txt`
  const response = await fetch(fileUrl, { method: "GET", headers: { "Authorization": `Basic ${auth}` } })
  if (!response.ok) throw new Error(`下载失败: ${response.status}`)
  return await response.text()
}
