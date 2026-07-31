/**
 * components/CommitFileTree.tsx - 提交间文件变更树
 *
 * 以可展开目录树展示两个提交（或 merge-base → tip）间的 A/M/D 文件，
 * 叶子行跳转行级 Diff。CommitDetailPage 与 ComparePage 共用。
 */

import {
  Text,
  HStack,
  NavigationLink,
  DisclosureGroup,
  Image,
} from "scripting"
import type { FileTreeNode } from "../utils/fileTree"
import { CommitDiffPage } from "../pages/CommitDiffPage"
import {
  COLOR_LABEL,
  COLOR_SECONDARY_LABEL,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_ORANGE,
  COLOR_ACCENT,
} from "../constants/colors"

export function CommitFileTreeNode({
  node,
  statusByPath,
  bookmarkName,
  oid,
  parentOid,
}: {
  node: FileTreeNode
  statusByPath: Map<string, "added" | "modified" | "deleted">
  bookmarkName: string
  /** 新版本所在提交（diff 的新侧） */
  oid: string
  /** 旧版本所在提交（diff 的旧侧）；根提交/无共同祖先传 null */
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
