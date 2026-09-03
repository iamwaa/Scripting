/**
 * tests/imageDiff.test.ts - 图片识别与格式化纯函数测试
 */
import { Script } from "scripting"
import {
  imageMimeFromPath,
  isImagePath,
  buildImageDataUrl,
  formatBytes,
} from "../utils/imageDiff"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("断言失败: " + message)
}

function main(): void {
  // 扩展名 → MIME
  {
    assert(imageMimeFromPath("logo.png") === "image/png", "png MIME")
    assert(imageMimeFromPath("a/b/photo.JPG") === "image/jpeg", "大写扩展名")
    assert(imageMimeFromPath("a/b/photo.jpeg") === "image/jpeg", "jpeg MIME")
    assert(imageMimeFromPath("anim.gif") === "image/gif", "gif MIME")
    assert(imageMimeFromPath("x.webp") === "image/webp", "webp MIME")
    assert(imageMimeFromPath("scan.tiff") === "image/tiff", "tiff MIME")
    assert(imageMimeFromPath("scan.tif") === "image/tiff", "tif 别名")
    assert(imageMimeFromPath("img.heic") === "image/heic", "heic MIME")
    assert(imageMimeFromPath("icon.ico") === "image/x-icon", "ico MIME")
    assert(imageMimeFromPath("main.ts") === null, "代码文件非图片")
    assert(imageMimeFromPath("README") === null, "无扩展名非图片")
    assert(imageMimeFromPath("archive.tar.gz") === null, "gz 非图片")
    assert(imageMimeFromPath(".gitignore") === null, "点文件非图片")
  }

  // isImagePath
  {
    assert(isImagePath("docs/pic.png"), "png 为图片路径")
    assert(!isImagePath("docs/pic.txt"), "txt 非图片路径")
  }

  // data URL
  {
    assert(
      buildImageDataUrl("image/png", "QUJD") === "data:image/png;base64,QUJD",
      "data URL 前缀"
    )
  }

  // 字节格式化
  {
    assert(formatBytes(0) === "0 B", "0 字节")
    assert(formatBytes(512) === "512 B", "B 级")
    assert(formatBytes(2048) === "2.0 KB", "KB 级")
    assert(formatBytes(1536) === "1.5 KB", "KB 小数")
    assert(formatBytes(12 * 1024 * 1024) === "12.0 MB", "MB 级")
    assert(formatBytes(3 * 1024 * 1024 * 1024) === "3.0 GB", "GB 级")
    assert(formatBytes(1048576 * 150) === "150 MB", "大 MB 取整不带小数")
    assert(formatBytes(-1) === "0 B", "负数按 0 处理")
  }

  Script.exit()
}

main()
