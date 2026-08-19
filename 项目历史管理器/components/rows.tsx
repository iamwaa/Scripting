import { HStack, Image, Spacer, Text, VStack } from "scripting"
import { ProjectCandidate, ProjectHistory, Snapshot } from "../types"
import { formatBytes, shortPath } from "../utils/format"

// 键值信息行
export function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font={13} foregroundStyle="secondaryLabel">
        {title}
      </Text>
      <Text font={16}>{value}</Text>
    </VStack>
  )
}

// 路径信息行，路径较长使用小字号
export function PathMetric({ title, value }: { title: string; value: string }) {
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font={13} foregroundStyle="secondaryLabel">
        {title}
      </Text>
      <Text font={13} foregroundStyle="label">
        {shortPath(value)}
      </Text>
    </VStack>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <VStack alignment="center" spacing={12}>
      <Image systemName="tray" foregroundStyle="secondaryLabel" />
      <Text foregroundStyle="secondaryLabel">{message}</Text>
    </VStack>
  )
}

export function ProjectRow({ project }: { project: ProjectHistory }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="folder" foregroundStyle="tintColor" />
        <Text font={17} fontWeight="semibold">
          {project.name}
        </Text>
        <Spacer />
        <Text font={13} foregroundStyle="secondaryLabel">
          {project.snapshots.length} 个
        </Text>
      </HStack>
      <HStack spacing={8}>
        <Text font={13} foregroundStyle="secondaryLabel">
          {project.latest?.timestampLabel || "无备份时间"}
        </Text>
        <Spacer />
        <Text font={13} foregroundStyle="secondaryLabel">
          {formatBytes(project.totalBytes)}
        </Text>
      </HStack>
    </VStack>
  )
}

export function ProjectCandidateRow({ project }: { project: ProjectCandidate }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="folder" foregroundStyle="tintColor" />
        <Text font={17} fontWeight="semibold" foregroundStyle="label">
          {project.name}
        </Text>
      </HStack>
      <Text font={13} foregroundStyle="secondaryLabel">
        {shortPath(project.path)}
      </Text>
    </VStack>
  )
}

export function SnapshotRow({ snapshot }: { snapshot: Snapshot }) {
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10}>
        <Image systemName="clock.arrow.circlepath" foregroundStyle="tintColor" />
        <Text font={17} fontWeight="semibold">
          {snapshot.description}
        </Text>
        <Spacer />
        <Text font={13} foregroundStyle="secondaryLabel">
          {formatBytes(snapshot.byteSize)}
        </Text>
      </HStack>
      <Text font={13} foregroundStyle="secondaryLabel">
        {snapshot.timestampLabel} · {snapshot.fileCount} 个文件
      </Text>
    </VStack>
  )
}
