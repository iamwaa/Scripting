import { Intent, Path } from "scripting"
import { runChat } from "./launch"

// 共享表单给出的路径带安全作用域，且只在 intent 启动的同步阶段有效。
// .json / .zip / 图片这类系统会预先拷进收件箱的类型，之后再读也正常；
// 而 .exe 等未识别类型给的是原位置路径，等页面挂载后（已跨过 await）
// 再 stat 就抛「没有查看它的权限」。
// 因此这里在任何 await 之前用同步 API 立刻拷进沙箱，后续全程用副本。
const stageDir = Path.join(FileManager.temporaryDirectory, "lan-share")

// 防御性归一化：真机分享给的是纯路径，只在确实带 file:// 前缀时才处理
function toFilePath(s: string): string {
  const p = s.startsWith("file://") ? s.slice(7) : s.startsWith("file:") ? s.slice(5) : s
  if (p === s) return s
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

// 清掉上一次会话残留的暂存副本，避免临时目录无限累积
function resetStageDir() {
  try {
    if (FileManager.existsSync(stageDir)) FileManager.removeSync(stageDir)
  } catch {
    // 清理失败不影响本次分享
  }
}

function stageSync(raw: string): string {
  const source = toFilePath(raw)
  try {
    if (!FileManager.existsSync(stageDir)) FileManager.createDirectorySync(stageDir, true)
    const dest = Path.join(stageDir, Path.basename(source))
    if (FileManager.existsSync(dest)) FileManager.removeSync(dest)
    FileManager.copyFileSync(source, dest)
    return dest
  } catch {
    // 拷贝失败则回退原始路径，交给 sendFiles 统一报错，不在入口中断整批
    return source
  }
}

resetStageDir()

const files = [
  ...(Intent.fileURLsParameter ?? []).map((raw) => stageSync(raw)),
  ...(Intent.imagePathsParameter ?? []),
]

runChat(files)
