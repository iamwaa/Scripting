// 本地数据持久化：存储到用户指定的 configs 目录
import { Path, Script } from "scripting"
import { AdGroup, normalizeGroup } from "./types"

// 存储目录：Script 目录上上级下的 configs
export const STORAGE_DIR = Path.join(
  Path.dirname(Path.dirname(Script.directory)),
  "configs"
)
export const STORAGE_FILE = Path.join(STORAGE_DIR, "tg-ad-regex.json")

// 读取全部广告库；文件不存在或损坏时返回空数组
export async function loadGroups(): Promise<AdGroup[]> {
  try {
    if (!FileManager.existsSync(STORAGE_FILE)) return []
    const raw = await FileManager.readAsString(STORAGE_FILE)
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.groups)) return data.groups.map(normalizeGroup)
    return []
  } catch (e) {
    console.error("读取存储失败：" + String(e))
    return []
  }
}

// 保存全部广告库；自动创建目录
export async function saveGroups(groups: AdGroup[]): Promise<void> {
  if (!FileManager.existsSync(STORAGE_DIR)) {
    await FileManager.createDirectory(STORAGE_DIR, true)
  }
  const payload = JSON.stringify({ version: 1, groups }, null, 2)
  await FileManager.writeAsString(STORAGE_FILE, payload)
}

// 生成短随机 id
export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
