function splitSuffix(value: string): { path: string; suffix: string } {
  const index = value.search(/[?#]/)
  return index < 0
    ? { path: value, suffix: "" }
    : { path: value.slice(0, index), suffix: value.slice(index) }
}

function normalizePath(path: string): string {
  const trailingSlash = path.endsWith("/")
  const parts: string[] = []

  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }

  const normalized = `/${parts.join("/")}`
  return trailingSlash && normalized !== "/" ? `${normalized}/` : normalized
}

function getOrigin(value: string): string {
  return value.match(/^(https?:\/\/[^/?#]+)/i)?.[1] || ""
}

function getPath(value: string): string {
  const match = value.match(/^https?:\/\/[^/?#]+([^?#]*)/i)
  return match?.[1] || "/"
}

function resolveURL(value: string, base?: string): string {
  if (/^(https?:\/\/|data:)/i.test(value)) return value
  if (!base) return value

  const origin = getOrigin(base)
  if (!origin) return value
  if (value.startsWith("//")) {
    const protocol = base.match(/^https?:/i)?.[0] || "https:"
    return `${protocol}${value}`
  }

  const { path, suffix } = splitSuffix(value)
  if (!path) return `${origin}${getPath(base)}${suffix}`
  if (path.startsWith("/")) return `${origin}${normalizePath(path)}${suffix}`

  const basePath = getPath(base)
  const directory = basePath.endsWith("/") ? basePath : basePath.replace(/\/[^/]*$/, "/")
  return `${origin}${normalizePath(`${directory}${path}`)}${suffix}`
}

export class WebURL {
  href = ""
  host = ""
  hostname = ""
  pathname = "/"

  constructor(url: string, base?: string) {
    this.href = resolveURL(url, base)

    const hostMatch = this.href.match(/^https?:\/\/([^/?#]+)/i)
    if (hostMatch) {
      this.host = hostMatch[1]
      this.hostname = hostMatch[1].replace(/^\[[^\]]+\](?::\d+)?$/, match => match.split("]")[0] + "]").split(":")[0]
    }

    this.pathname = getPath(this.href)
  }
}
