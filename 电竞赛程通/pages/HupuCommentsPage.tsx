import { List, Section, Text, VStack, HStack, Image, Spacer, Button, ProgressView, Picker, useState, useEffect, useRef } from "scripting"
import type { HupuComment } from "../hupuTypes"
import { fetchHupuComments, HUPU_COMMENT_SORTS } from "../api/hupu"
import type { HupuCommentSort } from "../api/hupu"
import { HupuAvatar } from "../components/HupuAvatar"
import { HupuScoreBadge, formatCount } from "../components/HupuScoreBadge"

interface HupuCommentsPageProps {
  bizType: string
  bizNo: string
  name: string
  avatar: string
  score: number | null
  commentCount: number
}

// 由评分榜推入的子页:自身不带 NavigationStack,复用父级导航栈
export function HupuCommentsPage({ bizType, bizNo, name, avatar, score, commentCount }: HupuCommentsPageProps) {
  const [comments, setComments] = useState<HupuComment[]>([])
  const [sort, setSort] = useState<HupuCommentSort>("latest")
  const [cursor, setCursor] = useState<number | null>(null)
  const [total, setTotal] = useState(commentCount)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  // 快速连切排序时丢弃过期的首页响应,避免旧排序的结果覆盖新排序
  const requestSeq = useRef(0)

  const loadFirst = async (targetSort: HupuCommentSort = sort) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      // 首屏起点交给接口按排序推定(正序 0、倒序当前时间)
      const page = await fetchHupuComments(bizType, bizNo, targetSort, null)
      if (seq !== requestSeq.current) return
      setComments(page.comments)
      setCursor(page.nextCursor)
      // 热门接口不返回总数,沿用条目已知的评论数
      setTotal(page.total || commentCount)
      setEnded(page.nextCursor == null)
    } catch (e) {
      if (seq === requestSeq.current) setError(String(e))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    setComments([])
    setCursor(null)
    setEnded(false)
    loadFirst(sort)
    // 切换排序要重新拉首页,不能只跟 bizType/bizNo
  }, [bizType, bizNo, sort])

  // 触底加载下一页;热门无游标,ended 直接为 true 不会走到这里
  const loadMore = async () => {
    if (loading || loadingMore || ended || cursor == null) return
    const seq = requestSeq.current
    setLoadingMore(true)
    try {
      const page = await fetchHupuComments(bizType, bizNo, sort, cursor)
      // 拉分页途中切了排序：丢弃这一页,不要把旧排序的数据接到新列表上
      if (seq !== requestSeq.current) return
      setComments((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...page.comments.filter((item) => !seen.has(item.id))]
      })
      setCursor(page.nextCursor)
      if (page.nextCursor == null) setEnded(true)
      if (page.total > 0) setTotal(page.total)
    } catch (e) {
      if (seq === requestSeq.current) setError(String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <List navigationTitle={name} navigationBarTitleDisplayMode="inline" tabBarVisibility="hidden">
      <Section>
        <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
          <HupuAvatar url={avatar} size={48} fallbackSystemName="person.crop.circle" />
          {/* 同评分榜:frame 需显式 leading 才靠左,否则内容默认居中 */}
          <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font={17} fontWeight="semibold" lineLimit={1}>
              {name}
            </Text>
            <Text font={13} foregroundStyle="secondaryLabel">
              {formatCount(total)} 条评论
            </Text>
          </VStack>
          <HupuScoreBadge score={score} size={22} />
        </HStack>
      </Section>

      <Section>
        <Picker
          title="排序"
          value={sort}
          onChanged={(value: string) => setSort(value as HupuCommentSort)}
          pickerStyle="segmented"
        >
          {HUPU_COMMENT_SORTS.map((item) => (
            <Text key={item.value} tag={item.value}>
              {item.label}
            </Text>
          ))}
        </Picker>
      </Section>

      {error ? (
        <Section>
          <VStack alignment="leading" spacing={8}>
            <Text foregroundStyle="red" font={14}>
              {error}
            </Text>
            <Button title="重试" action={() => loadFirst()} />
          </VStack>
        </Section>
      ) : null}

      {loading ? (
        <Section>
          <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={20}>
            <ProgressView />
          </HStack>
        </Section>
      ) : null}

      {comments.length > 0 ? (
        <Section>
          {comments.map((comment, index) => (
            <HStack
              key={comment.id}
              alignment="top"
              spacing={10}
              frame={{ maxWidth: "infinity" }}
              onAppear={index === comments.length - 1 ? loadMore : undefined}
            >
              <HupuAvatar url={comment.avatar} size={32} />
              <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
                  <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>
                    {comment.user}
                  </Text>
                  <Spacer minLength={4} />
                  {/* 只有打过分的评论才显示用户评分 */}
                  {comment.score > 0 ? <HupuScoreBadge score={comment.score} size={15} /> : null}
                </HStack>

                <Text
                  font={15}
                  lineLimit={10}
                  multilineTextAlignment="leading"
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  fixedSize={{ horizontal: false, vertical: true }}
                >
                  {comment.replyTo ? `回复 @${comment.replyTo}：${comment.content}` : comment.content}
                </Text>

                <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
                  <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1}>
                    {[comment.date, comment.ip].filter(Boolean).join(" · ")}
                  </Text>
                  <Spacer minLength={4} />
                  {comment.lightCount > 0 ? (
                    <HStack spacing={3}>
                      <Image
                        systemName="hand.thumbsup"
                        imageScale="small"
                        font={11}
                        foregroundStyle="tertiaryLabel"
                      />
                      <Text font={11} foregroundStyle="tertiaryLabel">
                        {comment.lightCount}
                      </Text>
                    </HStack>
                  ) : null}
                </HStack>
              </VStack>
            </HStack>
          ))}
        </Section>
      ) : null}

      {loadingMore ? (
        <Section>
          <HStack frame={{ maxWidth: "infinity", alignment: "center" }} padding={12}>
            <ProgressView />
          </HStack>
        </Section>
      ) : null}

      {!loading && !error && comments.length === 0 ? (
        <Section>
          <VStack alignment="center" spacing={10} frame={{ minHeight: 140, maxWidth: "infinity", alignment: "center" }}>
            <Image
              systemName="text.bubble"
              resizable
              scaleToFit
              frame={{ width: 36, height: 36 }}
              foregroundStyle="secondaryLabel"
            />
            <Text font={14} foregroundStyle="secondaryLabel">
              还没有人评论
            </Text>
          </VStack>
        </Section>
      ) : null}

      {ended && comments.length > 0 ? (
        <Section>
          <Text font={12} foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>
            {sort === "hot" ? "以上为虎扑热评（服务端按热度给出）" : "没有更多评论了"}
          </Text>
        </Section>
      ) : null}
    </List>
  )
}
