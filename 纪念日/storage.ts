import { Script } from 'scripting'
import { AppData, AppSettings, Person, AnniversaryEvent } from './types'
import { deleteWidgetAvatar } from './widgetAvatar'

const DATA_VERSION = 1
const APP_FOLDER = '纪念日数据'
const DATA_FILE = 'data.json'

// 获取应用私有数据目录（位于当前脚本项目目录下）
function appDir(): string {
  return `${Script.directory}/${APP_FOLDER}`
}

// 获取头像存储目录
function avatarsDir(): string {
  return `${appDir()}/avatars`
}

// 获取数据文件路径
function dataFilePath(): string {
  return `${appDir()}/${DATA_FILE}`
}

// 初始化目录
export async function ensureDirectories(): Promise<void> {
  if (!(await FileManager.exists(appDir()))) {
    await FileManager.createDirectory(appDir(), true)
  }
  if (!(await FileManager.exists(avatarsDir()))) {
    await FileManager.createDirectory(avatarsDir(), true)
  }
}

// 默认设置
function defaultSettings(): AppSettings {
  return {
    defaultReminderDays: [1, 3],
    defaultRemindOnDay: true,
    notificationsEnabled: true,
    groupPastEvents: true,
    notificationHour: 9,
    notificationMinute: 0
  }
}

// 默认数据
function defaultData(): AppData {
  return {
    persons: [],
    events: [],
    settings: defaultSettings(),
    version: DATA_VERSION
  }
}

// 读取应用数据
export async function loadAppData(): Promise<AppData> {
  await ensureDirectories()
  const path = dataFilePath()
  if (!(await FileManager.exists(path))) {
    return defaultData()
  }
  try {
    const content = await FileManager.readAsString(path)
    const parsed = JSON.parse(content) as AppData
    if (!parsed || typeof parsed !== 'object') {
      return defaultData()
    }
    return {
      ...defaultData(),
      ...parsed,
      persons: parsed.persons ?? [],
      events: parsed.events ?? [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) }
    }
  } catch {
    return defaultData()
  }
}

// 保存应用数据
export async function saveAppData(data: AppData): Promise<void> {
  await ensureDirectories()
  const payload: AppData = { ...data, version: DATA_VERSION }
  await FileManager.writeAsString(dataFilePath(), JSON.stringify(payload, null, 2))
}

// 保存头像图片并返回本地路径
export async function saveAvatar(imageData: Data): Promise<string> {
  await ensureDirectories()
  const name = `avatar_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
  const path = `${avatarsDir()}/${name}`
  await FileManager.writeAsData(path, imageData)
  return path
}

// 删除头像文件
export async function deleteAvatar(path: string | null): Promise<void> {
  if (!path) return
  try {
    if (await FileManager.exists(path)) {
      await FileManager.remove(path)
    }
    await deleteWidgetAvatar(path)
  } catch {
    // 忽略清理失败
  }
}

// 生成唯一 ID
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// 数据迁移（未来扩展用）
function migrateData(data: AppData): AppData {
  return data
}

// 导出所有数据为 JSON 字符串
export function exportData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}
