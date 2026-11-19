import { VStack, HStack, Text, Image, Spacer, ProgressView, Divider, Link, Script } from 'scripting'
import { VM } from '../types'
import { WidgetData } from '../api/widgetVMs'
import { statusText } from '../utils'
import { widgetCapacity, widgetInstanceName } from '../utils/widgetSelection'

function statusColor(status: string) {
  return status === 'running' ? 'systemGreen' : status === 'error' ? 'systemRed' : status === 'stopped' ? 'secondaryLabel' : 'systemOrange'
}

function WidgetStatus({ status, size = 11 }: { status: string; size?: number }) {
  return <HStack spacing={4}>
    <Image systemName="circle.fill" font={5} foregroundStyle={statusColor(status)} />
    <Text font={size} foregroundStyle={statusColor(status)} lineLimit={1}>{statusText(status)}</Text>
  </HStack>
}

function percent(value?: number): string {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`
}

function memoryPercent(vm: VM): number | undefined {
  return vm.ram_used_mb != null && vm.ram_mb != null && vm.ram_mb > 0 ? vm.ram_used_mb / vm.ram_mb * 100 : undefined
}

function compactBytes(value: number): string {
  if (value >= 1024 ** 4) return `${Number((value / 1024 ** 4).toFixed(1))}T`
  if (value >= 1024 ** 3) return `${Number((value / 1024 ** 3).toFixed(1))}G`
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)}M`
  return value >= 1024 ? `${Math.round(value / 1024)}K` : `${Math.round(value)}B`
}

function traffic(vm: VM): { text: string; ratio?: number } {
  const used = vm.monthly_traffic_in == null || vm.monthly_traffic_out == null ? undefined : vm.monthly_traffic_in + vm.monthly_traffic_out
  const quota = vm.monthly_traffic_gb
  const limit = quota == null ? '—' : quota === 0 ? '不限' : `${quota}G`
  return {
    text: `${used == null ? '—' : compactBytes(used)} / ${limit}`,
    ratio: used != null && quota != null && quota > 0 ? Math.max(0, Math.min(1, used / (quota * 1024 ** 3))) : undefined,
  }
}

