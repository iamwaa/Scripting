import type { ResourceItem } from "../types/resource"

// 状态管理
export const pageURL = new Observable("")
export const isLoading = new Observable(false)
export const statusText = new Observable("输入网址后点击「提取资源」")
export const resources = new Observable<ResourceItem[]>([])
export const pageTitle = new Observable("")
export const selectedCategory = new Observable("all")
export const initialViewMode = new (Observable as any)("main") as Observable<"main" | "downloads">
export const toastMessage = new Observable("")
export const toastVisible = new Observable(false)
export const filterInvalidResources = new Observable(false)
export const hideThumbnails = new Observable(false)
export const isFiltering = new Observable(false)
export const filterProgress = new Observable({ completed: 0, total: 0 })

export function showToast(message: string) {
  toastMessage.setValue(message)
  toastVisible.setValue(false)
  toastVisible.setValue(true)
}
