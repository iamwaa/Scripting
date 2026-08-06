import {
  List,
  Section,
  Text,
  HStack,
  useEffect,
  useState,
} from "scripting"
import type { CommitDetail } from "../types/git"
import { buildFileTree } from "../utils/fileTree"
import { getCommitDetail } from "../services/gitService"
import { CommitFileTreeNode } from "../components/CommitFileTree"
import { AvatarView } from "../components/AvatarView"
import { avatarUrlForGitAuthor } from "../utils/github"
import { shortOid, commitTitle, commitBody } from "../utils/format"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"

export function CommitDetailPage({
  bookmarkName,
  oid,
  title = "提交详情",
}: {
  bookmarkName: string
  oid: string
  /** 导航栏标题，Stash 详情可传「Stash 详情」 */
  title?: string
}) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 必须随 oid 变化重新拉取；导航 content 复用时 [] 会一直显示首次打开的提交
  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    getCommitDetail(bookmarkName, oid)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch((e: any) => {
        if (!cancelled) setError(String(e?.message || e))
      })
    return () => {
      cancelled = true
    }
  }, [bookmarkName, oid])

  const changeTree = detail
    ? buildFileTree(detail.files.map((file) => file.filepath))
    : []
  // 提交补充说明（首行标题之后的正文）
  const body = detail ? commitBody(detail.message) : ""
  const statusByPath = new Map(
    detail?.files.map((file) => [file.filepath, file.status] as const) || []
  )

  return (
    <List
      navigationTitle={title}
      navigationBarTitleDisplayMode="inline"
      tabBarVisibility="hidden"
    >
      {error ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载失败：{error}</Text>
        </Section>
      ) : !detail ? (
        <Section>
          <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
        </Section>
      ) : (
        <>
          <Section header={<Text>提交信息</Text>}>
            <Text font="headline" foregroundStyle={COLOR_LABEL}>
              {commitTitle(detail.message) || "(无提交信息)"}
            </Text>
            {body ? (
              <Text font="subheadline" foregroundStyle={COLOR_LABEL}>
                {body}
              </Text>
            ) : null}
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              完整 ID：{detail.oid}
            </Text>
            <HStack alignment="center" spacing={4}>
              <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
                作者：
              </Text>
              <AvatarView
                url={avatarUrlForGitAuthor(detail.author.email)}
                size={14}
              />
              <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
                {detail.author.name || "unknown"}{" "}
                {detail.author.email ? `<${detail.author.email}>` : ""}
              </Text>
            </HStack>
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              时间：{new Date(detail.date).toLocaleString()}
            </Text>
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              父提交：{detail.parentOid ? shortOid(detail.parentOid) : "根提交"}
            </Text>
          </Section>
          <Section header={<Text>文件变更（{detail.files.length}）</Text>}>
            {detail.files.length === 0 ? (
              <Text foregroundStyle={COLOR_SECONDARY_LABEL}>没有文件变更</Text>
            ) : (
              changeTree.map((node) => (
                <CommitFileTreeNode
                  key={node.path}
                  node={node}
                  statusByPath={statusByPath}
                  bookmarkName={bookmarkName}
                  oid={detail.oid}
                  parentOid={detail.parentOid}
                />
              ))
            )}
          </Section>
        </>
      )}
    </List>
  )
}
