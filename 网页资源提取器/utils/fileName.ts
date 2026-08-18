export function sanitizeFileName(name: string, fallback = "resource"): string {
  const decoded = safeDecode(name)
  const cleaned = decoded
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()

  if (!cleaned || cleaned === "." || cleaned === "..") return fallback
  return cleaned.slice(0, 120)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
