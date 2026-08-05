import {
  Button,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import type { GitHubComment, GitHubIssueItem } from "../types/github"
import { getIssueOrPull, listIssueComments } from "../api/githubApi"
import { relativeTime } from "../utils/format"
import {
  COLOR_ACCENT,
  COLOR_GREEN,
  COLOR_LABEL,
  COLOR_PURPLE,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

export function GitHubItemDetailPage({
  fullName,
  number,
}: {
  fullName: string
  number: number
}) {
  const [item, setItem] = useState<GitHubIssueItem | null>(null)
  const [comments, setComments] = useState<GitHubComment[]>([])
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const [nextItem, nextComments] = await Promise.all([
        getIssueOrPull(fullName, number),
        listIssueComments(fullName, number),
      ])
      setItem(nextItem)
      setComments(nextComments)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  useEffect(() => {
    load()
  }, [fullName, number])

  const kind = item?.isPullRequest ? "Pull Request" : "Issue"
  const status = item?.merged
    ? "已合并"
    : item?.state === "closed"
      ? "已关闭"
      : item?.draft
        ? "草稿"
        : "开放"
  const statusColor = item?.merged
    ? COLOR_PURPLE
    : item?.state === "open"
      ? COLOR_GREEN
      : COLOR_SECONDARY_LABEL

  return (
    <List
      navigationTitle={item ? `#${item.number} ${kind}` : kind}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
      toolbar={{
        topBarTrailing: item ? (
          <Button
            title="在 GitHub 打开"
            systemImage="safari"
            action={() => Safari.present(item.htmlUrl)}
          />
        ) : undefined,
      }}
    >
      {error ? (
        <Section footer={<Text>{error}</Text>}>
          <Button title="重试" systemImage="arrow.clockwise" action={load} />
        </Section>
      ) : !item ? (
        <Section><Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text></Section>
      ) : (
        <>
          <Section header={<Text>{kind}</Text>}>
            <Text font={17} foregroundStyle={COLOR_LABEL}>{item.title}</Text>
            <HStack spacing={8}>
              <Image
                systemName={item.state === "open" ? "circle.circle" : "checkmark.circle.fill"}
                font={14}
                foregroundStyle={statusColor}
              />
              <Text font={13} foregroundStyle={statusColor}>{status}</Text>
              <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
                {item.author.login} · {relativeTime(item.createdAt)}
              </Text>
            </HStack>
            {item.labels.length > 0 ? (
              <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                标签：{item.labels.map((label) => label.name).join(" · ")}
              </Text>
            ) : null}
          </Section>
          <Section header={<Text>描述</Text>}>
            <Text foregroundStyle={item.body ? COLOR_LABEL : COLOR_SECONDARY_LABEL}>
              {item.body || "未填写描述"}
            </Text>
          </Section>
          <Section header={<Text>评论（{comments.length}）</Text>}>
            {comments.length === 0 ? (
              <Text foregroundStyle={COLOR_SECONDARY_LABEL}>还没有评论</Text>
            ) : comments.map((comment) => (
              <VStack key={comment.id} alignment="leading" spacing={6}>
                <HStack>
                  <Text font={13} foregroundStyle={COLOR_ACCENT}>{comment.author.login}</Text>
                  <Spacer />
                  <Text font={12} foregroundStyle={COLOR_SECONDARY_LABEL}>
                    {relativeTime(comment.createdAt)}
                  </Text>
                </HStack>
                <Text foregroundStyle={COLOR_LABEL}>{comment.body || "(空评论)"}</Text>
              </VStack>
            ))}
          </Section>
        </>
      )}
    </List>
  )
}

export default GitHubItemDetailPage
