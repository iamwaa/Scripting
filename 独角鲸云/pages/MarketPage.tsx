import { NavigationStack, NavigationLink, List, Section, Text, Button, Image, Picker, HStack, VStack, Spacer, useState, useEffect, useRef, useMemo } from 'scripting'
import { errorMessage, request } from '../api/client'
import { PublicPlan, MarketMachine } from '../types'
import { InfoRow, LinkNotice, useTopToast } from '../components'
import { money, regionText } from '../utils'
import { MarketMachineCard, EmptyState } from '../components/DashboardCards'

const PAGE_SIZE = 30
type SortKey = 'price' | 'plans' | 'region' | 'name'

const SPEED_TEST_NODES = [
  { id: 'cn-telecom', label: '电信' },
  { id: 'cn-unicom', label: '联通' },
  { id: 'cn-mobile', label: '移动' },
]

type SpeedTestResult = {
  node_id?: string
  success?: boolean
  is_up?: boolean
  avg_rtt?: number
  packet_loss?: number
}

function speedTestText(result?: SpeedTestResult): string {
  if (!result) return '未返回结果'
  if (result.success === false) return '探针测试失败'

  const parts: string[] = []
  if (result.is_up === false) parts.push('探针未收到响应')
  else if (typeof result.avg_rtt === 'number' && Number.isFinite(result.avg_rtt) && result.avg_rtt >= 0) {
    parts.push(`平均 ${result.avg_rtt.toFixed(1)} ms`)
  }
  if (typeof result.packet_loss === 'number' && Number.isFinite(result.packet_loss) && result.packet_loss >= 0 && result.packet_loss <= 100) {
    parts.push(`丢包 ${result.packet_loss}%`)
  }
  return parts.join(' · ') || '未返回指标'
}

// 一次加载全部套餐后在客户端按机器聚合，避免多次请求公开接口。
function groupMachines(plans: PublicPlan[]): MarketMachine[] {
  const groups = new Map<string, PublicPlan[]>()
  for (const plan of plans) {
    const list = groups.get(plan.machine_id)
    if (list) list.push(plan)
    else groups.set(plan.machine_id, [plan])
  }
  const result: MarketMachine[] = []
  for (const [id, list] of groups) {
    const head = list[0]
    const available = list.filter(plan => !plan.sold_out)
    // 可购套餐按价格升序，首条即起价套餐。
    available.sort((a, b) => a.price_monthly - b.price_monthly)
    result.push({
      id,
      name: head.machine_name || '未命名母机',
      region: head.machine_region || '',
      ownerName: head.owner_name || '',
      vmType: head.machine_vm_type,
      sla: head.machine_sla,
      description: head.machine_description,
      tags: head.machine_tags ?? [],
      plans: list,
      availablePlans: available,
      minPrice: (available[0] ?? list.reduce((min, plan) => plan.price_monthly < min.price_monthly ? plan : min, list[0])).price_monthly,
      maxCpu: Math.max(...list.map(plan => plan.cpu)),
      maxRamMb: Math.max(...list.map(plan => plan.ram_mb)),
      maxDiskGb: Math.max(...list.map(plan => plan.disk_gb)),
    })
  }
  return result
}

function MachineDetail({ machine }: { machine: MarketMachine }) {
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<SpeedTestResult[] | null>(null)
  const testLock = useRef(false)
  const toast = useTopToast()
  // 排序后售罄套餐统一排在后，避免可用套餐被埋没。
  const plans = [...machine.availablePlans, ...machine.plans.filter(plan => plan.sold_out)]
  const description = machine.description?.trim()

  async function testSpeed() {
    if (testLock.current) return
    testLock.current = true
    setTesting(true)
    setTestResults(null)
    toast.show('官方探针正在测试…', true)
    try {
      const path = `/machines/${encodeURIComponent(machine.id)}/test-speed`
      const nodes = SPEED_TEST_NODES.map(node => node.id)
      const results = await request<SpeedTestResult[]>(path, '', 'POST', { nodes })
      if (!Array.isArray(results)) throw new Error('官方测速返回格式异常')
      setTestResults(results)
    } catch (e) {
      toast.show(`官方测速未完成：${errorMessage(e)}`)
    } finally {
      testLock.current = false
      setTesting(false)
      toast.finish()
    }
  }

  return <List navigationTitle={machine.name} navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden" toast={toast.props}>
    {/* 头部只显示归属与保障，母机卡片里已有的起价、可购数不重复。 */}
    <Section>
      <InfoRow label="商家" value={machine.ownerName || '—'} />
      <InfoRow label="地区" value={regionText(machine.region) || '—'} />
      <InfoRow label="虚拟化" value={machine.vmType || '—'} />
      <InfoRow label="SLA" value={machine.sla == null ? '—' : `${machine.sla}%`} />
      {description ? <LinkNotice message={description} /> : null}
    </Section>
    <Section footer={<Text>由平台的电信、联通、移动探针发起 ICMP Ping。</Text>}>
      <Button title={testing ? '正在测试三网…' : '三网测试'} action={() => void testSpeed()} disabled={testing} />
      {testResults ? SPEED_TEST_NODES.map(node => <InfoRow
        key={node.id}
        label={node.label}
        value={speedTestText(testResults.find(result => result?.node_id === node.id))}
      />) : null}
    </Section>
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">套餐 {machine.availablePlans.length} 可购 / 共 {plans.length}</Text>}>
      {plans.map(plan => <NavigationLink key={plan.id} destination={<PlanDetail plan={plan} />}>
        <PlanRow plan={plan} />
      </NavigationLink>)}
    </Section>
  </List>
}

