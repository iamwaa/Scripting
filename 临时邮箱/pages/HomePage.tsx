import {
  Navigation,
  List,
  Text,
  Button,
  NavigationLink,
  Section,
  HStack,
  Spacer,
  Image,
  useState,
  useEffect,
} from "scripting"
import { createSession, restoreSession } from "../api/client"
import {
  addToHistory,
  clearHistory,
  getDomainFromEmail,
  getPrefixFromEmail,
  loadHistory,
  type HistoryItem,
} from "../utils/storage"
import { copyText, showAlert } from "../utils/ui"
import { setActiveSession } from "../utils/polling"
import { InboxPage } from "./InboxPage"
import { SettingsPage } from "./SettingsPage"

export function HomePage() {
  const dismiss = Navigation.useDismiss()

  const [prefix, setPrefix] = useState<string>("")
  const [domain, setDomain] = useState<string>("")
  const [email, setEmail] = useState<string>("")
  const [token, setToken] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(true)
  const [sessionBusy, setSessionBusy] = useState<boolean>(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showCopiedToast, setShowCopiedToast] = useState(false)

  // 初次进入时创建随机邮箱并加载历史
  useEffect(() => {
    async function init() {
      try {
        setHistory(loadHistory())
        await buildSession()
      } catch (err: any) {
        showAlert(`初始化失败：${err?.message || "未知错误"}`)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  // 应用会话结果到状态
  function applySession(newEmail: string, newToken: string) {
    setEmail(newEmail)
    setToken(newToken)
    setPrefix(getPrefixFromEmail(newEmail))
    setDomain(getDomainFromEmail(newEmail))
    addToHistory(newEmail)
    setHistory(loadHistory())
    setActiveSession(newEmail, newToken)
  }

  // 创建新的随机邮箱会话
  async function buildSession() {
    setSessionBusy(true)
    try {
      const result = await createSession()
      applySession(result.data.email, result.auth.token)
    } catch (err: any) {
      showAlert(`创建会话失败：${err?.message || "未知错误"}`)
      setEmail("")
      setToken("")
      setPrefix("")
      setDomain("")
    } finally {
      setSessionBusy(false)
    }
  }

  // 重新生成随机邮箱
  async function refreshEmail() {
    await buildSession()
  }

  // 复制邮箱地址到剪贴板
  async function copyEmail() {
    if (email) {
      await copyText(email)
      setShowCopiedToast(true)
    }
  }

  // 从历史记录恢复邮箱
  async function restoreHistory(item: HistoryItem) {
    setSessionBusy(true)
    try {
      const result = await restoreSession(item.email)
      applySession(result.data.email, result.auth.token)
    } catch (err: any) {
      showAlert(`恢复失败：${err?.message || "未知错误"}`)
    } finally {
      setSessionBusy(false)
    }
  }

  // 清空全部历史
  function clearAllHistory() {
    clearHistory()
    setHistory([])
  }

  const inboxDestination = email && token ? (
    <InboxPage email={email} token={token} />
  ) : (
    <List>
      <Section>
        <Text>邮箱尚未准备就绪</Text>
      </Section>
    </List>
  )

  const sourceFooter = (
    <Text font="caption2" frame={{ maxWidth: "infinity", alignment: "center" }}>
      接口来源：tempmail.lol
    </Text>
  )

  return (
    <List
      navigationTitle="临时邮箱"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="" systemImage="xmark" action={dismiss} />,
        topBarTrailing: (
          <NavigationLink destination={<SettingsPage />}>
            <Image systemName="gearshape" />
          </NavigationLink>
        ),
      }}
      toast={{
        message: "已复制",
        position: "top",
        duration: 2,
        isPresented: showCopiedToast,
        onChanged: setShowCopiedToast,
      }}
    >
      {loading && (
        <Section>
          <Text>正在创建邮箱…</Text>
        </Section>
      )}
      {!loading && (
        <Section title="当前邮箱">
          <Text>{sessionBusy ? "正在创建会话…" : email || "未生成邮箱"}</Text>
        </Section>
      )}
      {!loading && (
        <Section title="操作">
          <Button title="复制邮箱" action={copyEmail} />
          <Button title="重新生成" action={refreshEmail} />
          <NavigationLink
            title="打开收件箱"
            destination={inboxDestination}
          />
        </Section>
      )}
      {!loading && domain ? (
        <Section title="当前域名">
          <Text>{domain}</Text>
          {prefix ? <Text font="caption">前缀：{prefix}</Text> : null}
        </Section>
      ) : null}
      {!loading && history.length > 0 && (
        <Section
          header={
            <HStack>
              <Text>最近的邮箱</Text>
              <Spacer />
              <Button title="清空" font="caption2" foregroundStyle="red" action={clearAllHistory} />
            </HStack>
          }
          footer={sourceFooter}
        >
          {history.map((item) => (
            <Button
              title={item.email}
              action={() => restoreHistory(item)}
            />
          ))}
        </Section>
      )}
      {!loading && history.length === 0 ? (
        <Section footer={sourceFooter} />
      ) : null}
    </List>
  )
}