function ExpiryDate({ vm, size = 11 }: { vm: VM; size?: number }) {
  // 用日历符号代替「到期」二字，腾出宽度给日期，图文规则与指标标题一致。
  let text = '—'
  let symbol = 'calendar'
  if (vm.expires_at === 0) {
    text = '不限期'
    symbol = 'infinity'
  } else if (vm.expires_at != null && Number.isFinite(vm.expires_at)) {
    const date = new Date(vm.expires_at < 1e12 ? vm.expires_at * 1000 : vm.expires_at)
    if (Number.isFinite(date.getTime())) {
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}/`
      text = `${year}${date.getMonth() + 1}/${date.getDate()}`
    }
  }
  return <HStack spacing={3} foregroundStyle="secondaryLabel">
    <Image systemName={symbol} font={size - 1} imageScale="small" />
    <Text font={size} monospacedDigit lineLimit={1} minScaleFactor={0.85}>{text}</Text>
  </HStack>
}

function MetricTitle({ title, symbol, size = 11 }: { title: string; symbol: string; size?: number }) {
  return <HStack spacing={3} foregroundStyle="secondaryLabel">
    <Image systemName={symbol} font={size - 1} imageScale="small" frame={{ width: size }} />
    <Text font={size} lineLimit={1}>{title}</Text>
  </HStack>
}

function Metric({ title, symbol, value, size, titleSize }: { title: string; symbol: string; value: string; size: number; titleSize: number }) {
  return <VStack alignment="leading" spacing={1} frame={{ maxWidth: 'infinity', alignment: 'leading' }}>
    <MetricTitle title={title} symbol={symbol} size={titleSize} />
    <Text font={size} fontWeight="semibold" monospacedDigit lineLimit={1} minScaleFactor={0.8} frame={{ height: size + 4, alignment: 'topLeading' }}>{value}</Text>
  </VStack>
}

function UsageMetrics({ vm, size = 20, titleSize = 11 }: { vm: VM; size?: number; titleSize?: number }) {
  return <HStack alignment="top" spacing={12}>
    <Metric title="CPU" symbol="cpu" value={percent(vm.cpu_pct)} size={size} titleSize={titleSize} />
    <Metric title="内存" symbol="memorychip" value={percent(memoryPercent(vm))} size={size} titleSize={titleSize} />
  </HStack>
}

function TrafficUsage({ vm, size, titleSize = 11 }: { vm: VM; size?: number; titleSize?: number }) {
  const usage = traffic(vm)
  const bar = usage.ratio != null ? <ProgressView value={usage.ratio} total={1} progressViewStyle="linear" tint={usage.ratio >= 0.9 ? 'systemRed' : 'systemBlue'} frame={{ height: 3 }} /> : <Spacer frame={{ height: 3 }} />
  if (size != null) return <VStack alignment="leading" spacing={1} frame={{ maxWidth: 'infinity', alignment: 'leading' }}>
    <MetricTitle title="月流量" symbol="arrow.up.arrow.down" size={titleSize} />
    <VStack alignment="leading" spacing={0} frame={{ height: size + 4, alignment: 'topLeading' }}>
      <Text font={size - 7} fontWeight="semibold" monospacedDigit lineLimit={1} minScaleFactor={0.85} frame={{ maxWidth: 'infinity', alignment: 'topTrailing' }}>{usage.text}</Text>
      {bar}
    </VStack>
  </VStack>
  return <VStack alignment="leading" spacing={1} frame={{ maxWidth: 'infinity', alignment: 'leading' }}>
    <MetricTitle title="月流量" symbol="arrow.up.arrow.down" size={titleSize} />
    <Text font={16} fontWeight="semibold" monospacedDigit lineLimit={1} minScaleFactor={0.75} frame={{ maxWidth: 'infinity', alignment: 'trailing' }}>{usage.text}</Text>
    {bar}
  </VStack>
}

function InstanceRow({ vm, large, first }: { vm: VM; large: boolean; first: boolean }) {
  const metricSize = large ? 26 : 20
  const titleSize = large ? 12 : 11
  // 只平移中号第二台，避免增加布局高度而带动分割线或底栏。
  return <VStack alignment="leading" spacing={large ? 7 : 3} padding={{ top: first ? 0 : large ? 8 : 2 }} frame={{ maxWidth: 'infinity', maxHeight: 'infinity', alignment: 'top' }} offset={large || first ? undefined : { x: 0, y: 4 }}>
    <HStack spacing={8}>
      <Text font={large ? 16 : 15} fontWeight="semibold" lineLimit={1} truncationMode="middle" frame={{ maxWidth: 'infinity', alignment: 'leading' }}>{widgetInstanceName(vm)}</Text>
      {/* 顶行顺序：名称、到期、状态。 */}
      <ExpiryDate vm={vm} size={titleSize} />
      <WidgetStatus status={vm.status} size={titleSize} />
    </HStack>
    <HStack alignment="top" spacing={16}>
      <VStack frame={{ width: large ? 164 : 140 }}><UsageMetrics vm={vm} size={metricSize} titleSize={titleSize} /></VStack>
      <TrafficUsage vm={vm} size={metricSize} titleSize={titleSize} />
    </HStack>
  </VStack>
}

function SmallInstance({ vm }: { vm: VM }) {
  return <VStack alignment="leading" spacing={0} frame={{ maxWidth: 'infinity', maxHeight: 'infinity', alignment: 'top' }}>
    <Text font={17} fontWeight="semibold" lineLimit={2} truncationMode="middle">{widgetInstanceName(vm)}</Text>
    <Spacer minLength={1} />
    {/* 小号同一行：左侧到期，右侧状态。 */}
    <HStack spacing={4}><ExpiryDate vm={vm} /><Spacer minLength={0} /><WidgetStatus status={vm.status} /></HStack>
    <Spacer minLength={1} />
    <UsageMetrics vm={vm} size={24} />
    <Spacer minLength={1} />
    <TrafficUsage vm={vm} />
  </VStack>
}

export function widgetEmptyState(data: WidgetData) {
  if (data.title === '请先登录') return { title: '登录账户', message: '打开脚本，在「账户」保存登录凭据。', symbol: 'person.crop.circle', action: '打开脚本', target: 'script' }
  if (data.title === '加载失败') return { title: '暂时无法加载', message: '检查登录与网络后，再刷新小组件。', symbol: 'wifi.slash', action: '检查账户', target: 'script' }
  if (data.label !== '列表顺序' && data.label !== '异常优先' && data.label !== '备注优先' && data.label !== '演示数据') return { title: '筛选无结果', message: `没有「${data.label}」实例，请调整小组件参数。`, symbol: 'line.3.horizontal.decrease.circle', action: '查看实例', target: 'script' }
  return { title: '添加实例', message: '账户还没有云主机，请在控制台添加。', symbol: 'plus.circle', action: '打开控制台', target: 'console' }
}

function EmptyState({ data, small }: { data: WidgetData; small: boolean }) {
  const state = widgetEmptyState(data)
  const content = <VStack alignment={small ? 'center' : 'leading'} spacing={6} frame={{ maxWidth: 'infinity', alignment: small ? 'center' : 'leading' }}>
    <Text font={small ? 15 : 17} fontWeight="semibold">{state.title}</Text>
    <Text font={small ? 10 : 11} foregroundStyle="secondaryLabel" multilineTextAlignment={small ? 'center' : 'leading'} lineLimit={2}>{state.message}</Text>
    <Link url={state.target === 'console' ? 'https://dash.fuckip.me/' : Script.createRunSingleURLScheme('独角鲸云')}>
      <HStack spacing={4}><Text font={11} fontWeight="medium">{state.action}</Text><Image systemName="arrow.up.right" font={9} /></HStack>
    </Link>
  </VStack>
  return <VStack frame={{ maxWidth: 'infinity', maxHeight: 'infinity', alignment: 'center' }}>
    {small ? <VStack spacing={8}><Image systemName={state.symbol} font={22} foregroundStyle="secondaryLabel" />{content}</VStack> : <HStack spacing={16}><Image systemName={state.symbol} font={30} foregroundStyle="secondaryLabel" />{content}</HStack>}
  </VStack>
}

export default function InstanceWidget({ data, family }: { data: WidgetData; family: string }) {
  const small = family === 'systemSmall'
  const large = family === 'systemLarge'
  const capacity = widgetCapacity(family)
  const items = data.items.slice(0, capacity)
  const clock = data.updatedAt ? new Date(data.updatedAt) : null
  const time = clock ? `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}` : ''
  const footer = data.note || (data.label === '演示数据' ? 'Demo' : '')

  return <VStack alignment="leading" spacing={4} padding={14} frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }} widgetBackground="systemBackground" foregroundStyle="label">
    {!items.length ? <EmptyState data={data} small={small} /> : small ? <SmallInstance vm={items[0]} /> : <VStack spacing={0} frame={{ maxWidth: 'infinity', maxHeight: 'infinity', alignment: 'top' }}>
      {Array.from({ length: capacity }, (_, index) => <VStack key={index} spacing={0} frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }}>
        {items[index] ? <InstanceRow vm={items[index]} large={large} first={index === 0} /> : <Spacer frame={{ maxWidth: 'infinity', maxHeight: 'infinity' }} />}
        {index < capacity - 1 ? <Divider hidden={index >= items.length - 1} /> : null}
      </VStack>)}
    </VStack>}
    <HStack spacing={5} frame={{ height: 11 }}>
      <Text font={9} foregroundStyle={data.note ? 'systemOrange' : 'secondaryLabel'} lineLimit={1} frame={{ maxWidth: 'infinity', alignment: 'leading' }}>{footer}</Text>
      {time ? <Text font={9} foregroundStyle="secondaryLabel" monospacedDigit lineLimit={1}>更新 {time}</Text> : null}
    </HStack>
  </VStack>
}
