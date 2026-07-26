// Scripting 运行时注入的原生对话框；类型可能未从 SDK 导出
declare const Dialog: {
  alert(message: string, title?: string): Promise<void>
  confirm(message: string, title?: string): Promise<boolean>
  prompt(
    messageOrOptions:
      | string
      | {
          title: string
          message?: string
          defaultValue?: string
          placeholder?: string
          obscureText?: boolean
        },
    title?: string,
    defaultValue?: string
  ): Promise<string | null>
  actionSheet(options: {
    title?: string
    message?: string
    actions: Array<{ title: string; style?: "default" | "destructive" | "cancel" }>
    cancelButton?: boolean
  }): Promise<number | null>
}
