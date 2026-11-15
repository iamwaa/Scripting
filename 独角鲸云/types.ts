export interface User {
  id: string
  email: string
  display_name?: string
  available_balance?: number
  escrow_balance?: number
  escrow_locked_value?: number
}

export interface VM {
  id: string
  plan_id?: string
  machine_id?: string
  remark?: string
  status: string
  type?: string
  cpu?: number
  ram_mb?: number
  disk_gb?: number
  os_name?: string
  os_image?: string
  ip?: string
  ip_addresses?: string[]
  machine_entry_host?: string
  machine_entry_ipv6?: string
  machine_name?: string
  machine_region?: string
  cpu_pct?: number
  ram_used_mb?: number
  bandwidth_mbps?: number
  monthly_traffic_gb?: number
  traffic_in_bytes?: number
  traffic_out_bytes?: number
  monthly_traffic_in?: number
  monthly_traffic_out?: number
  price_monthly?: number
  expires_at?: number
  auto_renew?: boolean
  credentials?: { username?: string; password?: string }
  owner_name?: string
}

export interface PublicPlan {
  id: string
  name: string
  description?: string
  cpu: number
  ram_mb: number
  disk_gb: number
  bandwidth_mbps: number
  monthly_traffic_gb: number
  price_monthly: number
  machine_id: string
  machine_name: string
  machine_region: string
  machine_status: string
  machine_description?: string
  machine_vm_type?: string
  machine_sla?: number
  machine_tags?: string[]
  owner_id?: string
  owner_name?: string
  sold_out: boolean
  remaining?: number
  limit_per_user?: boolean
  supported_os?: { id: string; name: string }[]
}

// 公开市场母机：客户端按 machine_id 聚合套餐后展示。
export interface MarketMachine {
  id: string
  name: string
  region: string
  ownerName: string
  vmType?: string
  sla?: number
  description?: string
  tags: string[]
  plans: PublicPlan[]
  availablePlans: PublicPlan[]
  minPrice: number
  maxCpu: number
  maxRamMb: number
  maxDiskGb: number
}

export interface PortMapping {
  protocol: string
  host_port: number
  guest_port: number
  description?: string
}

export interface Transaction {
  id: string
  type: string
  amount: number
  balance_type?: string
  balance_after?: number
  note?: string
  created_at: number
}
