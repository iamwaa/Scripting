import { List, Section, Text, Button, Picker, HStack, VStack, Image, Spacer, useState, useEffect, useRef, useMemo } from 'scripting'
import { request, errorMessage } from '../api/client'
import { Transaction } from '../types'
import { useTopToast } from '../components'
import { money, dateText, signedMoney } from '../utils'
import { EmptyState } from '../components/DashboardCards'

const PAGE_SIZE = 20

// 与服务端交易类型一一对应，未知类型回退原始文本。
const TYPE_LABELS: Record<string, string> = {
  topup: '账户充值',
  purchase: '购买实例',
  renew: '实例续费',
  escrow_renew: '托管续费',
  refund: '实例退款',
  escrow_in: '托管收入',
  escrow_deduct: '托管扣费',
  withdrawal: '余额提现',
  market_sell: '二手卖出',
  market_buy: '二手买入',
  ip_rent: '独立 IP 租用',
  ip_renew: '独立 IP 续费',
  compensation: '服务补偿',
}

const TYPE_STYLES: Record<string, { color: 'systemGreen' | 'systemRed' | 'systemOrange' | 'systemBlue' | 'secondaryLabel'; symbol: string }> = {
  topup: { color: 'systemGreen', symbol: 'arrow.down.circle' },
  market_sell: { color: 'systemGreen', symbol: 'tag' },
  escrow_in: { color: 'systemGreen', symbol: 'tray.and.arrow.down' },
  refund: { color: 'systemGreen', symbol: 'arrow.uturn.backward.circle' },
  compensation: { color: 'systemGreen', symbol: 'gift' },
  purchase: { color: 'systemRed', symbol: 'cart' },
  market_buy: { color: 'systemRed', symbol: 'tag' },
  renew: { color: 'systemOrange', symbol: 'arrow.clockwise.circle' },
  escrow_renew: { color: 'systemOrange', symbol: 'arrow.clockwise.circle' },
  escrow_deduct: { color: 'systemOrange', symbol: 'tray.and.arrow.up' },
  withdrawal: { color: 'systemBlue', symbol: 'arrow.up.circle' },
  ip_rent: { color: 'systemBlue', symbol: 'network' },
  ip_renew: { color: 'systemBlue', symbol: 'network' },
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function typeStyle(type: string) {
  return TYPE_STYLES[type] ?? { color: 'secondaryLabel' as const, symbol: 'circle.dashed' }
}

// 金额为有符号值：正数为入账，负数为出账。
function amountText(amount: number): string {
  return signedMoney(amount)
}

function TransactionRow({ item }: { item: Transaction }) {
  const style = typeStyle(item.type)
  const positive = (item.amount ?? 0) > 0
  return <HStack spacing={12} padding={{ vertical: 8 }} alignment="top">
    <Image systemName={style.symbol} font={20} foregroundStyle={style.color} />
    <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
      <Text font={15} fontWeight="medium" lineLimit={1}>{typeLabel(item.type)}</Text>
      <Text font={11} foregroundStyle="secondaryLabel" lineLimit={2} fixedSize={{ horizontal: false, vertical: true }}>{item.note || '无备注'}</Text>
      <Text font={11} foregroundStyle="tertiaryLabel">{dateText(item.created_at)} · {item.balance_type === 'escrow' ? '托管余额' : item.balance_type === 'available' ? '可用余额' : '—'}</Text>
    </VStack>
    <VStack alignment="trailing" spacing={4}>
      <Text font={15} fontWeight="semibold" foregroundStyle={positive ? 'systemGreen' : (item.amount ?? 0) < 0 ? 'systemRed' : 'secondaryLabel'}>{amountText(item.amount ?? 0)}</Text>
      <Text font={11} foregroundStyle="secondaryLabel">余额 {money(item.balance_after)}</Text>
    </VStack>
  </HStack>
}

export default function TransactionsPage({ token }: { token: string }) {
  const [records, setRecords] = useState<Transaction[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)
  const generation = useRef(0)

  async function load(next = 1) {
    if (lock.current) return
    const version = generation.current
    lock.current = true
    setBusy(true)
    setError('')
    if (next === 1) toast.show('正在加载交易记录…', true)
    try {
      const query = filter === 'all' ? '' : `&balance_type=${filter}`
      const result = await request<{ transactions: Transaction[]; total: number }>(`/billing/transactions?page=${next}&page_size=${PAGE_SIZE}${query}`, token)
      if (version !== generation.current) return
      setRecords(next === 1 ? result.transactions ?? [] : [...records, ...(result.transactions ?? [])])
      setTotal(result.total ?? 0)
      setPage(next)
    } catch (e) {
      if (version !== generation.current) return
      setError(errorMessage(e))
      toast.show(errorMessage(e))
    }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); toast.finish() } }
  }

  // 切换账户类型时重置列表并重新拉取。
  useEffect(() => {
    generation.current += 1
    lock.current = false
    setRecords([])
    setTotal(0)
    setPage(0)
    setError('')
    void load(1)
  }, [filter])

  // 汇总当前已加载记录的净额，便于快速核对。
  const summary = useMemo(() => records.reduce((sum, item) => sum + (item.amount ?? 0), 0), [records])

  return <List
    navigationTitle="交易记录"
    navigationBarTitleDisplayMode="inline"
    tabBarVisibility="hidden"
    refreshable={() => load()}
    toolbar={{ primaryAction: <Button action={() => load()} disabled={busy} tint="label"><Image systemName="arrow.trianglehead.2.clockwise" fontWeight="semibold" /></Button> }}
    toast={toast.props}
  >
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">汇总</Text>}>
      <HStack spacing={12} frame={{ maxWidth: Infinity, alignment: 'leading' }}>
        {/* 无记录时不把未知汇总成 0。 */}
        <Text font={26} fontWeight="bold" foregroundStyle={!records.length ? 'secondaryLabel' : summary >= 0 ? 'systemGreen' : 'systemRed'}>{records.length ? amountText(summary) : '—'}</Text>
        <Spacer />
        <VStack alignment="trailing" spacing={3}>
          <Text font={12} foregroundStyle="secondaryLabel">共 {total} 笔</Text>
          <Text font={11} foregroundStyle="tertiaryLabel">已加载 {records.length} 笔</Text>
        </VStack>
      </HStack>
      <Picker value={filter} onChanged={setFilter} pickerStyle="segmented" label={<Text>账户</Text>}>
        <Text tag="all">全部</Text>
        <Text tag="available">可用余额</Text>
        <Text tag="escrow">托管余额</Text>
      </Picker>
    </Section>
    {error ? <Section><Text font={14} foregroundStyle="systemRed">{error}</Text></Section> : null}
    <Section header={<Text font={13} foregroundStyle="secondaryLabel">明细</Text>} footer={<Text>金额为账面变动额，正数为入账、负数为出账。</Text>}>
      {records.map((item, index) => <TransactionRow key={item.id || String(index)} item={item} />)}
      {!records.length && !busy ? <EmptyState title={error ? '账单暂不可用' : '暂无交易'} message={error ? '请稍后刷新重试，现有余额不会因此改变。' : '完成充值或购买后，流水会显示在这里。'} symbol="doc.text" /> : null}
      {records.length < total ? <Button title="加载更多交易" action={() => load(page + 1)} disabled={busy} /> : null}
    </Section>
  </List>
}