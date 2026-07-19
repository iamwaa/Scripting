import {
  List,
  Section,
  Text,
  useState,
  useEffect,
} from "scripting"
import { fetchMessageContent } from "../api/client"
import { formatDate, getSender, getSubject } from "../utils/format"

export type MessagePageProps = {
  token: string
  messageId: string | number
}

// 提取可读正文
function extractBody(detail: any): string {
  if (!detail) {
    return "（无正文内容）"
  }
  if (typeof detail.text === "string" && detail.text.trim()) {
    return detail.text
  }
  if (typeof detail.body === "string" && detail.body.trim()) {
    return detail.body
  }
  if (typeof detail.html === "string" && detail.html.trim()) {
    return detail.html
  }
  if (Array.isArray(detail.html) && detail.html.length > 0) {
    return detail.html.join("\n")
  }
  if (typeof detail.intro === "string" && detail.intro.trim()) {
    return detail.intro
  }
  return "（无正文内容）"
}

export function MessagePage({ token, messageId }: MessagePageProps) {
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<any>(null)
  const [error, setError] = useState<string>("")

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

  const body = extractBody(detail)

  return (
    <List
      navigationTitle="邮件详情"
      navigationBarTitleDisplayMode="inline"
    >
      {loading && (
        <Section>
          <Text>正在加载邮件内容…</Text>
        </Section>
      )}
      {error && (
        <Section>
          <Text>错误：{error}</Text>
        </Section>
      )}
      {!loading && detail && (
        <>
          <Section title="主题">
            <Text>{getSubject(detail)}</Text>
          </Section>
          <Section title="发件人">
            <Text>{getSender(detail)}</Text>
          </Section>
          <Section title="时间">
            <Text>{formatDate(detail.createdAt || detail.date || detail.created_at)}</Text>
          </Section>
          <Section title="正文">
            <Text>{body}</Text>
          </Section>
        </>
      )}
    </List>
  )
}
