import { fetch, FormData } from "scripting"

export type SauceNaoResult = {
  header?: {
    similarity?: string
    thumbnail?: string
    index_name?: string
  }
  data?: {
    title?: string
    ext_urls?: string[]
    source?: string
    member_name?: string
    creator?: string | string[]
    author_name?: string
    pixiv_id?: number
    material?: string
    characters?: string
  }
}

export async function searchSauceNao(imageURL: string) {
  const form = new FormData()
  form.append("output_type", "2")
  form.append("numres", "8")
  form.append("db", "999")
  form.append("minsim", "30")
  form.append("url", imageURL)

  const response = await fetch("https://saucenao.com/search.php", {
    method: "POST",
    body: form,
    headers: {
      Accept: "application/json",
    },
    timeout: 60,
  })

  const text = (await response.text()).trim()
  const data = parseSauceNaoJSON(text, response.status)
  if (!response.ok || data?.header?.status < 0) {
    throw new Error(data?.header?.message || `SauceNAO 请求失败：${response.status}`)
  }
  return (data.results ?? []) as SauceNaoResult[]
}

function parseSauceNaoJSON(text: string, status: number) {
  try {
    return JSON.parse(text)
  } catch {
    const preview = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    throw new Error(preview ? `SauceNAO 返回了网页而不是 JSON：${preview}` : `SauceNAO 返回格式异常：${status}`)
  }
}

export function sauceTitle(result: SauceNaoResult) {
  return result.data?.title || result.data?.source || result.header?.index_name || "未知来源"
}

export function sauceSubtitle(result: SauceNaoResult) {
  const similarity = result.header?.similarity ? `${result.header.similarity}%` : "相似度未知"
  const source = result.header?.index_name ?? "未知数据库"
  return `${similarity} · ${source}`
}

export function sauceCreator(result: SauceNaoResult) {
  const creator = result.data?.creator
  if (Array.isArray(creator)) {
    return creator.join(", ")
  }
  return creator || result.data?.member_name || result.data?.author_name || result.data?.material || result.data?.characters || ""
}
