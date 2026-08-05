/** 从 GitHub remote URL 提取 owner/repo。非 github.com 地址返回 null。 */
export function githubRepoFromRemoteUrl(url: unknown): string | null {
  const raw = String(url ?? "").trim()
  if (!raw) return null

  let host = ""
  let path = ""
  const scpMatch = raw.match(/^[^@\s/]+@([^:\s/]+):(.+)$/)
  if (scpMatch) {
    host = scpMatch[1]
    path = scpMatch[2]
  } else {
    const protocolMatch = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]+)\/(.+)$/)
    if (!protocolMatch) return null
    host = protocolMatch[1].replace(/^[^@]+@/, "").split(":")[0]
    path = protocolMatch[2]
  }

  if (host.toLowerCase() !== "github.com") return null
  const normalized = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
  const parts = normalized.split("/")
  if (parts.length !== 2 || parts.some((part) => !part || /\s/.test(part))) {
    return null
  }
  return `${parts[0]}/${parts[1]}`
}
