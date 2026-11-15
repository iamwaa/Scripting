import { NavigationStack, NavigationLink, List, Section, Text, Button, Image, Picker, useState, useRef, useEffect } from 'scripting'
import { request, saveToken, removeToken, errorMessage } from '../api/client'
import { User, Transaction } from '../types'
import { FormRow, InfoRow, useTopToast } from '../components'
import { money, dateText, signedMoney } from '../utils'
import { BalanceCard, EmptyState } from '../components/DashboardCards'
import TransactionsPage from './TransactionsPage'

const RECENT_SIZE = 3

export default function AccountPage({ token, onToken, onClose }: { token: string; onToken: (value: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState('key')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [key, setKey] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [recent, setRecent] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)

  async function guarded(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    toast.show('正在处理…', true)
    try { await work() } catch (e) { toast.show(errorMessage(e)) }
    finally { lock.current = false; setBusy(false); toast.finish() }
  }

  // 主页仅取最近几笔与总数，完整流水放到子页按需加载。
  async function load() {
    if (!token) return
    await guarded(async () => {
      const profile = await request<User>('/user/me', token)
      setUser(profile)
      const result = await request<{ transactions: Transaction[]; total: number }>(`/billing/transactions?page=1&page_size=${RECENT_SIZE}`, token)
      setRecent(result.transactions ?? [])
      setTotal(result.total ?? 0)
    })
  }

  useEffect(() => {
    setUser(null)
    setRecent([])
    setTotal(0)
    if (token) void load()
  }, [token])

  async function login() {
    await guarded(async () => {
      let credential = key.trim().replace(/^Bearer\s+/i, '')
      if (mode === 'password') {
        if (!email.trim() || !password) throw new Error('请输入邮箱和密码。')
        const result = await request<{ token: string }>('/auth/login', '', 'POST', { email: email.trim(), password })
        credential = result.token
      }
      if (!credential) throw new Error('请输入 API Key 或有效 Token。')
      await request<User>('/user/me', credential)
      saveToken(credential)
      setPassword('')
      setKey('')
      onToken(credential)
    })
  }

  async function logout() {
    if (await Dialog.confirm({ title: '退出登录', message: '仅删除本机保存的凭据，不会撤销服务端 API Key 或其他会话。', confirmLabel: '退出', cancelLabel: '取消' }) !== true) return
    await guarded(async () => { removeToken(); onToken(''); toast.show('已退出登录') })
  }

  return <NavigationStack>
    <List
      navigationTitle="账户"
      navigationBarTitleDisplayMode="inline"
      refreshable={load}
      toolbar={{ topBarLeading: <Button action={onClose} tint="systemRed"><Image systemName="xmark" fontWeight="semibold" /></Button> }}
      toast={toast.props}
    >
      {!token ? <Section header={<Text>连接账户</Text>} footer={<Text>凭据仅保存在本机 Keychain；密码不会保存。不要在聊天中发送密钥。</Text>}>
        <Picker title="登录方式" value={mode} onChanged={setMode}>
          <Text tag="key">API Key / Token</Text>
          <Text tag="password">邮箱密码</Text>
        </Picker>
        {mode === 'key' ? <FormRow label="凭据" value={key} secure prompt="API Key 或 JWT" onChanged={setKey} /> : <>
          <FormRow label="邮箱" value={email} prompt="登录邮箱" onChanged={setEmail} />
          <FormRow label="密码" value={password} secure onChanged={setPassword} />
        </>}
        <Button action={login} disabled={busy} buttonStyle="borderedProminent" frame={{ maxWidth: Infinity }}><Text font={16} fontWeight="semibold" frame={{ maxWidth: Infinity }} padding={{ vertical: 5 }}>登录独角鲸云</Text></Button>
      </Section> : <>
        <Section header={<Text>个人资料</Text>}>
          <InfoRow label="用户名" value={user?.display_name || '—'} />
          <InfoRow label="邮箱" value={user?.email || '—'} />
          <Button title="刷新账户及账单" action={load} disabled={busy} />
        </Section>
        <Section><BalanceCard user={user} /></Section>
        <Section header={<Text>最近交易</Text>} footer={<Text>仅显示最近 {recent.length} 笔，完整流水请进入交易记录。</Text>}>
          <NavigationLink title={`交易记录 · 共 ${total} 笔`} destination={<TransactionsPage token={token} />} />
          {recent.map((item, index) => <InfoRow key={item.id || String(index)} label={dateText(item.created_at)} value={signedMoney(item.amount)} />)}
        </Section>
        <Section><Button title="退出登录" action={logout} disabled={busy} tint="systemRed" /></Section>
      </>}
    </List>
  </NavigationStack>
}