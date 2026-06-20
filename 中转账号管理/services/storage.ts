declare const FileManager: any
import type { Account, AccountSortPreference, AccountSortKey, SortDirection } from "../types"
import { now } from "../utils/format"
import { DATA_DIR, ACCOUNTS_FILE, SORT_FILE, SECRETS_FILE, SECRET_PREFIX } from "../constants"

// 确保数据目录存在
export function ensureDataDirSync() {
  if (!FileManager.existsSync(DATA_DIR)) {
    FileManager.createDirectorySync(DATA_DIR, true)
  }
}

// 通用文件读取辅助函数
export function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (FileManager.existsSync(filePath)) {
      const content = FileManager.readAsStringSync(filePath)
      if (content) return JSON.parse(content) as T
    }
  } catch {}
  return defaultValue
}

// 通用文件写入辅助函数
export function writeJsonFile(filePath: string, data: any) {
  ensureDataDirSync()
  FileManager.writeAsStringSync(filePath, JSON.stringify(data, null, 2))
}

// 从文件加载 secrets
export function loadSecretsFile(): Record<string, string> {
  return readJsonFile<Record<string, string>>(SECRETS_FILE, {})
}

// 保存 secrets 到文件
export function saveSecretsFile(secrets: Record<string, string>) {
  writeJsonFile(SECRETS_FILE, secrets)
}

export function loadAccounts(): Account[] {
  return readJsonFile<Account[]>(ACCOUNTS_FILE, [])
}

export function saveAccounts(accounts: Account[]) {
  writeJsonFile(ACCOUNTS_FILE, accounts)
}

function isAccountSortKey(value: any): value is AccountSortKey {
  return value === "name" || value === "platform" || value === "quota" || value === "checkin"
}

function isSortDirection(value: any): value is SortDirection {
  return value === "asc" || value === "desc"
}

export function loadAccountSortPreference(): AccountSortPreference {
  const saved = readJsonFile<Partial<AccountSortPreference>>(SORT_FILE, {})
  return {
    key: isAccountSortKey(saved?.key) ? saved.key : "name",
    direction: isSortDirection(saved?.direction) ? saved.direction : "asc",
  }
}

export function saveAccountSortPreference(preference: AccountSortPreference) {
  writeJsonFile(SORT_FILE, preference)
}

export function secretKey(accountId: string, kind: "password" | "cookie" | "accessToken") {
  return `${SECRET_PREFIX}${accountId}.${kind}`
}

export function getSecret(key?: string) {
  if (!key) return ""
  const secrets = loadSecretsFile()
  return secrets[key] ?? ""
}

export function setSecret(key: string, value: string) {
  if (value.trim()) {
    const secrets = loadSecretsFile()
    secrets[key] = value
    saveSecretsFile(secrets)
  }
}

export function removeSecret(key: string) {
  const secrets = loadSecretsFile()
  delete secrets[key]
  saveSecretsFile(secrets)
}

// 部分更新账户信息
export function patchAccount(accountId: string, patch: Partial<Account>) {
  const accounts = loadAccounts()
  const idx = accounts.findIndex(a => a.id === accountId)
  if (idx < 0) return accounts
  accounts[idx] = { ...accounts[idx], ...patch, updatedAt: now() }
  saveAccounts(accounts)
  return accounts
}