// 详情页的行只保留单行关键信息，避免与母机卡片重复铺满整行卡片。
function PlanRow({ plan }: { plan: PublicPlan }) {
  return <HStack spacing={12} alignment="top" padding={{ vertical: 2 }}>
    <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
      <Text font={15} fontWeight="medium" lineLimit={1}>{plan.name}</Text>
      <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1} allowsTightening>
        {`${plan.cpu} 核 · ${plan.ram_mb} MB · ${plan.disk_gb} GB · ${plan.bandwidth_mbps === 0 ? '不限带宽' : `${plan.bandwidth_mbps} Mbps`} · ${plan.monthly_traffic_gb === 0 ? '不限流量' : `${plan.monthly_traffic_gb} GB/月`}`}
      </Text>
    </VStack>
    <VStack alignment="trailing" spacing={4}>
      <Text font={15} fontWeight="semibold" foregroundStyle={plan.sold_out ? 'secondaryLabel' : 'systemBlue'}>{money(plan.price_monthly)}</Text>
      <Text font={11} foregroundStyle={plan.sold_out ? 'systemRed' : 'systemGreen'}>{plan.sold_out ? '已售罄' : '可购'}</Text>
    </VStack>
  </HStack>
}

function PlanDetail({ plan }: { plan: PublicPlan }) {
  const osText = plan.supported_os?.length ? plan.supported_os.map(os => os.name).join('、') : '—'
  return <List navigationTitle={plan.name} navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden">
    {/* 价格与介绍合并到顶部：先看价格与可购状态，再看说明；配置与网络分两段。 */}
    <Section>
      <HStack spacing={12} frame={{ maxWidth: Infinity }}>
        <Text font={30} fontWeight="bold" foregroundStyle={plan.sold_out ? 'secondaryLabel' : 'systemBlue'}>{money(plan.price_monthly)}</Text>
        <Text font={12} foregroundStyle="secondaryLabel" padding={{ top: 12 }}>USD / 月</Text>
        <Spacer />
        <Text font={12} fontWeight="medium" foregroundStyle={plan.sold_out ? 'systemRed' : 'systemGreen'} padding={{ top: 12 }}>{plan.sold_out ? '已售罄' : '可购'}</Text>
      </HStack>
      <InfoRow label="库存" value={plan.sold_out ? '无' : !plan.remaining ? '不限' : `剩余 ${plan.remaining}`} />
      {plan.limit_per_user ? <InfoRow label="限购" value="每人限 1 台" /> : null}
      {plan.description ? <LinkNotice message={plan.description} /> : null}
    </Section>
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">配置</Text>}>
      <InfoRow label="CPU" value={`${plan.cpu} 核`} />
      <InfoRow label="内存" value={`${plan.ram_mb} MB`} />
      <InfoRow label="硬盘" value={`${plan.disk_gb} GB`} />
    </Section>
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">网络</Text>}>
      <InfoRow label="带宽" value={plan.bandwidth_mbps === 0 ? '不限' : `${plan.bandwidth_mbps} Mbps`} />
      <InfoRow label="月流量" value={plan.monthly_traffic_gb === 0 ? '不限' : `${plan.monthly_traffic_gb} GB`} />
    </Section>
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">可用系统</Text>}>
      <Text font={14} foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>{osText}</Text>
    </Section>
  </List>
}

