/**
 * types/globals.d.ts - 全局函数与全局变量声明
 *
 * Scripting 运行时提供了若干全局函数（alert / confirm / prompt / fetch / Buffer 等），
 * 它们不属于模块导出，需在此声明以便 TypeScript 识别。
 */

// 全局对话框（无需 import）
declare function alert(
  message: string | { title?: string; message: string; buttonLabel?: string }
): Promise<void>

declare function confirm(
  message:
    | string
    | {
        message: string
        title?: string
        cancelLabel?: string
        confirmLabel?: string
      }
): Promise<boolean>

declare function prompt(
  message:
    | string
    | {
        title: string
        message?: string
        defaultValue?: string
        placeholder?: string
        obscureText?: boolean
        selectAll?: boolean
        cancelLabel?: string
        confirmLabel?: string
      }
): Promise<string | null>

declare const Dialog: {
  prompt: (options: {
    title: string
    message?: string
    defaultValue?: string
    placeholder?: string
    obscureText?: boolean
    cancelLabel?: string
    confirmLabel?: string
  }) => Promise<string | null>
  alert: (options: {
    title?: string
    message: string
    buttonLabel?: string
  }) => Promise<void>
  confirm: (options: {
    title?: string
    message: string
    cancelLabel?: string
    confirmLabel?: string
  }) => Promise<boolean>
  actionSheet: (options: {
    title: string
    message?: string
    cancelButton?: boolean
    actions: { label: string; destructive?: boolean }[]
  }) => Promise<number | null>
}

// 全局 fetch（isomorphic-git 远端操作依赖）
declare const fetch: any

// Buffer polyfill（由 polyfills.ts 注入 globalThis）
declare const Buffer: any
