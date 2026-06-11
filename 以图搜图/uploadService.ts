import { fetch, FormData } from "scripting"

import { uploadServerURL } from "./searchEngines"

export async function uploadImageForSearch(image: UIImage) {
  const imageData = image.toJPEGData(0.92)
  if (!imageData) {
    throw new Error("无法读取图片数据")
  }

  return uploadImageData(imageData)
}

async function uploadImageData(imageData: Data) {
  const form = new FormData()
  form.append("imgdata", `data:image/jpeg;base64,${imageData.toBase64String()}`)

  const response = await fetch(uploadServerURL, {
    method: "POST",
    body: form,
    timeout: 60,
  })

  const imageURL = (await response.text()).trim()
  if (!response.ok || !/^https?:\/\//.test(imageURL)) {
    throw new Error(`上传服务器返回异常：${imageURL || response.status}`)
  }

  return imageURL
}
