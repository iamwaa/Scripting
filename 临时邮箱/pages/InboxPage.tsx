import {
  List,
  Section,
  Text,
  Button,
  NavigationLink,
  useState,
  useEffect,
} from "scripting"
import { fetchMessages } from "../api/client"
import { getSubject } from "../utils/format"
import { MessagePage } from "./MessagePage"

export type InboxPageProps = {
  email: string
  token: string
}

export function InboxPage({ email, token }: InboxPageProps) {
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>("")

  async function loadMessages() {
    setLoading(true)
    setError("")
    try {
      const result = await fetchMessages(email, token)
      setMessages(result.data || [])
    } catch (err: any) {
      setError(err?.message || "无法获取邮件列表")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMessages()
  }, [email, token])

  return (
    <List
      navigationTitle="收件箱"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        primaryAction: (
          <Button action={loadMessages}>
            <Text fontWeight="semibold">刷新</Text>
          </Button>
        ),
      }}
    >
      <Section title={email}>
        <Text>共 {messages.length} 封邮件</Text>
      </Section>
      {error ? (
        <Section>
          <Text>错误：{error}</Text>
        </Section>
      ) : null}
      {loading ? (
        <Section>
          <Text>正在刷新邮件列表…</Text>
        </Section>
      ) : null}
      <Section title="邮件列表">
        {!loading && messages.length === 0 && !error ? (
          <Text>暂无邮件</Text>
        ) : null}
        {messages.map((msg) => (
          <NavigationLink
            key={String(msg.id)}
            title={getSubject(msg)}
            destination={<MessagePage token={token} messageId={msg.id} />}
          />
        ))}
      </Section>
    </List>
  )
}
