// 名称清理：保留字母数字、下划线、点、连字符与中文，其余替换为下划线
export function safeName(name: string) {
  const cleaned = name
    .trim()
    .split("")
    .map((char) => {
      if (/^[A-Za-z0-9_.-]$/.test(char) || /[\u4e00-\u9fff]/.test(char)) {
        return char
      }
      return "_"
    })
    .join("")
    .replace(/^[._]+|[._]+$/g, "")

  return cleaned || "project"
}

// 解析备份文件夹名中的 YYYYMMDD 与 HHMMSS
export function parseTimestamp(date: string, time: string) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6)) - 1
  const day = Number(date.slice(6, 8))
  const hour = Number(time.slice(0, 2))
  const minute = Number(time.slice(2, 4))
  const second = Number(time.slice(4, 6))
  return new Date(year, month, day, hour, minute, second).getTime()
}

export function timestampForName() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function formatDate(value: number) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

export function shortPath(path: string) {
  return path
}
