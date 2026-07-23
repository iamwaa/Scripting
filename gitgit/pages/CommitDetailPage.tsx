import {
  List,
  Section,
  Text,
  HStack,
  NavigationLink,
  DisclosureGroup,
  Image,
  useEffect,
  useState,
} from "scripting"
import type { CommitDetail } from "../types/git"
import type { FileTreeNode } from "../utils/fileTree"
import { buildFileTree } from "../utils/fileTree"
import { getCommitDetail } from "../services/gitService"
import { CommitDiffPage } from "./CommitDiffPage"
import { shortOid, commitTitle } from "../utils/format"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_ORANGE,
  COLOR_ACCENT,
} from "../constants/colors"

function CommitFileTreeNode({
  node,
  statusByPath,
  bookmarkName,
  oid,
  parentOid,
}: {
  node: FileTreeNode
  statusByPath: Map<string, "added" | "modified" | "deleted">
  bookmarkName: string
  oid: string
  parentOid: string | null
}) {
  if (node.type === "directory") {
    return (
      <DisclosureGroup
        label={
          <HStack alignment="center" spacing={10}>
            <Image systemName="folder" foregroundStyle={COLOR_ACCENT} />
            <Text foregroundStyle={COLOR_LABEL}>{node.name}</Text>
          </HStack>
        }
      >
        {node.children.map((child) => (
          <CommitFileTreeNode
            key={child.path}
            node={child}
            statusByPath={statusByPath}
            bookmarkName={bookmarkName}
            oid={oid}
            parentOid={parentOid}
          />
        ))}
      </DisclosureGroup>
    )
  }

  const status = statusByPath.get(node.path) || "modified"
  const color =
    status === "added"
      ? COLOR_GREEN
      : status === "deleted"
        ? COLOR_RED
        : COLOR_ORANGE
  const label = status === "added" ? "A" : status === "deleted" ? "D" : "M"
  return (
    <NavigationLink
      destination={
        <CommitDiffPage
          bookmarkName={bookmarkName}
          oid={oid}
          parentOid={parentOid}
          filepath={node.path}
        />
      }
    >
      <HStack spacing={10}>
        <Text font="headline" foregroundStyle={color}>
          {label}
        </Text>
        <Image systemName="doc" foregroundStyle={COLOR_SECONDARY_LABEL} />
        <Text foregroundStyle={COLOR_LABEL} lineLimit={2}>
          {node.name}
        </Text>
      </HStack>
    </NavigationLink>
  )
}

export function CommitDetailPage({
  bookmarkName,
  oid,
}: {
  bookmarkName: string
  oid: string
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
  const statusByPath = new Map(
    detail?.files.map((file) => [file.filepath, file.status] as const) || []
  )

  return (
    <List
      navigationTitle="提交详情"
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
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              完整 ID：{detail.oid}
            </Text>
            <Text font="caption" foregroundStyle={COLOR_SECONDARY_LABEL}>
              作者：{detail.author.name || "unknown"}{" "}
              {detail.author.email ? `<${detail.author.email}>` : ""}
            </Text>
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
