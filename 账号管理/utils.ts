import { Script, fetch } from "scripting"


declare const Data: any;
declare const Crypto: any;
declare const Storage: any;
declare const FileManager: any;

// --- 数据结构定义 ---
export type CustomField = { id: string; key: string; value: string }
export type AccountItem = { id: string; name: string; createdAt: string; apiKey?: string; username?: string; password?: string; email?: string; notes?: string; url?: string; tags?: string[]; avatarUrl?: string; customFields?: CustomField[]; isPinned?: boolean }
export type BookmarkItem = { id: string; title: string; createdAt: string; url: string; tags?: string[]; notes?: string; iconUrl?: string; customFields?: CustomField[]; isPinned?: boolean }
export type SyncBackupPayload = { accounts: AccountItem[]; bookmarks: BookmarkItem[] }
export type ICloudConfigMeta = { id: string; name: string; fileName: string; updatedAt: number; lastSyncAt?: number }
export type ICloudConfigIndex = { currentConfigId: string; configs: ICloudConfigMeta[] }
export type StoredICloudPasswordMap = Record<string, string>
export type WebDAVConfig = { url: string; username: string; password: string }

// --- 常量配置 ---
export const STORAGE_KEY = "api_accounts_storage_v1"
export const BOOKMARK_STORAGE_KEY = "bookmark_items_storage_v1"
export const WEBDAV_CONFIG_KEY = "webdav_config_secure_v1"
export const ICLOUD_SYNC_ENABLED_KEY = "icloud_sync_enabled_v1"
export const ICLOUD_LAST_SYNC_TIME_KEY = "icloud_last_sync_time_v1" 
export const ICLOUD_CONFIGS_INDEX_KEY = "icloud_sync_configs_index_v1"
export const ICLOUD_CURRENT_CONFIG_ID_KEY = "icloud_current_config_id_v1"
export const DEFAULT_ICLOUD_CONFIG_ID = "default"
export const ICLOUD_FILE_PASSWORDS_KEY = "icloud_file_passwords_secure_v1"

export const LOCAL_APP_SECRET = "Scripting_App_Local_Shield_2024!@#"
export const PAYLOAD_SIGNATURE = "SCRIPTING_SECURE_PAYLOAD_V1"

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

export const loadAccounts = (): AccountItem[] => {
  try {
    const raw = Storage.get(STORAGE_KEY)
    if (!raw) return []
    if (Array.isArray(raw)) return raw 
    if (typeof raw === "string") return decryptPayload<AccountItem[]>(raw, LOCAL_APP_SECRET)
    return []
  } catch { return [] }
}

export const loadBookmarks = (): BookmarkItem[] => {
  try {
    const raw = Storage.get(BOOKMARK_STORAGE_KEY)
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if (typeof raw === "string") return decryptPayload<BookmarkItem[]>(raw, LOCAL_APP_SECRET)
    return []
  } catch { return [] }
}

export const saveAccounts = (accounts: AccountItem[]): void => {
  Storage.set(STORAGE_KEY, encryptPayload(accounts, LOCAL_APP_SECRET))
}

export const saveBookmarks = (bookmarks: BookmarkItem[]): void => {
  Storage.set(BOOKMARK_STORAGE_KEY, encryptPayload(bookmarks, LOCAL_APP_SECRET))
}

export const loadICloudFilePasswords = (): StoredICloudPasswordMap => {
  const raw = Storage.get(ICLOUD_FILE_PASSWORDS_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(decryptString(String(raw), LOCAL_APP_SECRET))
    if (!parsed || typeof parsed !== "object") return {}
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => typeof key === "string" && typeof value === "string" && value.trim())) as StoredICloudPasswordMap
  } catch {
    return {}
  }
}

export const getICloudFilePassword = (configId: string): string | null => {
  const passwordMap = loadICloudFilePasswords()
  return passwordMap[configId] || null
}

export const saveICloudFilePassword = (configId: string, password: string): void => {
  const nextMap = { ...loadICloudFilePasswords(), [configId]: password }
  Storage.set(ICLOUD_FILE_PASSWORDS_KEY, encryptString(JSON.stringify(nextMap), LOCAL_APP_SECRET))
}

export const removeICloudFilePassword = (configId: string): void => {
  const passwordMap = loadICloudFilePasswords()
  if (!(configId in passwordMap)) return
  delete passwordMap[configId]
  Storage.set(ICLOUD_FILE_PASSWORDS_KEY, encryptString(JSON.stringify(passwordMap), LOCAL_APP_SECRET))
}

