import { Intent, Navigation, Script } from "scripting"

import { App } from "./HomePage"

async function run() {
  const image = Intent.imagesParameter?.[0] ?? imageFromSharedFile()
  if (!image) {
    Script.exit(Intent.text("没有收到图片。请从照片或文件分享一张图片到“以图搜图”。"))
    return
  }

  await Pasteboard.setImage(image)
  await Navigation.present(<App initialImage={image} />)
  Script.exit(Intent.text("已打开以图搜图首页，请选择搜索引擎后点击“搜索”。"))
}

function imageFromSharedFile() {
  const filePath = Intent.fileURLsParameter?.[0]
  return filePath ? UIImage.fromFile(filePath) : null
}

run()
