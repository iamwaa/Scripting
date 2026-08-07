import { Button, HStack, Image, Section, Spacer, Text } from "scripting"
import {
  COLOR_ACCENT,
  COLOR_ORANGE,
  COLOR_SECONDARY_LABEL,
} from "../constants/colors"
import { DEFAULT_BRANCH } from "../constants/git"
import type { BranchInfo } from "../types/git"
import type { UpstreamConfig } from "../utils/remote"
import { pullActionFooterHint } from "../utils/branchMerge"

export function RepoRemoteSections({
  branchInfo,
  upstream,
  pulledLabel,
  hasRemote,
  canUpload,
  mergeInProgress,
  mutating,
  hasCommits,
  onCompare,
  onRollback,
  onManageRemotes,
  onUpload,
  onPush,
  onPull,
}: {
  branchInfo: BranchInfo
  upstream: UpstreamConfig | null
  pulledLabel: string
  hasRemote: boolean
  canUpload: boolean
  mergeInProgress: boolean
  mutating: boolean
  hasCommits: boolean
  onCompare: () => void
  onRollback: () => void
  onManageRemotes: () => void
  onUpload: () => void
  onPush: () => void
  onPull: () => void
}) {
  if (hasRemote) {
    return (
      <Section
        header={
          <HStack alignment="center" spacing={8}>
            <Text>同步</Text>
            <Spacer />
            <Button
              action={onRollback}
              disabled={mutating || mergeInProgress || !hasCommits}
            >
              <HStack alignment="center" spacing={4}>
                <Image
                  systemName="arrow.uturn.backward"
                  font="caption"
                  foregroundStyle={COLOR_ORANGE}
                />
                <Text font="caption" foregroundStyle={COLOR_ORANGE}>回滚</Text>
              </HStack>
            </Button>
            <Button action={onCompare} disabled={mutating}>
              <HStack alignment="center" spacing={4}>
                <Image
                  systemName="arrow.left.arrow.right"
                  font="caption"
                  foregroundStyle={COLOR_ACCENT}
                />
                <Text font="caption" foregroundStyle={COLOR_ACCENT}>对比差异</Text>
              </HStack>
            </Button>
            <Button action={onManageRemotes} disabled={mutating}>
              <HStack alignment="center" spacing={4}>
                <Image systemName="network" font="caption" foregroundStyle={COLOR_ACCENT} />
                <Text font="caption" foregroundStyle={COLOR_ACCENT}>远端管理</Text>
              </HStack>
            </Button>
          </HStack>
        }
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            {pullActionFooterHint(branchInfo.current, upstream)}
            {"\n"}
            最近拉取：{pulledLabel}
          </Text>
        }
      >
        <Button action={onPush} disabled={mutating || mergeInProgress}>
          <HStack alignment="center" spacing={6}>
            <Image systemName="arrow.up.circle" />
            <Text>推送 Push</Text>
          </HStack>
        </Button>
        <Button action={onPull} disabled={mutating || mergeInProgress}>
          <HStack alignment="center" spacing={6}>
            <Image systemName="arrow.down.circle" />
            <Text>拉取 Pull</Text>
          </HStack>
        </Button>
      </Section>
    )
  }

  if (canUpload) {
    return (
      <Section
        header={<Text>上传</Text>}
        footer={
          <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
            本地仓库 · 默认分支 {branchInfo.current || DEFAULT_BRANCH}
            · 需至少一次提交后再上传
          </Text>
        }
      >
        <Button
          title="上传到 GitHub"
          systemImage="arrow.up.circle"
          action={onUpload}
        />
        <Button title="远端管理" systemImage="network" action={onManageRemotes} />
      </Section>
    )
  }

  return (
    <Section
      header={<Text>远端</Text>}
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          可手动添加 origin，或克隆/上传后自动出现同步区
        </Text>
      }
    >
      <Button title="远端管理" systemImage="network" action={onManageRemotes} />
    </Section>
  )
}
