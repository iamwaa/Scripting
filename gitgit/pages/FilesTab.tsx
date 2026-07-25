import { DisclosureGroup, Section, Text, HStack, Image } from "scripting"
import { buildFileTree, FileTreeNode } from "../utils/fileTree"
import { COLOR_LABEL, COLOR_SECONDARY_LABEL, COLOR_ACCENT } from "../constants/colors"

function FileTreeNodeView({ node }: { node: FileTreeNode }) {
  if (node.type === "file") {
    return (
      <HStack alignment="center" spacing={10}>
        <Image systemName="doc" foregroundStyle={COLOR_SECONDARY_LABEL} />
        <Text font="body" foregroundStyle={COLOR_LABEL} lineLimit={2}>
          {node.name}
        </Text>
      </HStack>
    )
  }

  return (
    <DisclosureGroup
      label={
        <HStack alignment="center" spacing={10}>
          <Image systemName="folder" foregroundStyle={COLOR_ACCENT} />
          <Text font="body" foregroundStyle={COLOR_LABEL}>
            {node.name}
          </Text>
        </HStack>
      }
    >
      {node.children.map((child) => (
        <FileTreeNodeView key={child.path} node={child} />
      ))}
    </DisclosureGroup>
  )
}

export function FilesTab({
  files,
  loading,
}: {
  files: string[]
  loading: boolean
}) {
  const tree = buildFileTree(files)

  return (
    <Section
      header={<Text>当前 HEAD 文件{files.length > 0 ? `（${files.length}）` : "" }</Text>}
    >
      {loading ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>加载中…</Text>
      ) : files.length === 0 ? (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
          当前分支还没有已跟踪文件
        </Text>
      ) : (
        tree.map((node) => <FileTreeNodeView key={node.path} node={node} />)
      )}
    </Section>
  )
}