export default function MarketPage({ onClose }: { onClose: () => void }) {
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('ALL')
  const [sort, setSort] = useState('price')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)

  // 公开接口限 10 次/分钟，仅挂载时拉取一次，刷新由工具栏手动触发。
  async function load() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    toast.show('正在加载市场…', true)
    try {
      const result = await request<{ plans: PublicPlan[]; total: number }>('/plans')
      setPlans(result.plans ?? [])
      setVisible(PAGE_SIZE)
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      setError(text)
      toast.show(text)
    } finally {
      lock.current = false
      setBusy(false)
      toast.finish()
    }
  }

  useEffect(() => { void load() }, [])

  const machines = useMemo(() => groupMachines(plans), [plans])

  // 地区按出现次数降序，保证常用地区排在筛选前列。
  const regions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const machine of machines) {
      if (machine.region) counts.set(machine.region, (counts.get(machine.region) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code)
  }, [machines])

  const keyword = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    const matched = machines.filter(machine => {
      if (onlyAvailable && !machine.availablePlans.length) return false
      if (region !== 'ALL' && machine.region !== region) return false
      if (!keyword) return true
      return [machine.name, machine.region, machine.ownerName, ...machine.plans.map(plan => plan.name)]
        .some(value => value.toLowerCase().includes(keyword))
    })
    const sorted = [...matched]
    // 售罄母机统一排在最后，其余按所选规则排序。
    const soldOut = (machine: MarketMachine) => machine.availablePlans.length ? 0 : 1
    sorted.sort((a, b) => {
      const diff = soldOut(a) - soldOut(b)
      if (diff !== 0) return diff
      switch (sort) {
        case 'plans': return b.availablePlans.length - a.availablePlans.length
        case 'region': return a.region.localeCompare(b.region) || a.name.localeCompare(b.name)
        case 'name': return a.name.localeCompare(b.name)
        default: return a.minPrice - b.minPrice
      }
    })
    return sorted
  }, [machines, keyword, region, sort, onlyAvailable])

  const shown = filtered.slice(0, visible)
  const availableCount = filtered.filter(machine => machine.availablePlans.length > 0).length

  // 任一筛选变更后重置分页，避免停留在旧的展示长度。
  function resetPage() {
    setVisible(PAGE_SIZE)
  }

  return <NavigationStack>
    <List
      navigationTitle="套餐市场"
      navigationBarTitleDisplayMode="inline"
      searchable={{ value: search, onChanged: value => { setSearch(value); setVisible(PAGE_SIZE) }, placement: 'navigationBarDrawerAlwaysDisplay', prompt: '搜索母机 / 商家 / 套餐' }}
      toolbar={{
        primaryAction: <Button action={() => void load()} disabled={busy} tint="label"><Image systemName="arrow.trianglehead.2.clockwise" fontWeight="semibold" /></Button>,
        topBarLeading: <Button action={onClose} tint="systemRed"><Image systemName="xmark" fontWeight="semibold" /></Button>,
      }}
      toast={toast.props}
    >
      <Section>
        <Picker
          value={region}
          onChanged={(value: string) => { setRegion(value); resetPage() }}
          pickerStyle="menu"
          title="地区"
          systemImage="globe"
        >
          <Text tag="ALL">全部地区</Text>
          {regions.map(code => <Text tag={code}>{regionText(code)}</Text>)}
        </Picker>
        <Picker
          value={sort}
          onChanged={(value: string) => { setSort(value as SortKey); resetPage() }}
          pickerStyle="menu"
          title="排序"
          systemImage="arrow.up.arrow.down"
        >
          <Text tag="price">起价从低到高</Text>
          <Text tag="plans">可购套餐从多到少</Text>
          <Text tag="region">按地区</Text>
          <Text tag="name">按名称</Text>
        </Picker>
        <Picker
          value={onlyAvailable ? 'yes' : 'no'}
          onChanged={(value: string) => { setOnlyAvailable(value === 'yes'); resetPage() }}
          pickerStyle="menu"
          title="可购状态"
          systemImage="checkmark.seal"
        >
          <Text tag="no">全部母机</Text>
          <Text tag="yes">仅看可购</Text>
        </Picker>
      </Section>
      {error ? <Section><Text font={14} foregroundStyle="systemRed">{error}</Text></Section> : null}
      <Section header={<Text font={13} foregroundStyle="secondaryLabel">{`${filtered.length} 台母机 · 可购 ${availableCount} 台 · 已显示 ${shown.length}`}</Text>}>
        {shown.map(machine => <NavigationLink key={machine.id} destination={<MachineDetail machine={machine} />}>
          <MarketMachineCard machine={machine} />
        </NavigationLink>)}
        {!busy && !filtered.length ? <EmptyState title={error ? '市场暂不可用' : '未找到母机'} message={error ? '请稍后点击右上角刷新重试。' : '试试调整地区、可购筛选或搜索关键词。'} symbol="square.grid.2x2" /> : null}
        {shown.length < filtered.length ? <Button title={`再显示 ${Math.min(PAGE_SIZE, filtered.length - shown.length)} 台`} action={() => setVisible(visible + PAGE_SIZE)} /> : null}
      </Section>
    </List>
  </NavigationStack>
}