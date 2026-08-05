/**
 * components/AddRemoteSheet.tsx - 添加远端半屏表单
 *
 * 名称与 URL 草稿由本组件的 Observable 自持，确认时一次性回传。
 */

import { Section, Text, useObservable } from "scripting"
import { FormSheet } from "./FormSheet"
import { FormRow } from "./FormRow"
import { COLOR_SECONDARY_LABEL } from "../constants/colors"

export function AddRemoteSheet({
  busy = false,
  onCancel,
  onConfirm,
}: {
  busy?: boolean
  onCancel: () => void
  /** 确认时一次性回传远端名称与 URL */
  onConfirm: (name: string, url: string) => void
}) {
  const name = useObservable("")
  const url = useObservable("")

  return (
    <FormSheet
      navigationTitle="添加远端"
      confirmTitle={busy ? "处理中…" : "添加"}
      confirmDisabled={busy || !name.value.trim() || !url.value.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(name.value.trim(), url.value.trim())}
    >
      <Section
        footer={
          <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
            URL 支持 https 与 git@host:path
          </Text>
        }
      >
        <FormRow label="名称" prompt="origin / upstream" observable={name} />
        <FormRow
          label="Git URL"
          prompt="https://github.com/user/repo.git"
          observable={url}
        />
      </Section>
    </FormSheet>
  )
}
