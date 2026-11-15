import { VM } from '../types'
import { statusText } from '../utils'

export interface WidgetSelection {
  mode: 'list' | 'status' | 'remarks'
  remarks: string[]
  status?: string
}

export function widgetCapacity(family: string): number {
  return family === 'systemSmall' ? 1 : family === 'systemLarge' ? 4 : 2
}

export function parseWidgetParameter(parameter: string): WidgetSelection {
  const text = parameter.trim()
  if (!text || /^(列表|list)$/i.test(text)) return { mode: 'list', remarks: [] }
  if (/^(状态|status)$/i.test(text)) return { mode: 'status', remarks: [] }
  const filter = text.match(/^(?:状态|status)\s*[:：]\s*(.+)$/i)
  if (filter) {
    const aliases: Record<string, string> = {
      运行: 'running', 运行中: 'running', 关机: 'stopped', 已关机: 'stopped',
      异常: 'error', 创建中: 'creating', 开机中: 'starting', 关机中: 'stopping',
      重启中: 'restarting', 重装中: 'reinstalling',
    }
    const value = filter[1].trim()
    return { mode: 'status', remarks: [], status: aliases[value] ?? value.toLowerCase() }
  }
  // 备注前缀可避开「状态 / 列表」等保留参数；空格属于备注，不作为分隔符。
  const names = text.replace(/^(?:备注|remarks)\s*[:：]\s*/i, '').split(/[,，;；|\n]+/)
  const remarks = [...new Set(names.map(name => name.trim()).filter(Boolean))]
  return { mode: remarks.length ? 'remarks' : 'list', remarks }
}

export function selectionLabel(selection: WidgetSelection): string {
  if (selection.mode === 'remarks') return '备注优先'
  if (selection.status) return statusText(selection.status)
  return selection.mode === 'status' ? '异常优先' : '列表顺序'
}

export function widgetInstanceName(vm: VM): string {
  return vm.remark?.trim() || vm.machine_name?.trim() || vm.id.slice(0, 8)
}

export function selectWidgetVMs(items: VM[], selection: WidgetSelection, capacity: number): { items: VM[]; missing: string[] } {
  const unique = [...new Map(items.map(vm => [vm.id, vm])).values()]
  if (selection.mode === 'remarks') {
    const preferred: VM[] = []
    const missing: string[] = []
    for (const name of selection.remarks.slice(0, capacity)) {
      // 先匹配真实备注；未设置备注时使用与小组件标题一致的默认名称。
      const vm = unique.find(item => item.remark?.trim() === name)
        ?? unique.find(item => !item.remark?.trim() && widgetInstanceName(item) === name)
      if (vm) preferred.push(vm)
      else missing.push(name)
    }
    const ids = new Set(preferred.map(vm => vm.id))
    return { items: [...preferred, ...unique.filter(vm => !ids.has(vm.id))].slice(0, capacity), missing }
  }
  if (selection.status) return { items: unique.filter(vm => vm.status === selection.status).slice(0, capacity), missing: [] }
  if (selection.mode === 'status') {
    // 同组维持接口列表顺序：异常、过渡 / 未知、已关机、运行中。
    const priority = (status: string) => status === 'error' ? 0 : status === 'stopped' ? 2 : status === 'running' ? 3 : 1
    unique.sort((a, b) => priority(a.status) - priority(b.status))
  }
  return { items: unique.slice(0, capacity), missing: [] }
}