export const generateId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const sanitizeICloudConfigName = (name: string): string => name.trim().replace(/[\\/:*?"<>|]/g, "_")
const toICloudConfigFileName = (name: string): string => `${sanitizeICloudConfigName(name) || "默认配置"}.txt`
const getDefaultICloudConfigMeta = (): ICloudConfigMeta => ({ id: DEFAULT_ICLOUD_CONFIG_ID, name: "默认配置", fileName: toICloudConfigFileName("默认配置"), updatedAt: Date.now() })

export const loadICloudConfigIndex = (): ICloudConfigIndex => {
  const raw = Storage.get(ICLOUD_CONFIGS_INDEX_KEY)
  const currentId = Storage.get(ICLOUD_CURRENT_CONFIG_ID_KEY)
  if (raw && typeof raw === "object" && Array.isArray((raw as any).configs)) {
    const configs = (raw as any).configs
      .filter((item: any) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.fileName === "string")
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        fileName: item.fileName,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        lastSyncAt: typeof item.lastSyncAt === "number" ? item.lastSyncAt : undefined,
      }))
    if (configs.length > 0) {
      const resolvedCurrentId = typeof currentId === "string" && configs.some((item: ICloudConfigMeta) => item.id === currentId)
        ? currentId
        : ((raw as any).currentConfigId || configs[0].id)
      return { currentConfigId: resolvedCurrentId, configs }
    }
  }
  const fallback = getDefaultICloudConfigMeta()
  return { currentConfigId: DEFAULT_ICLOUD_CONFIG_ID, configs: [fallback] }
}

export const saveICloudConfigIndex = (index: ICloudConfigIndex): void => {
  Storage.set(ICLOUD_CONFIGS_INDEX_KEY, index)
  Storage.set(ICLOUD_CURRENT_CONFIG_ID_KEY, index.currentConfigId)
}

export const getCurrentICloudConfig = (): ICloudConfigMeta => {
  const index = loadICloudConfigIndex()
  return index.configs.find(item => item.id === index.currentConfigId) || index.configs[0] || getDefaultICloudConfigMeta()
}

