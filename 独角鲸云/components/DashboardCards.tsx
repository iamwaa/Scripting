import { HStack, VStack, Text, Image, Spacer, ProgressView } from 'scripting'
import { VM, User, MarketMachine } from '../types'
import { money, dateText, statusText, bytes, regionText } from '../utils'

export function StatusBadge({ status }: { status: string }) {
  const color = status === 'running' ? 'systemGreen' : status === 'error' ? 'systemRed' : status === 'stopped' ? 'secondaryLabel' : 'systemOrange'
  return <HStack spacing={5}>
    <Image systemName="circle.fill" font={6} foregroundStyle={color} />
    <Text font={12} fontWeight="medium" foregroundStyle={color}>{statusText(status)}</Text>
  </HStack>
}

export function BalanceCard({ user }: { user: User | null }) {
  return <VStack alignment="leading" spacing={18} padding={{ vertical: 12 }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
    <HStack><Text font={14} foregroundStyle="secondaryLabel">可用余额 · USD</Text><Spacer /><Image systemName="creditcard" font={20} foregroundStyle="systemBlue" /></HStack>
    <Text font={36} fontWeight="bold" foregroundStyle="label">{money(user?.available_balance)}</Text>
    <HStack spacing={24}>
      <VStack alignment="leading" spacing={6}><Text font={12} foregroundStyle="secondaryLabel">托管余额</Text><Text font={18} fontWeight="semibold" foregroundStyle="systemGreen">{money(user?.escrow_balance)}</Text></VStack>
      <VStack alignment="leading" spacing={6}><Text font={12} foregroundStyle="secondaryLabel">锁定金额</Text><Text font={18} fontWeight="semibold" foregroundStyle="systemOrange">{money(user?.escrow_locked_value)}</Text></VStack>
    </HStack>
  </VStack>
}

export function VMCard({ vm }: { vm: VM }) {
  // 主标题展示母机名称；备注仍保留在副标题，便于区分同母机实例。
  const subtitle = [vm.remark, regionText(vm.machine_region), vm.os_name || vm.type].filter(Boolean).join(' · ')
  return <VStack alignment="leading" spacing={12} padding={{ vertical: 9 }}>
    <HStack spacing={10}>
      <Image systemName="server.rack" font={22} foregroundStyle="systemBlue" />
      <VStack alignment="leading" spacing={4}>
        <Text font={17} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }}>{vm.machine_name || vm.remark || vm.os_name || vm.id.slice(0, 8)}</Text>
        <Text font={11} foregroundStyle="secondaryLabel">{subtitle || '云实例'}</Text>
      </VStack>
      <Spacer />
      <StatusBadge status={vm.status} />
    </HStack>
    {/* 四列等宽；间距收紧并为数值开启抗压缩，避免 1000 Mbps 换行。 */}
    <HStack spacing={10}>
      <Spec label="CPU" value={`${vm.cpu ?? '—'} 核`} />
      <Spec label="内存" value={vm.ram_mb == null ? '—' : `${vm.ram_mb} MB`} />
      <Spec label="存储" value={`${vm.disk_gb ?? '—'} GB`} />
      <Spec label="带宽" value={vm.bandwidth_mbps == null ? '—' : vm.bandwidth_mbps === 0 ? '不限' : `${vm.bandwidth_mbps} Mbps`} />
    </HStack>
    <TrafficRow vm={vm} />
    <Text font={12} foregroundStyle="secondaryLabel">到期 {dateText(vm.expires_at)}</Text>
  </VStack>
}

function TrafficRow({ vm }: { vm: VM }) {
  // 用量为入站 + 出站字节；配额为 0 表示不限流量。
  const used = (vm.monthly_traffic_in ?? 0) + (vm.monthly_traffic_out ?? 0)
  const quotaBytes = (vm.monthly_traffic_gb ?? 0) * 1024 ** 3
  const unlimited = !vm.monthly_traffic_gb
  const ratio = quotaBytes > 0 ? Math.min(1, used / quotaBytes) : 0
  return <VStack alignment="leading" spacing={6} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
    <HStack>
      <Text font={12} foregroundStyle="secondaryLabel">流量</Text>
      <Spacer />
      <Text font={12} foregroundStyle="secondaryLabel">{bytes(used)} / {unlimited ? '不限' : `${vm.monthly_traffic_gb} GB`}</Text>
    </HStack>
    {unlimited ? null : <ProgressView value={ratio} total={1} progressViewStyle="linear" tint={ratio >= 0.9 ? 'systemRed' : 'systemBlue'} />}
  </VStack>
}

