import { useState, Text, TextField, SecureField, HStack, Button, Image } from "scripting"

// 带标签的文本输入框
export function LabeledTextField({ title, value, onChanged, prompt, axis }: { title: string, value: string, onChanged: (value: string) => void, prompt?: string, axis?: "horizontal" | "vertical" }) {
  const [focused, setFocused] = useState(false)
  return <HStack spacing={12}>
    <Text frame={{ width: 86, alignment: "leading" }} foregroundStyle="label">{title}</Text>
    <TextField title="" value={value} onChanged={onChanged} prompt={prompt} axis={axis as any} frame={{ maxWidth: "infinity" }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    {focused && value ? <Button action={() => onChanged("")}><Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" /></Button> : null}
  </HStack>
}

// 带标签的安全输入框
export function LabeledSecureField({ title, value, onChanged, prompt }: { title: string, value: string, onChanged: (value: string) => void, prompt?: string }) {
  const [focused, setFocused] = useState(false)
  return <HStack spacing={12}>
    <Text frame={{ width: 86, alignment: "leading" }} foregroundStyle="label">{title}</Text>
    <SecureField title="" value={value} onChanged={onChanged} prompt={prompt} frame={{ maxWidth: "infinity" }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    {focused && value ? <Button action={() => onChanged("")}><Image systemName="xmark.circle.fill" foregroundStyle="secondaryLabel" /></Button> : null}
  </HStack>
}
