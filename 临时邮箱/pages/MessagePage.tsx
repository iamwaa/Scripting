import {
  List,
  Section,
  Text,
  useState,
  useEffect,
} from "scripting"
import type { MessageDetail } from "../types"
import { fetchMessageContent } from "../api/client"
import { copyText } from "../utils/ui"
import { CopyableRow } from "../components/CopyableRow"
import {
  formatDate,
  getMessageBody,
  getSender,
  getSubject,
} from "../utils/format"

export type MessagePageProps = {
  token: string
  messageId: string | number
}

export function MessagePage({ token, messageId }: MessagePageProps) {
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [error, setError] = useState<string>("")
  const [copiedMessage, setCopiedMessage] = useState("")
  const [showCopiedToast, setShowCopiedToast] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const result = await fetchMessageContent(messageId, token)
        if (!cancelled) {
          setDetail(result.data)
          setError("")
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "无法获取邮件详情")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token, messageId])

  const subject = getSubject(detail)
  const sender = getSender(detail)
  const date = formatDate(detail?.createdAt || detail?.date || detail?.created_at)
  const body = getMessageBody(detail)

  async function copyValue(label: string, value: string) {
    await copyText(value)
    setCopiedMessage(`${label}已复制`)
    setShowCopiedToast(true)
  }

  return (
    <List
      navigationTitle="邮件详情"
      navigationBarTitleDisplayMode="inline"
      toast={{
        message: copiedMessage,
        position: "top",
        duration: 2,
        isPresented: showCopiedToast,
        onChanged: setShowCopiedToast,
      }}
    >
      {loading ? (
        <Section>
          <Text>正在加载邮件内容…</Text>
        </Section>
      ) : null}
      {error ? (
        <Section>
          <Text>错误：{error}</Text>
        </Section>
      ) : null}
      {!loading && detail ? (
        <Section
          header={<Text>主题</Text>}
        >
          <CopyableRow label="主题" value={subject} onCopy={copyValue} />
        </Section>
      ) : null}
      {!loading && detail ? (
        <Section title="发件人">
          <CopyableRow label="发件人" value={sender} onCopy={copyValue} />
        </Section>
      ) : null}
      {!loading && detail ? (
        <Section title="时间">
          <CopyableRow label="时间" value={date} onCopy={copyValue} />
        </Section>
      ) : null}
      {!loading && detail ? (
        <Section title="正文">
          <CopyableRow label="正文" value={body} onCopy={copyValue} />
        </Section>
      ) : null}
      {!loading && !detail && !error ? (
        <Section>
          <Text>未获取到邮件内容</Text>
        </Section>
      ) : null}
    </List>
  )
}
