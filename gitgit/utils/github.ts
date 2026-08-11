/**
 * 由提交作者邮箱推导头像 URL。
 * GitHub noreply 邮箱（12345+login@ / login@users.noreply.github.com）含登录名，直接取 GitHub 头像；
 * 其余邮箱走 Gravatar，无账号时回 GitHub 官方默认灰头像（与 GitHub 未设置头像一致）；空邮箱返回空串（由 AvatarView 回退）。
 */
export function avatarUrlForGitAuthor(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return ""
  const noreply = normalized.match(
    /^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/
  )
  if (noreply) return `https://github.com/${noreply[1]}.png`
  const data = Data.fromString(normalized)
  if (!data) return ""
  const hash = Crypto.md5(data).toHexString()
  // d 参数传 GitHub 默认头像：有 Gravatar 账号显示本人，无账号回 GitHub 同款灰头像
  const fallback = encodeURIComponent(
    "https://github.githubassets.com/images/gravatars/gravatar-user-420.png"
  )
  return `https://www.gravatar.com/avatar/${hash}?s=64&d=${fallback}`
}

/** GitHub 已关联账号时优先使用真实头像，否则按作者邮箱回退。 */
export function resolvedGitAuthorAvatarUrl(
  email: string,
  githubAvatarUrl?: string
): string {
  return githubAvatarUrl?.trim() || avatarUrlForGitAuthor(email)
}

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

function resolveGitHubContentUrl(url: string, fullName: string, image: boolean): string {
  const value = url.trim()
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return value
  if (value.startsWith("/")) return `https://github.com${value}`
  const path = value.replace(/^\.\//, "")
  const base = image
    ? `https://raw.githubusercontent.com/${fullName}/HEAD/`
    : `https://github.com/${fullName}/blob/HEAD/`
  return base + path
}

function convertGitHubHtml(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
    .replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
    .replace(/<(?:del|s|strike)>([\s\S]*?)<\/(?:del|s|strike)>/gi, "~~$1~~")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<kbd>([\s\S]*?)<\/kbd>/gi, "`$1`")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, "![$2]($1)")
    .replace(/<img\s+[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "![$1]($2)")
    .replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "![]($1)")
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, "\n\n> **$1**\n>\n")
    .replace(/<\/?details[^>]*>/gi, "\n")
    .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_match, body: string) =>
      `\n\n${body.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`
    )
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) =>
      `\n\n${"#".repeat(Number(level))} ${body.trim()}\n\n`
    )
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/?(?:ul|ol|div|span)[^>]*>/gi, "\n")
}

/** 将 GitHub Flavored Markdown 调整为原生 Markdown 组件可完整显示的形式。 */
export function githubMarkdownForDisplay(content: string, fullName: string): string {
  const protectedCode: string[] = []
  const protect = (value: string) => {
    const index = protectedCode.push(value) - 1
    return `\u0000GITHUB_CODE_${index}\u0000`
  }

  let result = String(content || "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, protect)
    .replace(/`+[^`\n]*`+/g, protect)
  result = convertGitHubHtml(result)
    .replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (_match, image: string, label: string, url: string) =>
      `${image}[${label}](${resolveGitHubContentUrl(url, fullName, image === "!")})`
    )
    .replace(/(^|[\s(])#(\d+)\b/g, `$1[#$2](https://github.com/${fullName}/issues/$2)`)
    .replace(/(^|[^\w@])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/g, "$1[@$2](https://github.com/$2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return result.replace(/\u0000GITHUB_CODE_(\d+)\u0000/g, (_match, index: string) =>
    protectedCode[Number(index)] || ""
  )
}
