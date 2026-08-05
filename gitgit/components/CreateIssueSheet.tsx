import { Section, Text, useObservable } from "scripting"
import { FormRow } from "./FormRow"
import { FormSheet } from "./FormSheet"

export function CreateIssueSheet({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  onCancel: () => void
  onConfirm: (title: string, body: string) => void
}) {
  const title = useObservable("")
  const body = useObservable("")

  return (
    <FormSheet
      navigationTitle="新建 Issue"
      confirmTitle={busy ? "创建中…" : "创建"}
      confirmDisabled={busy || !title.value.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(title.value, body.value)}
    >
      <Section
        header={<Text>Issue 内容</Text>}
        footer={<Text>创建后可在详情页查看，并继续前往 GitHub 处理标签、指派与里程碑。</Text>}
      >
        <FormRow
          label="标题"
          prompt="简要描述问题（必填）"
          observable={title}
        />
        <FormRow
          label="描述"
          prompt="补充复现步骤或背景（可选）"
          observable={body}
          multiline
        />
      </Section>
    </FormSheet>
  )
}
