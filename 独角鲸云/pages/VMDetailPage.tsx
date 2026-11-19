import { List, Section, Text, Button, NavigationLink, HStack, VStack, Image, Spacer, ProgressView, useState, useRef } from 'scripting'
import { request, errorMessage } from '../api/client'
import { VM, PublicPlan } from '../types'
import { InfoRow, LinkNotice, useTopToast } from '../components'
import { money, dateText, bytes, regionText } from '../utils'
import PortsPage from './PortsPage'
import { StatusBadge } from '../components/DashboardCards'

export default function VMDetailPage({ token, initial }: { token: string; initial: VM }) {
  const [vm, setVM] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [machineDescription, setMachineDescription] = useState<string | null>(null)
  const [descriptionUnavailable, setDescriptionUnavailable] = useState(false)
  const [descriptionBusy, setDescriptionBusy] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)
  const appeared = useRef(false)
  const descriptionLock = useRef(false)
  const path = `/vms/${encodeURIComponent(initial.id)}`

  async function task(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    toast.show('正在处理…', true)
    try { await work() } catch (e) { toast.show(errorMessage(e)) }
    finally { lock.current = false; setBusy(false); toast.finish() }
  }

  async function loadMachineDescription(latest: VM) {
    if (descriptionLock.current) return
    descriptionLock.current = true
    setDescriptionBusy(true)
    // 简介独立读取，不占用实例操作锁，也不拉取整个市场。
    try {
      let description: string | undefined
      if (latest.plan_id) {
        const plan = await request<PublicPlan>(`/plans/${encodeURIComponent(latest.plan_id)}`)
        description = plan.machine_description
      } else if (latest.machine_id) {
        const machine = await request<{ description?: string }>(`/machines/${encodeURIComponent(latest.machine_id)}/public`)
        description = machine.description
      } else {
        setDescriptionUnavailable(true)
        return
      }
      setMachineDescription(description?.trim() || '')
      setDescriptionUnavailable(false)
    } catch {
      setDescriptionUnavailable(true)
    } finally {
      descriptionLock.current = false
      setDescriptionBusy(false)
    }
  }

  async function refresh() {
    await task(async () => {
      const latest = await request<VM>(path, token)
      setVM(latest)
      void loadMachineDescription(latest)
    })
  }

  async function operation(action: 'start' | 'stop' | 'restart' | 'renew' | 'auto-renew') {
    await task(async () => {
      const labels = { start: '开机', stop: '关机', restart: '重启', renew: '续费', 'auto-renew': vm.auto_renew ? '关闭自动续费' : '开启自动续费' }
      let detail = `${labels[action]}「${vm.remark || vm.id.slice(0, 8)}」？`
      if (action === 'stop' || action === 'restart') detail += '\n这会中断当前服务和连接。'
      if (action === 'renew') detail += `\n月价快照：${money(vm.price_monthly)}。文档未明确单次续费周期与最终扣费金额，按服务端规则扣款；不确定时请取消并在官网确认。`
      if (action === 'auto-renew' && !vm.auto_renew) detail += '\n到期时服务端可能自动扣款，具体周期和扣费规则以平台为准。'
      const confirmed = await Dialog.confirm({ title: labels[action], message: detail, confirmLabel: '确认提交', cancelLabel: '取消' })
      if (confirmed !== true) return
      const body = action === 'auto-renew' ? { auto_renew: !vm.auto_renew } : action === 'stop' ? { force: false } : undefined
      await request(path + '/' + action, token, action === 'auto-renew' ? 'PATCH' : 'POST', body)
      try { setVM(await request<VM>(path, token)) }
      catch { toast.show('操作已提交，但刷新失败，请手动刷新'); return }
      toast.show('请求已提交，请勿重复操作')
    })
  }

  async function editRemark() {
    await task(async () => {
      const remark = await Dialog.prompt({ title: '修改备注', defaultValue: vm.remark || '', cancelLabel: '取消', confirmLabel: '保存' })
      if (typeof remark !== 'string') return
      await request(path + '/remark', token, 'PATCH', { remark })
      setVM({ ...vm, remark })
      toast.show('备注已保存')
    })
  }

  const used = (vm.monthly_traffic_in ?? 0) + (vm.monthly_traffic_out ?? 0)
  const quotaBytes = (vm.monthly_traffic_gb ?? 0) * 1024 ** 3
  const trafficRatio = quotaBytes > 0 ? Math.min(1, used / quotaBytes) : 0
  const cpuText = vm.cpu_pct == null ? `${vm.cpu ?? '—'} 核` : `${vm.cpu ?? '—'} 核 · ${vm.cpu_pct.toFixed(1)}%`
  const ramText = vm.ram_used_mb == null ? `${vm.ram_mb ?? '—'} MB` : `${vm.ram_mb ?? '—'} MB · 已用 ${vm.ram_used_mb} MB`
  const bandwidthText = vm.bandwidth_mbps == null ? '—' : vm.bandwidth_mbps === 0 ? '不限' : `${vm.bandwidth_mbps} Mbps`
  const machineName = vm.machine_name?.trim() || ''
  const instanceName = vm.remark?.trim() || machineName || '未命名实例'
  // 标题已是母机名时不再重复；设备注时展示备注标题 + 地区 · 母机名。
  const locationText = [regionText(vm.machine_region), vm.remark?.trim() ? machineName : ''].filter(Boolean).join(' · ')
  const systemText = [vm.os_name || vm.os_image, vm.type].filter(Boolean).join(' · ') || '—'

  return <List navigationTitle={vm.remark || vm.machine_name || '主机详情'} navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden" refreshable={refresh}
    toolbar={{ primaryAction: <Button action={refresh} disabled={busy} tint="label"><Image systemName="arrow.trianglehead.2.clockwise" fontWeight="semibold" /></Button> }}
    toast={toast.props}
    onAppear={() => {
      // 仅在详情真正出现后首次加载，避免列表提前挂载目标页时逐台请求。
      if (appeared.current) return
      appeared.current = true
      void refresh()
    }}
  >
    <Section>
      <VStack alignment="leading" spacing={10} padding={{ vertical: 4 }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
        <HStack spacing={10} alignment="top">
          <Image systemName="server.rack" font={22} foregroundStyle="systemBlue" frame={{ width: 24, height: 28 }} />
          <Text font={20} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>{instanceName}</Text>
          <Button action={editRemark} disabled={busy} buttonStyle="borderless" tint="systemBlue" accessibilityLabel="修改备注">
            <Image systemName="pencil" font={15} frame={{ width: 28, height: 28 }} />
          </Button>
        </HStack>
        <HStack spacing={12} alignment="top" padding={{ leading: 34 }}>
          {locationText ? <Text font={13} foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>{locationText}</Text> : <Spacer />}
          <StatusBadge status={vm.status} />
        </HStack>
      </VStack>
      <InfoRow label="系统" value={systemText} />
      <InfoRow label="商家" value={vm.owner_name || '—'} />
      <VStack alignment="leading" spacing={5} padding={{ vertical: 2 }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
        <Text font={12} foregroundStyle="secondaryLabel">实例 ID</Text>
        <Text font={13} foregroundStyle="secondaryLabel" textSelection={true} fixedSize={{ horizontal: false, vertical: true }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>{vm.id}</Text>
      </VStack>
      {machineDescription ? <VStack alignment="leading" spacing={6} padding={{ vertical: 2 }} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
        <Text font={12} foregroundStyle="secondaryLabel">母机简介</Text>
        <LinkNotice message={machineDescription} />
        {descriptionUnavailable ? <Button title="重试加载简介" action={() => loadMachineDescription(vm)} disabled={descriptionBusy} /> : null}
      </VStack> : null}
    </Section>
    <Section header={<Text>配置与用量</Text>} footer={<Text>用量来自最近一次接口返回，非实时监控。</Text>}>
      <InfoRow label="CPU" value={cpuText} />
      <InfoRow label="内存" value={ramText} />
      <InfoRow label="存储" value={`${vm.disk_gb ?? '—'} GB`} />
      <InfoRow label="带宽" value={bandwidthText} />
      <VStack alignment="leading" spacing={6} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
        <HStack>
          <Text font={15} foregroundStyle="secondaryLabel">流量</Text>
          <Spacer />
          <Text font={15}>{bytes(used)} / {vm.monthly_traffic_gb ? `${vm.monthly_traffic_gb} GB` : '不限'}</Text>
        </HStack>
        {vm.monthly_traffic_gb ? <ProgressView value={trafficRatio} total={1} progressViewStyle="linear" tint={trafficRatio >= 0.9 ? 'systemRed' : 'systemBlue'} /> : null}
      </VStack>
    </Section>
    <Section header={<Text>网络与登录</Text>}>
      <InfoRow label="IP 地址" value={vm.ip_addresses?.join('\n') || '—'} />
      {vm.ip ? <InfoRow label="内网地址" value={vm.ip} /> : null}
      {vm.machine_entry_host ? <InfoRow label="入口" value={vm.machine_entry_host} /> : null}
      {vm.machine_entry_ipv6 ? <InfoRow label="IPv6 入口" value={vm.machine_entry_ipv6} /> : null}
      <InfoRow label="用户名" value={vm.credentials?.username || '—'} />
      {showPassword ? <InfoRow label="密码" value={vm.credentials?.password || '未返回密码'} /> : null}
      <Button title={showPassword ? '隐藏密码' : '显示实例密码'} action={() => setShowPassword(!showPassword)} />
      <NavigationLink title="端口转发" destination={<PortsPage token={token} vmID={vm.id} />} />
    </Section>
    <Section header={<Text>电源</Text>}>
      <Button title="开机" action={() => operation('start')} disabled={busy || vm.status !== 'stopped'} />
      <Button title="关机" action={() => operation('stop')} disabled={busy || vm.status !== 'running'} tint="red" />
      <Button title="重启" action={() => operation('restart')} disabled={busy || vm.status !== 'running'} tint="systemOrange" />
    </Section>
    <Section header={<Text>续费</Text>}>
      <InfoRow label="到期" value={dateText(vm.expires_at)} />
      <InfoRow label="月价" value={`${money(vm.price_monthly)} · 自动续费${vm.auto_renew ? '已开启' : '已关闭'}`} />
      <Button title="提交一次续费" action={() => operation('renew')} disabled={busy} />
      <Button title={vm.auto_renew ? '关闭自动续费' : '开启自动续费'} action={() => operation('auto-renew')} disabled={busy} />
    </Section>
  </List>
}