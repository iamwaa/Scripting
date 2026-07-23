/**
 * components/FormRow.tsx - 表单输入行
 *
 * 左侧固定宽标签 + 右侧 TextField/SecureField + 有内容时显示清空按钮。
 * 用于 List Section 内的文本输入，替代 TextField title 内置表单行。
 */

import {
  HStack,
  Text,
  TextField,
  SecureField,
  Button,
  Image,
} from "scripting"

export interface FormRowProps {
  /** 左侧标签文案 */
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  /** 为 true 时使用 SecureField（Token 等敏感输入） */
  secure?: boolean
}

/** 表单输入行：左标签、右输入、可选清空 */
export function FormRow({
  label,
  value,
  prompt,
  onChanged,
  secure = false,
}: FormRowProps) {
  const field = secure ? (
    <SecureField
      label={<Text>{label}</Text>}
      value={value}
      prompt={prompt}
      onChanged={onChanged}
    />
  ) : (
    <TextField
      label={<Text>{label}</Text>}
      value={value}
      prompt={prompt}
      onChanged={onChanged}
    />
  )

  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: 72, alignment: "leading" }}>{label}</Text>
      {field}
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle="plain">
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
