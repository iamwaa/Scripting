import { HStack, Text, TextField, SecureField, Button, Image } from "scripting"

// List / 设置页统一文本输入行
export function FormRow({
  label,
  value,
  prompt,
  onChanged,
  secure = false,
  labelWidth = 72,
}: {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  secure?: boolean
  labelWidth?: number
}) {
  // label 保留给无障碍朗读；prompt 兜底一个空格，避免字段把 label 当占位符导致标签显示两次
  const fieldProps = {
    label: <Text>{label}</Text>,
    value,
    prompt: prompt ?? " ",
    onChanged,
  }
  const field = secure ? <SecureField {...fieldProps} /> : <TextField {...fieldProps} />
  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: labelWidth, alignment: "leading" }}>{label}</Text>
      {field}
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" font={16} foregroundStyle="tertiaryLabel" />
        </Button>
      ) : null}
    </HStack>
  )
}
