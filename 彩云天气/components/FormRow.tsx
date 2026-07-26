import { Button, HStack, Image, SecureField, Text, TextField } from "scripting"

// List 表单行：左标签 + 右输入 + 有内容可清空
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
  const field = secure ? (
    <SecureField label={<Text>{label}</Text>} value={value} prompt={prompt} onChanged={onChanged} />
  ) : (
    <TextField label={<Text>{label}</Text>} value={value} prompt={prompt} onChanged={onChanged} />
  )

  return (
    <HStack alignment="center" spacing={12} frame={{ maxWidth: "infinity" }}>
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
