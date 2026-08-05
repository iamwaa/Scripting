/**
 * components/FormRow.tsx - 表单输入行
 *
 * 左侧固定宽标签 + 右侧 TextField/SecureField + 有内容时显示清空按钮。
 * 用于 List Section 内的文本输入，替代 TextField title 内置表单行。
 *
 * 两种互斥用法：
 * - List 表单：value + onChanged（受控，父组件持有状态）
 * - 弹窗内部：observable（草稿由弹窗自身持有，避免父页逐字符重渲染）
 */

import {
  HStack,
  Text,
  TextField,
  SecureField,
  Button,
  Image,
} from "scripting"

type FormRowBaseProps = {
  /** 左侧标签文案 */
  label: string
  prompt?: string
  /** 为 true 时使用 SecureField（Token 等敏感输入） */
  secure?: boolean
  /** 为 true 时输入框纵向扩展，可换行（secure 时忽略） */
  multiline?: boolean
  /** 左侧标签宽度，标签较长时可调大 */
  labelWidth?: number
}

export type FormRowProps = FormRowBaseProps &
  (
    | {
        value: string
        onChanged: (value: string) => void
        observable?: never
      }
    | {
        observable: Observable<string>
        value?: never
        onChanged?: never
      }
  )

/** 表单输入行：左标签、右输入、可选清空 */
export function FormRow(props: FormRowProps) {
  const {
    label,
    prompt,
    secure = false,
    multiline = false,
    labelWidth = 72,
  } = props

  const observable = props.observable
  const text = observable ? observable.value : props.value
  const clear = () => {
    if (observable) observable.setValue("")
    else props.onChanged("")
  }

  // observable 模式下把 Observable 直接交给输入框，不传 onChanged
  const field = secure ? (
    observable ? (
      <SecureField
        label={<Text>{label}</Text>}
        value={observable}
        prompt={prompt}
      />
    ) : (
      <SecureField
        label={<Text>{label}</Text>}
        value={props.value}
        prompt={prompt}
        onChanged={props.onChanged}
      />
    )
  ) : observable ? (
    <TextField
      label={<Text>{label}</Text>}
      value={observable}
      prompt={prompt}
      axis={multiline ? "vertical" : undefined}
    />
  ) : (
    <TextField
      label={<Text>{label}</Text>}
      value={props.value}
      prompt={prompt}
      axis={multiline ? "vertical" : undefined}
      onChanged={props.onChanged}
    />
  )

  return (
    <HStack
      alignment={multiline ? "top" : "center"}
      spacing={12}
      frame={{ maxWidth: Infinity }}
    >
      <Text frame={{ width: labelWidth, alignment: "leading" }}>{label}</Text>
      {field}
      {text.length > 0 ? (
        <Button action={clear} buttonStyle="plain">
          <Image
            systemName="xmark.circle.fill"
            font={16}
            foregroundStyle="tertiaryLabel"
          />
        </Button>
      ) : null}
    </HStack>
  )
}
