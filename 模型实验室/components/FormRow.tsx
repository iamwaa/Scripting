import { Button, HStack, Image, SecureField, Text, TextField } from "scripting"

export function FormRow({ label, value, prompt, onChanged, secure = false, multiline = false, labelWidth = 72 }: {
  label: string
  value: string
  prompt?: string
  onChanged: (value: string) => void
  secure?: boolean
  multiline?: boolean
  labelWidth?: number
}) {
  const field = secure
    ? <SecureField label={<Text>{label}</Text>} value={value} prompt={prompt} onChanged={onChanged} />
    : <TextField label={<Text>{label}</Text>} value={value} prompt={prompt} axis={multiline ? "vertical" : undefined} onChanged={onChanged} />
  return (
    <HStack alignment="center" spacing={10} frame={{ maxWidth: Infinity }}>
      <Text frame={{ width: labelWidth, alignment: "leading" }}>{label}</Text>
      {field}
      {value.length > 0 ? <Button action={() => onChanged("")} buttonStyle="plain"><Image systemName="xmark.circle.fill" foregroundStyle="tertiaryLabel" font={16} /></Button> : null}
    </HStack>
  )
}
