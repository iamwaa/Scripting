export function mergeCookies(oldCookie: string, setCookieHeader?: string, responseCookies?: Array<{ name: string, value: string }>) {
  if (!setCookieHeader && !responseCookies?.length) return oldCookie
  const jar: Record<string, string> = {}
  for (const part of oldCookie.split(";")) {
    const item = part.trim()
    const eq = item.indexOf("=")
    if (eq > 0) jar[item.slice(0, eq)] = item.slice(eq + 1)
  }
  const lines = setCookieHeader ? String(setCookieHeader).split(/,(?=\s*[^;,\s]+=)/) : []
  for (const line of lines) {
    const first = line.split(";")[0]?.trim()
    const eq = first?.indexOf("=") ?? -1
    if (first && eq > 0) jar[first.slice(0, eq)] = first.slice(eq + 1)
  }
  for (const cookie of responseCookies ?? []) {
    if (cookie.name) jar[cookie.name] = cookie.value
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ")
}

export function cookiesToHeader(cookies: Array<{ name: string, value: string }>) {
  const jar: Record<string, string> = {}
  for (const cookie of cookies) {
    if (cookie.name) jar[cookie.name] = cookie.value
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ")
}

export function parseCookieHeader(cookieHeader: string) {
  const items: Array<{ name: string, value: string }> = []
  for (const part of cookieHeader.split(";")) {
    const item = part.trim()
    const eq = item.indexOf("=")
    if (eq <= 0) continue
    const name = item.slice(0, eq).trim()
    const value = item.slice(eq + 1).trim()
    if (name && !name.startsWith("$")) items.push({ name, value })
  }
  return items
}

export function getUrlHostname(url: string) {
  return url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]
}

export function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

export function resolveWebUrl(url: string, baseUrl: string) {
  try {
    const URLCtor = (globalThis as any).URL
    return URLCtor ? new URLCtor(url, baseUrl).href : url
  } catch {
    return url
  }
}

export function escapeHTML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}