export function VMStatusHeader({ items, total }: { items: VM[]; total: number }) {
  // 接口未提供状态统计，只能按当前已加载实例聚合。
  const count = (status: string) => items.filter(vm => vm.status === status).length
  const running = count('running')
  const stopped = count('stopped')
  const error = count('error')
  const other = items.length - running - stopped - error
  // 翻页未满时用「已加载 / 总数」提示统计范围。
  const amount = items.length < total ? `${items.length}/${total} 台` : `${total} 台`
  return <HStack spacing={10} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
    <Text font={13} foregroundStyle="secondaryLabel">实例 {amount}</Text>
    <Spacer />
    <StatusCount label="运行" value={running} color="systemGreen" />
    <StatusCount label="关机" value={stopped} color="secondaryLabel" />
    <StatusCount label="其他" value={other} color="systemOrange" />
    <StatusCount label="异常" value={error} color="systemRed" />
  </HStack>
}

function StatusCount({ label, value, color }: { label: string; value: number; color: 'systemGreen' | 'secondaryLabel' | 'systemOrange' | 'systemRed' }) {
  return <HStack spacing={3}>
    <Text font={11} foregroundStyle="secondaryLabel">{label}</Text>
    <Text font={12} fontWeight="semibold" foregroundStyle={color}>{value}</Text>
  </HStack>
}

function Spec({ label, value }: { label: string; value: string }) {
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
    <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{label}</Text>
    <Text font={14} fontWeight="medium" lineLimit={1} allowsTightening>{value}</Text>
  </VStack>
}

export function MarketMachineCard({ machine }: { machine: MarketMachine }) {
  const available = machine.availablePlans.length > 0
  return <VStack alignment="leading" spacing={12} padding={{ vertical: 9 }}>
    <HStack spacing={10}>
      <Image systemName="server.rack" font={22} foregroundStyle="systemBlue" />
      <VStack alignment="leading" spacing={4}>
        <Text font={17} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }}>{machine.name}</Text>
        <Text font={11} foregroundStyle="secondaryLabel">{[regionText(machine.region), machine.ownerName, machine.vmType].filter(Boolean).join(' · ')}</Text>
      </VStack>
      <Spacer />
      {available ? <VStack alignment="trailing" spacing={3}>
        <Text font={19} fontWeight="bold" foregroundStyle="systemBlue">{money(machine.minPrice)}</Text>
        <Text font={11} foregroundStyle="secondaryLabel">起 / 月</Text>
      </VStack> : null}
    </HStack>
    {/* 可购数量与套餐总数合并展示，售罄母机统一弱化。 */}
    <HStack spacing={6}>
      <Image systemName={available ? 'checkmark.circle.fill' : 'xmark.circle.fill'} font={12} foregroundStyle={available ? 'systemGreen' : 'secondaryLabel'} imageScale="small" />
      <Text font={12} foregroundStyle={available ? 'systemGreen' : 'secondaryLabel'}>
        {available ? `可购 ${machine.availablePlans.length} / ${machine.plans.length} 个套餐` : `已售罄 · 共 ${machine.plans.length} 个套餐`}
      </Text>
      {machine.sla == null ? null : <><Spacer /><Text font={11} foregroundStyle="tertiaryLabel">SLA {machine.sla}%</Text></>}
    </HStack>
    {/* 逐条列出可购套餐：配置含带宽、流量单独一行，字号与配置一致；右侧为月价。 */}
    {machine.availablePlans.length ? <VStack alignment="leading" spacing={8} padding={{ top: 2 }}>
      {machine.availablePlans.map(plan => <HStack key={plan.id} spacing={12} alignment="top">
        <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
          <Text font={13} fontWeight="medium" lineLimit={1} allowsTightening>
            {`${plan.cpu} 核 · ${plan.ram_mb} MB · ${plan.disk_gb} GB · ${plan.bandwidth_mbps === 0 ? '不限带宽' : `${plan.bandwidth_mbps} Mbps`}`}
          </Text>
          <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1} allowsTightening>
            {`${plan.monthly_traffic_gb === 0 ? '不限' : `${plan.monthly_traffic_gb} GB/月`}`}
          </Text>
        </VStack>
        <Text font={15} fontWeight="semibold" foregroundStyle="systemBlue">{money(plan.price_monthly)}</Text>
      </HStack>)}
    </VStack> : <Text font={12} foregroundStyle="tertiaryLabel">暂无在售套餐</Text>}
  </VStack>
}

export function EmptyState({ title, message, symbol = 'tray' }: { title: string; message: string; symbol?: string }) {
  return <VStack spacing={10} padding={{ vertical: 24 }} frame={{ maxWidth: Infinity }}>
    <Image systemName={symbol} font={30} foregroundStyle="systemBlue" />
    <Text font={17} fontWeight="semibold">{title}</Text>
    <Text font={13} foregroundStyle="secondaryLabel" multilineTextAlignment="center" fixedSize={{ horizontal: false, vertical: true }}>{message}</Text>
  </VStack>
}