export const ensureICloudConfigIndex = (): ICloudConfigIndex => {
  const index = loadICloudConfigIndex()
  saveICloudConfigIndex(index)
  return index
}
export const maskPassword = (pwd?: string): string => pwd ? "••••••••" : ""
export const maskApiKey = (key?: string): string => {
  if (!key) return ""
  const len = key.length
  if (len <= 4) return "•".repeat(len)
  if (len <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

const PINYIN_MAP = [
  { l: 'A', c: '阿' }, { l: 'B', c: '八' }, { l: 'C', c: '嚓' },
  { l: 'D', c: '搭' }, { l: 'E', c: '蛾' }, { l: 'F', c: '发' },
  { l: 'G', c: '噶' }, { l: 'H', c: '哈' }, { l: 'J', c: '击' },
  { l: 'K', c: '喀' }, { l: 'L', c: '垃' }, { l: 'M', c: '妈' },
  { l: 'N', c: '拿' }, { l: 'O', c: '哦' }, { l: 'P', c: '啪' },
  { l: 'Q', c: '期' }, { l: 'R', c: '然' }, { l: 'S', c: '撒' },
  { l: 'T', c: '塌' }, { l: 'W', c: '挖' }, { l: 'X', c: '昔' },
  { l: 'Y', c: '压' }, { l: 'Z', c: '匝' }
];

const getSortKey = (str: string): string => {
  const input = (str || "").trim().toUpperCase();
  let res = "";
  for (const char of input) {
    if (/[A-Z0-9]/.test(char)) {
      res += char;
    } 
    else if (/[\u4e00-\u9fa5]/.test(char)) {
      let found = "#";
      for (let i = PINYIN_MAP.length - 1; i >= 0; i--) {
        if (char.localeCompare(PINYIN_MAP[i].c, 'zh-Hans-CN') >= 0) {
          found = PINYIN_MAP[i].l;
          break;
        }
      }
      res += found;
    }
    else {
      res += char;
    }
  }
  return res;
};

export const sortByDisplayTitle = (a: string, b: string): number => {
  const keyA = getSortKey(a);
  const keyB = getSortKey(b);
  
  const res = keyA.localeCompare(keyB, 'en', { numeric: true });
  
  return res !== 0 ? res : a.localeCompare(b, 'zh-Hans-CN');
};

export const getGroupLetter = (name: string): string => {
  if (!name || name.trim() === "") return "#";
  const firstChar = name.trim().charAt(0).toUpperCase();
  
  if (/[A-Z]/.test(firstChar)) return firstChar;
  
  if (/[\u4e00-\u9fa5]/.test(firstChar)) {
    for (let i = PINYIN_MAP.length - 1; i >= 0; i--) {
      if (firstChar.localeCompare(PINYIN_MAP[i].c, 'zh-Hans-CN') >= 0) {
        return PINYIN_MAP[i].l;
      }
    }
  }
  return "#";
};

export const processUrl = (input?: string): string | null => {
  if (!input) return null
  let url = input.trim()
  if (!url) return null
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) url = "https://" + url
  const urlRegex = /^(https?:\/\/)?([\w\-]+(\.[\w\-]+)+|localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i
  if (urlRegex.test(url)) return url
  return null
}

// --- 同步模块 ---
export const loadWebDAVConfig = (): WebDAVConfig | null => {
  try {
    const rawSecure = Storage.get(WEBDAV_CONFIG_KEY)
    if (rawSecure) return JSON.parse(decryptString(rawSecure, LOCAL_APP_SECRET)) as WebDAVConfig
    return null
  } catch { return null }
}

export const saveWebDAVConfig = (config: WebDAVConfig): void => {
  Storage.set(WEBDAV_CONFIG_KEY, encryptString(JSON.stringify(config), LOCAL_APP_SECRET))
}

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

export const getIcloudFilePath = (config?: ICloudConfigMeta) => {
  const icloudRoot = FileManager.iCloudDocumentsDirectory
  if (!icloudRoot) throw new Error('未检测到 iCloud 云盘目录，请先在系统中启用 iCloud Drive')
  const rootFolder = `${icloudRoot}/scripts/${Script.name}`
  const configsFolder = `${rootFolder}/icloud-configs`
  const resolvedConfig = config || getCurrentICloudConfig()
  const filePath = `${configsFolder}/${resolvedConfig.fileName}`
  const indexPath = `${configsFolder}/icloud_sync_configs_index.json`
  const legacyIndexPath = `${rootFolder}/icloud_sync_configs_index.json`
  return { rootFolder, folder: configsFolder, filePath, indexPath, legacyIndexPath }
}

export const writeICloudConfigIndexFile = async (index: ICloudConfigIndex): Promise<void> => {
  const { rootFolder, indexPath, folder, legacyIndexPath } = getIcloudFilePath(index.configs.find(item => item.id === index.currentConfigId) || index.configs[0])
  await FileManager.createDirectory(rootFolder, true)
  await FileManager.createDirectory(folder, true)
  await FileManager.writeAsString(indexPath, JSON.stringify(index, null, 2))
  if (legacyIndexPath !== indexPath && await FileManager.exists(legacyIndexPath)) {
    try { await FileManager.remove(legacyIndexPath) } catch {}
  }
}

export const readICloudConfigIndexFile = async (): Promise<ICloudConfigIndex | null> => {
  try {
    const { indexPath, legacyIndexPath } = getIcloudFilePath()
    let targetPath = indexPath
    if (!(await FileManager.exists(targetPath)) && legacyIndexPath !== indexPath && await FileManager.exists(legacyIndexPath)) {
      targetPath = legacyIndexPath
    }
    if (!(await FileManager.exists(targetPath))) return null
    const raw = await FileManager.readAsString(targetPath)
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.configs)) return null
    const normalizedIndex = {
      currentConfigId: typeof parsed.currentConfigId === "string" ? parsed.currentConfigId : DEFAULT_ICLOUD_CONFIG_ID,
      configs: parsed.configs.filter((item: any) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.fileName === "string").map((item: any) => ({
        id: item.id,
        name: item.name,
        fileName: item.fileName,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
        lastSyncAt: typeof item.lastSyncAt === "number" ? item.lastSyncAt : undefined,
      })),
    }
    if (targetPath !== indexPath) await writeICloudConfigIndexFile(normalizedIndex)
    return normalizedIndex
  } catch {
    return null
  }
}

export const syncAccountsToICloud = async (payload: SyncBackupPayload, password: string, config?: ICloudConfigMeta) => {
  try {
    const targetConfig = config || getCurrentICloudConfig()
    const { folder, filePath } = getIcloudFilePath(targetConfig)
    await FileManager.createDirectory(folder, true)
    const encryptedData = encryptPayload(payload, password)
    await FileManager.writeAsString(filePath, encryptedData)
    const syncedAt = Date.now()
    const index = loadICloudConfigIndex()
    const configs = index.configs.map(item => item.id === targetConfig.id ? { ...item, lastSyncAt: syncedAt, updatedAt: syncedAt } : item)
    const nextIndex = { currentConfigId: index.currentConfigId, configs }
    saveICloudConfigIndex(nextIndex)
    await writeICloudConfigIndexFile(nextIndex)
    Storage.set(ICLOUD_LAST_SYNC_TIME_KEY, syncedAt)
  } catch (error) { console.error('iCloud 同步写入失败', error) }
}

