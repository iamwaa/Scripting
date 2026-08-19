import { Path } from "scripting"
import { DirectorySummary } from "../types"

export function pathExists(path: string) {
  try {
    return FileManager.existsSync(path)
  } catch {
    return false
  }
}

export function isDirectory(path: string) {
  try {
    return FileManager.isDirectorySync(path)
  } catch {
    return false
  }
}

// 返回子项的绝对路径列表
export function listChildren(path: string): string[] {
  if (!pathExists(path)) {
    return []
  }

  return FileManager.readDirectorySync(path).map((item) => {
    return Path.isAbsolute(item) ? item : Path.join(path, item)
  })
}

export function statTime(path: string) {
  try {
    const stat = FileManager.statSync(path)
    return stat.modificationDate || stat.creationDate || Date.now()
  } catch {
    return Date.now()
  }
}

// 递归统计目录内的文件数量与体积
export function summarizeDirectory(path: string): DirectorySummary {
  let fileCount = 0
  let byteSize = 0

  for (const item of listChildren(path)) {
    if (isDirectory(item)) {
      const child = summarizeDirectory(item)
      fileCount += child.fileCount
      byteSize += child.byteSize
    } else {
      try {
        const stat = FileManager.statSync(item)
        fileCount += 1
        byteSize += stat.size || 0
      } catch {
        fileCount += 1
      }
    }
  }

  return { fileCount, byteSize }
}

// 收集相对路径列表，最多 limit 条，用于文件预览
export function collectFiles(path: string, root = path, limit = 80): string[] {
  const files: string[] = []

  function walk(current: string) {
    if (files.length >= limit) {
      return
    }

    for (const item of listChildren(current)) {
      if (files.length >= limit) {
        return
      }

      if (isDirectory(item)) {
        walk(item)
      } else {
        files.push(item.replace(`${root}/`, ""))
      }
    }
  }

  walk(path)
  return files
}

export function removeExistingPath(path: string) {
  if (!pathExists(path)) {
    return
  }

  FileManager.removeSync(path)
  if (pathExists(path)) {
    throw new Error(`删除失败：${path}`)
  }
}

export function copyDirectory(source: string, destination: string) {
  FileManager.createDirectorySync(destination, true)

  for (const item of listChildren(source)) {
    const target = Path.join(destination, Path.basename(item))
    if (isDirectory(item)) {
      copyDirectory(item, target)
    } else {
      FileManager.copyFileSync(item, target)
    }
  }
}

// 去掉末尾斜杠并统一 /private/var 前缀，便于路径比较
function normalizeComparablePath(path: string) {
  const normalized = path.trim().replace(/\/+$/g, "")
  return normalized.startsWith("/private/var/") ? normalized.slice("/private".length) : normalized
}

export function isSamePath(left: string, right: string) {
  return normalizeComparablePath(left) === normalizeComparablePath(right)
}
