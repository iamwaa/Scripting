import { HStack, VStack, Text, ProgressView, useEffect, useState, fetch } from "scripting"
import type { ResourceItem } from "../types/resource"

export function TextPreview({ resource }: { resource: ResourceItem }) {
  const [textContent, setTextContent] = useState("")
  const [textLoading, setTextLoading] = useState(true)
  const [textError, setTextError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadText() {
      setTextLoading(true)
      setTextError(false)
      try {
        const response = await fetch(resource.url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const raw = await response.text()
        if (!cancelled) {
          setTextContent(raw.length > 2000 ? raw.substring(0, 2000) : raw)
        }
      } catch (e) {
        if (!cancelled) setTextError(true)
      } finally {
        if (!cancelled) setTextLoading(false)
      }
    }
    loadText()
    return () => { cancelled = true }
  }, [resource.url])

  if (textLoading) {
    return (
      <HStack spacing={8} padding={{ vertical: 8 }}>
        <ProgressView />
        <Text font="caption" foregroundStyle="secondaryLabel">
          正在加载预览...
        </Text>
      </HStack>
    )
  }

  if (textError || !textContent) {
    return (
      <Text font="caption" foregroundStyle="secondaryLabel" padding={{ vertical: 8 }}>
        无法加载预览内容
      </Text>
    )
  }

  return (
    <VStack alignment="center" spacing={6}>
      <Text
        font="caption2"
        foregroundStyle="label"
        lineLimit={30}
        textSelection
        monospaced
      >
        {textContent}
      </Text>
      {textContent.length >= 2000 || textContent.split('\n').length > 30 ? (
        <Text font="caption2" foregroundStyle="secondaryLabel">
          点击查看完整内容
        </Text>
      ) : null}
    </VStack>
  )
}
