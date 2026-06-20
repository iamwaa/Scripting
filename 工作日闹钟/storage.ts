import { Path, Script } from "scripting"

export const WORKDAY_DATA_DIR = Path.join(Path.dirname(Path.dirname(Script.directory)), "configs", "工作日闹钟数据")
const WORKDAY_DATA_FILE = Path.join(WORKDAY_DATA_DIR, "data.json")

type WorkdayData = Record<string, unknown>

function ensureWorkdayDataDirectory() {
  if (!FileManager.existsSync(WORKDAY_DATA_DIR)) {
    FileManager.createDirectorySync(WORKDAY_DATA_DIR, true)
  }
}

export function getWorkdayDataPath(): string {
  ensureWorkdayDataDirectory()
  return WORKDAY_DATA_FILE
}

export function readWorkdayData<T>(fallback: T): T {
  const path = getWorkdayDataPath()
  if (!FileManager.existsSync(path)) return fallback

  try {
    return JSON.parse(FileManager.readAsStringSync(path)) as T
  } catch {
    return fallback
  }
}

export function writeWorkdayData(value: unknown) {
  FileManager.writeAsStringSync(getWorkdayDataPath(), JSON.stringify(value, null, 2))
}

export const WorkdayStorage = {
  get<T>(key: string): T | undefined {
    return readWorkdayData<WorkdayData>({})[key] as T | undefined
  },

  set(key: string, value: unknown) {
    const data = readWorkdayData<WorkdayData>({})
    if (value === undefined) {
      delete data[key]
    } else {
      data[key] = value
    }
    writeWorkdayData(data)
  },
}
