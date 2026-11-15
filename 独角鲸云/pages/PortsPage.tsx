import { List, Section, Text, Button, Image, Picker, HStack, Spacer, useState, useEffect, useRef } from 'scripting'
import { request, errorMessage } from '../api/client'
import { PortMapping } from '../types'
import { FormRow, useTopToast } from '../components'

export default function PortsPage({ token, vmID }: { token: string; vmID: string }) {
  const [ports, setPorts] = useState<PortMapping[]>([])
  const [protocol, setProtocol] = useState('tcp')
  const [host, setHost] = useState('')
  const [guest, setGuest] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useTopToast()
  const lock = useRef(false)
  const path = `/vms/${encodeURIComponent(vmID)}/port-forwards`

  async function task(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    toast.show('正在处理…', true)
    try { await work() } catch (e) { toast.show(errorMessage(e)) }
    finally { lock.current = false; setBusy(false); toast.finish() }
  }
  async function reload() { setPorts(await request<PortMapping[]>(path, token) ?? []) }
  async function refresh() { await task(reload) }
  useEffect(() => { void refresh() }, [])

  async function add() {
    await task(async () => {
      const hostPort = Number(host), guestPort = Number(guest)
      if (!/^\d+$/.test(host) || !/^\d+$/.test(guest) || !Number.isInteger(hostPort) || !Number.isInteger(guestPort) || hostPort < 1 || hostPort > 65535 || guestPort < 1 || guestPort > 65535) throw new Error('端口必须是 1–65535 之间的整数。')
      if (await Dialog.confirm({ title: '添加端口转发', message: `${protocol.toUpperCase()} 宿主 ${hostPort} → 实例 ${guestPort}\n可能将服务暴露到公网，请确认实例防火墙和认证配置。`, cancelLabel: '取消', confirmLabel: '添加' }) !== true) return
      await request(path, token, 'POST', { protocol, host_port: hostPort, guest_port: guestPort, description })
      try { await reload() }
      catch { toast.show('添加已提交，但刷新失败，请手动刷新'); return }
      toast.show('转发已添加')
    })
  }
  async function remove(port: PortMapping) {
    await task(async () => {
      if (await Dialog.confirm({ title: '删除端口转发', message: `删除 ${port.protocol.toUpperCase()} ${port.host_port} → ${port.guest_port}？现有连接可能中断。`, cancelLabel: '取消', confirmLabel: '删除' }) !== true) return
      await request(`${path}/${encodeURIComponent(port.protocol)}/${port.host_port}`, token, 'DELETE')
      try { await reload() }
      catch { toast.show('删除已提交，但刷新失败，请手动刷新'); return }
      toast.show('转发已删除')
    })
  }

  return <List navigationTitle="端口转发" navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden" refreshable={refresh}
    toolbar={{ primaryAction: <Button action={refresh} disabled={busy} tint="label"><Image systemName="arrow.trianglehead.2.clockwise" fontWeight="semibold" /></Button> }}
    toast={toast.props}
  >
    {/* 每行只保留关键三元组，删除改为滑动操作，避免按钮堆叠。 */}
    <Section header={<Text>已有转发 · {ports.length}</Text>} footer={<Text>数据向宿主 Agent 实时获取；离线或超时不代表转发不存在。左滑可删除。</Text>}>
      {ports.map(port => <HStack key={`${port.protocol}-${port.host_port}`} spacing={12} padding={{ vertical: 2 }}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [<Button action={() => remove(port)} tint="systemRed"><Text>删除</Text></Button>],
        }}
      >
        <Text font={12} fontWeight="medium" foregroundStyle="systemBlue" frame={{ width: 38 }}>{port.protocol.toUpperCase()}</Text>
        <Text font={15} monospacedDigit>{port.host_port} → {port.guest_port}</Text>
        <Spacer />
        {port.description ? <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: 110 }}>{port.description}</Text> : null}
      </HStack>)}
      {!ports.length && !busy ? <Text font={14} foregroundStyle="secondaryLabel">暂无转发规则；如读取失败请刷新重试。</Text> : null}
    </Section>
    <Section header={<Text>新增转发</Text>} footer={<Text>可用宿主端口及数量限制以服务端校验为准。</Text>}>
      <Picker title="协议" value={protocol} onChanged={setProtocol}><Text tag="tcp">TCP</Text><Text tag="udp">UDP</Text></Picker>
      <FormRow label="宿主端口" value={host} prompt="1–65535" onChanged={setHost} />
      <FormRow label="实例端口" value={guest} prompt="1–65535" onChanged={setGuest} />
      <FormRow label="说明" value={description} onChanged={setDescription} />
      <Button title="添加转发" action={add} disabled={busy} />
    </Section>
  </List>
}