export const restoreAccountsFromICloud = async (password: string, config?: ICloudConfigMeta): Promise<SyncBackupPayload | null> => {
  try {
    const { filePath } = getIcloudFilePath(config)
    if (!(await FileManager.exists(filePath))) return null
    const rawStr = await FileManager.readAsString(filePath)
    return normalizeSyncPayload(decryptPayload<unknown>(rawStr, password))
  } catch (error) { throw new Error("解密失败或数据损坏") }
}

export const checkICloudConfigFileExists = async (config?: ICloudConfigMeta): Promise<boolean> => {
  try {
    const { filePath } = getIcloudFilePath(config)
    return await FileManager.exists(filePath)
  } catch { return false }
}

export const createICloudConfig = async (name: string): Promise<ICloudConfigMeta> => {
  const index = loadICloudConfigIndex()
  const trimmed = name.trim()
  if (!trimmed) throw new Error("配置名称不能为空")
  if (index.configs.some(item => item.name === trimmed)) throw new Error("配置名称已存在")
  const now = Date.now()
  const config: ICloudConfigMeta = { id: generateId(), name: trimmed, fileName: toICloudConfigFileName(trimmed), updatedAt: now }
  const nextIndex = { currentConfigId: index.currentConfigId, configs: [...index.configs, config] }
  saveICloudConfigIndex(nextIndex)
  await writeICloudConfigIndexFile(nextIndex)
  return config
}

export const renameICloudConfig = async (configId: string, nextName: string): Promise<ICloudConfigIndex> => {
  const index = loadICloudConfigIndex()
  const trimmed = nextName.trim()
  if (!trimmed) throw new Error("配置名称不能为空")
  const target = index.configs.find(item => item.id === configId)
  if (!target) throw new Error("配置不存在")
  if (index.configs.some(item => item.id !== configId && item.name === trimmed)) throw new Error("配置名称已存在")
  const nextFileName = toICloudConfigFileName(trimmed)
  const { filePath: oldPath } = getIcloudFilePath(target)
  const renamedTarget = { ...target, name: trimmed, fileName: nextFileName, updatedAt: Date.now() }
  const { filePath: newPath } = getIcloudFilePath(renamedTarget)
  if (oldPath !== newPath && await FileManager.exists(oldPath)) {
    const raw = await FileManager.readAsString(oldPath)
    await FileManager.writeAsString(newPath, raw)
    try { await FileManager.remove(oldPath) } catch {}
  }
  const nextIndex = { currentConfigId: index.currentConfigId, configs: index.configs.map(item => item.id === configId ? renamedTarget : item) }
  saveICloudConfigIndex(nextIndex)
  await writeICloudConfigIndexFile(nextIndex)
  return nextIndex
}

export const deleteICloudConfig = async (configId: string): Promise<ICloudConfigIndex> => {
  const index = loadICloudConfigIndex()
  if (index.configs.length <= 1) throw new Error("至少保留一个配置")
  const target = index.configs.find(item => item.id === configId)
  if (!target) throw new Error("配置不存在")
  if (index.currentConfigId === configId) throw new Error("当前正在使用的配置不允许删除，请先切换到其他配置")
  const { filePath } = getIcloudFilePath(target)
  if (await FileManager.exists(filePath)) {
    try { await FileManager.remove(filePath) } catch {}
  }
  removeICloudFilePassword(configId)
  const configs = index.configs.filter(item => item.id !== configId)
  const nextIndex = { currentConfigId: index.currentConfigId, configs }
  saveICloudConfigIndex(nextIndex)
  await writeICloudConfigIndexFile(nextIndex)
  return nextIndex
}

export const switchICloudConfig = async (configId: string): Promise<ICloudConfigIndex> => {
  const index = loadICloudConfigIndex()
  if (!index.configs.some(item => item.id === configId)) throw new Error("配置不存在")
  const nextIndex = { ...index, currentConfigId: configId }
  saveICloudConfigIndex(nextIndex)
  await writeICloudConfigIndexFile(nextIndex)
  return nextIndex
}
