import type { ResourceItem } from "../types/resource"

function createObservable<T>(initialValue: T): Observable<T> {
  const ObservableRuntime = Observable as any
  return new ObservableRuntime(initialValue) as Observable<T>
}

export const pageURL = createObservable("")
export const isLoading = createObservable(false)
export const statusText = createObservable("输入网址后点击「提取资源」")
export const resources = createObservable<ResourceItem[]>([])
export const pageTitle = createObservable("")
export const selectedCategory = createObservable("all")
export const initialViewMode = createObservable<"main" | "downloads">("main")
export const toastMessage = createObservable("")
export const toastVisible = createObservable(false)
export const filterInvalidResources = createObservable(false)
export const hideThumbnails = createObservable(false)
export const isFiltering = createObservable(false)
export const filterProgress = createObservable({ completed: 0, total: 0 })

export function showToast(message: string) {
  toastMessage.setValue(message)
  toastVisible.setValue(false)
  toastVisible.setValue(true)
}
