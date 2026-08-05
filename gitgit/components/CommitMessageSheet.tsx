/**
 * components/CommitMessageSheet.tsx - 提交信息半屏表单
 *
 * 草稿由本组件的 Observable 自持，父页只在确认时收到一次结果，
 * 避免逐字符回写父页 state 导致 sheet 内容重建、输入框失焦或失效。
 */

import { Section, Text, useObservable } from "scripting"
import { FormSheet } from "./FormSheet"
import { FormRow } from "./FormRow"

export function CommitMessageSheet({
  navigationTitle,
  confirmTitle,
  footer,
  initialTitle,
  initialDescription,
  busy = false,
  onCancel,
  onConfirm,
}: {
  navigationTitle: string
  confirmTitle: string
  footer?: string
  /** 打开弹窗时的初始标题 */
  initialTitle: string
  /** 打开弹窗时的初始描述 */
  initialDescription: string
  busy?: boolean
  onCancel: () => void
  /** 确认时一次性回传标题与描述 */
  onConfirm: (title: string, description: string) => void
}) {
  const title = useObservable(initialTitle)
  const description = useObservable(initialDescription)

  return (
    <FormSheet
      navigationTitle={navigationTitle}
      confirmTitle={confirmTitle}
      confirmDisabled={busy || !title.value.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(title.value, description.value)}
    >
      <Section
        header={<Text>提交信息</Text>}
        footer={footer ? <Text>{footer}</Text> : undefined}
      >
        <FormRow
          label="标题"
          prompt="简要描述本次改动（必填）"
          observable={title}
        />
        <FormRow
          label="描述"
          prompt="补充说明（可选）"
          observable={description}
          multiline
        />
      </Section>
    </FormSheet>
  )
}
