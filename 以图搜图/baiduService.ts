import { fetch, FormData } from "scripting"

export async function uploadToBaiduGraph(image: UIImage) {
  const imageData = image.toJPEGData(0.92)
  if (!imageData) {
    throw new Error("无法读取图片数据")
  }

  const form = new FormData()
  form.append("from", "wise")
  form.append("image", imageData, "image/jpeg", "search.jpg")

  const response = await fetch("https://graph.baidu.com/upload", {
    method: "POST",
    headers: {
      "Acs-Token": "",
      Accept: "application/json, text/plain, */*",
      Referer: "https://graph.baidu.com/",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    body: form,
    timeout: 60,
  })

  const text = (await response.text()).trim()
  const data = parseBaiduUploadResponse(text, response.status)
  const resultURL = data?.data?.url
  if (!response.ok || typeof resultURL !== "string" || !/^https?:\/\//.test(resultURL)) {
    throw new Error(data?.msg || data?.message || `百度识图上传失败：${response.status}`)
  }

  return resultURL
}

function parseBaiduUploadResponse(text: string, status: number): BaiduUploadResponse {
  try {
    return JSON.parse(text) as BaiduUploadResponse
  } catch {
    const preview = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    throw new Error(preview ? `百度识图返回了网页而不是 JSON：${preview}` : `百度识图返回格式异常：${status}`)
  }
}

type BaiduUploadResponse = {
  data?: {
    url?: string
  }
  msg?: string
  message?: string
}
