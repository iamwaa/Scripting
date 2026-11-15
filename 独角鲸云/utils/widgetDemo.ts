import type { VM } from '../types'
import type { WidgetData } from '../api/widgetVMs'

export function widgetDemoCount(parameter: string, capacity: number): number | undefined {
  const match = /^demo(\d+)?$/i.exec(parameter.trim())
  if (!match) return undefined
  return Math.max(1, Math.min(6, capacity, match[1] == null ? capacity : Number(match[1])))
}

export function widgetDemoData(capacity: number, now = Date.now()): WidgetData {
  const gb = 1024 ** 3
  const afterDays = (days: number) => Math.floor((now + days * 86400000) / 1000)
  const items: VM[] = [
    { id: 'demo-hk', remark: '香港主力', status: 'running', cpu_pct: 18, ram_mb: 1024, ram_used_mb: 350, monthly_traffic_in: 16 * gb, monthly_traffic_out: 8 * gb, monthly_traffic_gb: 500, expires_at: afterDays(25) },
    { id: 'demo-tokyo', remark: '东京备用', status: 'stopped', cpu_pct: 0, ram_mb: 512, ram_used_mb: 0, monthly_traffic_in: 2 * gb, monthly_traffic_out: 0, monthly_traffic_gb: 100, expires_at: afterDays(14) },
    { id: 'demo-la', machine_name: '美西洛杉矶', status: 'error', cpu_pct: 98, ram_mb: 4096, ram_used_mb: 4000, monthly_traffic_in: 495 * gb, monthly_traffic_out: 2 * gb, monthly_traffic_gb: 500, expires_at: afterDays(2) },
    { id: 'demo-sg', remark: '新加坡', status: 'starting', ram_mb: 128, monthly_traffic_gb: 0, expires_at: afterDays(45) },
    { id: 'demo-seoul', remark: '首尔测试', status: 'running', cpu_pct: 4, ram_mb: 2048, ram_used_mb: 1024, monthly_traffic_in: 0, monthly_traffic_out: 0, monthly_traffic_gb: 0, expires_at: 0 },
    { id: 'demo-frankfurt', remark: '法兰克福', status: 'running', cpu_pct: 7, ram_mb: 1024, ram_used_mb: 256, monthly_traffic_in: 5 * gb, monthly_traffic_out: 7 * gb, monthly_traffic_gb: 200 },
  ]
  const selected = items.slice(0, Math.max(1, Math.min(6, capacity)))
  return { items: selected, total: selected.length, label: '演示数据', updatedAt: now }
}
