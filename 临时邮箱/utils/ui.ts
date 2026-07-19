// 显示提示弹窗（全局 alert 在 typings 中不存在，通过 globalThis 调用）
export function showAlert(message: string) {
  const g = globalThis as any
  if (typeof g.alert === "function") {
    g.alert(message)
  }
}

// 复制文本到剪贴板
export async function copyText(text: string) {
  const g = globalThis as any
  if (g.Pasteboard && typeof g.Pasteboard.setString === "function") {
    await g.Pasteboard.setString(text)
  }
}
