import {
  Button,
  HStack,
  Image,
  Menu,
  Picker,
  Section,
  Spacer,
  Text,
} from "scripting"
import { COLOR_ACCENT, COLOR_RED, COLOR_SECONDARY_LABEL } from "../constants/colors"
import { DEFAULT_BRANCH } from "../constants/git"
import type { BranchInfo } from "../types/git"

export function RepoBranchSection({
  branchInfo,
  remoteOnlyBranches,
  remoteBranchNames,
  mergeSources,
  deletableBranches,
  hasCommits,
  hasRemote,
  mergeInProgress,
  mutating,
  onDelete,
  onMerge,
  onRename,
  onCreate,
  onSwitch,
}: {
  branchInfo: BranchInfo
  remoteOnlyBranches: string[]
  remoteBranchNames: string[]
  mergeSources: string[]
  deletableBranches: string[]
  hasCommits: boolean
  hasRemote: boolean
  mergeInProgress: boolean
  mutating: boolean
  onDelete: (branch: string) => void
  onMerge: (branch: string) => void
  onRename: () => void
  onCreate: () => void
  onSwitch: (branch: string) => void
}) {
  const mergeDisabled = mutating || mergeInProgress || !hasCommits

  return (
    <Section
      header={
        <HStack alignment="center" spacing={8}>
          <Text>分支</Text>
          <Spacer />
          {deletableBranches.length > 0 ? (
            <Menu
              label={
                <HStack alignment="center" spacing={4}>
                  <Image systemName="trash" font="caption" foregroundStyle={COLOR_RED} />
                  <Text font="caption" foregroundStyle={COLOR_RED}>删除</Text>
                </HStack>
              }
            >
              {deletableBranches.map((branch) => (
                <Button
                  key={branch}
                  title={
                    remoteOnlyBranches.includes(branch)
                      ? `origin/${branch}（远端）`
                      : branch
                  }
                  role="destructive"
                  action={() => onDelete(branch)}
                  disabled={mutating || mergeInProgress}
                />
              ))}
            </Menu>
          ) : null}
          {mergeSources.length > 0 ? (
            <Menu
              label={
                <HStack alignment="center" spacing={4}>
                  <Image
                    systemName="arrow.triangle.merge"
                    font="caption"
                    foregroundStyle={COLOR_ACCENT}
                  />
                  <Text font="caption" foregroundStyle={COLOR_ACCENT}>合并</Text>
                </HStack>
              }
            >
              {mergeSources.map((branch) => (
                <Button
                  key={branch}
                  title={branch}
                  action={() => onMerge(branch)}
                  disabled={mergeDisabled}
                />
              ))}
            </Menu>
          ) : null}
          <Button
            action={onRename}
            disabled={mutating || mergeInProgress || !hasCommits || !branchInfo.current}
          >
            <HStack alignment="center" spacing={4}>
              <Image systemName="pencil" font="caption" foregroundStyle={COLOR_ACCENT} />
              <Text font="caption" foregroundStyle={COLOR_ACCENT}>重命名</Text>
            </HStack>
          </Button>
          <Button action={onCreate} disabled={mutating || mergeInProgress}>
            <HStack alignment="center" spacing={4}>
              <Image systemName="plus.circle" font="caption" foregroundStyle={COLOR_ACCENT} />
              <Text font="caption" foregroundStyle={COLOR_ACCENT}>新建</Text>
            </HStack>
          </Button>
        </HStack>
      }
      footer={
        <Text font="footnote" foregroundStyle={COLOR_SECONDARY_LABEL}>
          {!hasCommits
            ? `空仓库默认 ${branchInfo.current || DEFAULT_BRANCH}，首次提交后才会真正创建分支引用`
            : hasRemote
              ? "含本地与 origin 远端分支"
              : "仅本地分支"}
        </Text>
      }
    >
      {branchInfo.branches.length > 0 ? (
        <Picker
          title="当前分支"
          value={branchInfo.current ?? ""}
          onChanged={(value: string) => onSwitch(value)}
        >
          {branchInfo.branches.map((branch) => (
            <Text key={branch} tag={branch}>
              {remoteBranchNames.includes(branch) ? `${branch} · 远端` : `${branch} · 本地`}
            </Text>
          ))}
        </Picker>
      ) : (
        <Text foregroundStyle={COLOR_SECONDARY_LABEL}>
          默认 {DEFAULT_BRANCH}（尚未初始化）
        </Text>
      )}
    </Section>
  )
}
