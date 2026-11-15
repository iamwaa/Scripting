import { request } from './client'
import { VM } from '../types'
import { WidgetSelection, selectWidgetVMs, selectionLabel } from '../utils/widgetSelection'

export interface WidgetData {
  items: VM[]
  total: number
  label: string
  updatedAt?: number
  note?: string
  title?: string
  message?: string
}

export async function loadWidgetVMs(token: string, selection: WidgetSelection, capacity: number): Promise<WidgetData> {
  const items: VM[] = []
  const ids = new Set<string>()
  const deadline = Date.now() + 18000
  let total = 0
  let note = ''
  let complete = false
  // 不请求单台详情；限时翻页，避免小组件扩展因大账户长时间等待。
  for (let page = 1; page <= 10; page++) {
    const remaining = (deadline - Date.now()) / 1000
    if (remaining <= 0) break
    const filter = selection.status ? `&status=${encodeURIComponent(selection.status)}` : ''
    try {
      const result = await request<{ vms: VM[]; total: number }>(`/vms?page=${page}&page_size=20${filter}`, token, 'GET', undefined, Math.min(8, remaining))
      if (!Array.isArray(result.vms)) throw new Error('实例列表格式不正确')
      total = result.total ?? result.vms.length
      let added = 0
      for (const vm of result.vms) {
        if (ids.has(vm.id)) continue
        ids.add(vm.id)
        items.push(vm)
        added++
      }
      complete = items.length >= total || result.vms.length === 0
      if (complete || !added) break
      const selected = selectWidgetVMs(items, selection, capacity)
      if (selection.mode === 'remarks') {
        if (!selected.missing.length && selected.items.length >= capacity) break
      } else if ((selection.mode === 'list' || selection.status) && selected.items.length >= capacity) break
    } catch (error) {
      if (!items.length) throw error
      note = '部分加载失败'
      break
    }
  }
  const selected = selectWidgetVMs(items, selection, capacity)
  if (selected.missing.length) {
    note = `${complete ? '未匹配' : '扫描未找到'}：${selected.missing.join('、')} · 列表补齐`
  } else if (!complete && (selected.items.length < capacity || selection.mode === 'status' && !selection.status)) {
    note = note || `仅扫描 ${items.length}/${total} 台`
  }
  return { items: selected.items, total, label: selectionLabel(selection), updatedAt: Date.now(), note }
}
