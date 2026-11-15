import { NavigationStack, NavigationLink, List, Section, Text, Button, Image, useState, useEffect, useRef } from 'scripting'
import { request, errorMessage } from '../api/client'
import { VM } from '../types'
import { useTopToast } from '../components'
import { VMCard, EmptyState, VMStatusHeader } from '../components/DashboardCards'
import VMDetailPage from './VMDetailPage'

export default function VMPage({ token, onClose }: { token: string; onClose: () => void }) {
  const [items, setItems] = useState<VM[]>([])
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  // 防抖等待与请求期间都算作待定，避免闪烁空状态。
  const [pending, setPending] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)
  const generation = useRef(0)

  async function load(next = 1, term = keyword) {
    if (!token || lock.current) return
    const version = generation.current
    lock.current = true
    setPending(true)
    toast.show('正在加载…', true)
    setError('')
    try {
      const result = await request<{ vms: VM[]; total: number }>(`/vms?page=${next}&page_size=20&search=${encodeURIComponent(term.trim())}`, token)
      if (version !== generation.current) return
      setItems(next === 1 ? result.vms ?? [] : [...items, ...(result.vms ?? [])])
      setTotal(result.total ?? 0)
      setPage(next)
    } catch (e) { if (version === generation.current) setError(errorMessage(e)) }
    finally { if (version === generation.current) { lock.current = false; setPending(false); toast.finish() } }
  }

  // 关键词变化后防抖请求，避免逐字触发接口；切词时丢弃旧响应。
  useEffect(() => {
    generation.current += 1
    lock.current = false
    setItems([])
    setTotal(0)
    setPage(0)
    setError('')
    setPending(Boolean(token))
    if (!token) return
    const timer = setTimeout(() => { void load(1, keyword) }, 350)
    return () => clearTimeout(timer)
  }, [token, keyword])

  return <NavigationStack>
    <List
      navigationTitle="我的实例"
      navigationBarTitleDisplayMode="inline"
      refreshable={() => load()}
      searchable={token ? { value: keyword, onChanged: setKeyword, placement: 'navigationBarDrawerAlwaysDisplay', prompt: '搜索实例备注' } : undefined}
      toolbar={{
        primaryAction: <Button action={() => load()} disabled={pending || !token} tint="label"><Image systemName="arrow.trianglehead.2.clockwise" fontWeight="semibold" /></Button>,
        topBarLeading: <Button action={onClose} tint="systemRed"><Image systemName="xmark" fontWeight="semibold" /></Button>,
      }}
      toast={toast.props}
    >
      {!token ? <Section><EmptyState title="连接您的云端" message="前往「账户」登录独角鲸云，即可查看和管理实例。套餐市场可免登录浏览。" symbol="cloud" /></Section> : <>
        {error ? <Section><Text font={14} foregroundStyle="systemRed">{error}</Text></Section> : null}
        <Section header={<VMStatusHeader items={items} total={total} />}>
          {items.map(vm => <NavigationLink key={vm.id} destination={<VMDetailPage token={token} initial={vm} />}>
            <VMCard vm={vm} />
          </NavigationLink>)}
          {!items.length && !pending ? <EmptyState title={error ? '实例暂不可用' : keyword.trim() ? '未找到匹配实例' : '暂无实例'} message={error ? '请稍后刷新重试。' : keyword.trim() ? '试试其他备注关键词，或清空搜索。' : '刷新实例列表以获取最新状态。'} symbol="server.rack" /> : null}
          {items.length < total ? <Button title="加载更多主机" action={() => load(page + 1)} disabled={pending} /> : null}
        </Section>
      </>}
    </List>
  </NavigationStack>
}
