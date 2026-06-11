import {
  Button,
  Form,
  HStack,
  Image,
  Link,
  Navigation,
  NavigationStack,
  Section,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  useEffect,
  useState,
} from "scripting"

import { formatSimilarity, formatTraceTime, searchTraceMoe, traceTitle, type TraceMoeResult } from "./traceMoeService"

type TraceMoeResultPageProps = {
  imageURL: string
}

export function TraceMoeResultPage({ imageURL }: TraceMoeResultPageProps) {
  const [results, setResults] = useState<TraceMoeResult[]>([])
  const [status, setStatus] = useState("正在搜索动画截图来源…")
  const [isLoading, setIsLoading] = useState(true)
  const dismiss = Navigation.useDismiss()

  async function loadResults() {
    setIsLoading(true)
    setStatus("正在搜索动画截图来源…")
    try {
      const nextResults = await searchTraceMoe(imageURL)
      setResults(nextResults)
      setStatus(nextResults.length > 0 ? `找到 ${nextResults.length} 条结果` : "没有找到匹配结果")
    } catch (error) {
      setStatus(`搜索失败：${String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadResults()
  }, [imageURL])

  return (
    <NavigationStack>
      <Form
        navigationTitle="TraceMoe"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button title="返回" systemImage="chevron.left" fontWeight="semibold" action={dismiss} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button title="刷新" systemImage="arrow.clockwise" fontWeight="semibold" action={() => void loadResults()} disabled={isLoading} />
            </ToolbarItem>
          </Toolbar>
        }
      >
        <Section>
          <Text>{status}</Text>
        </Section>

        {results.map((result, index) => (
          <Section title={`结果 ${index + 1}`}>
            <VStack alignment="leading" spacing={8}>
              {result.image ? <Image imageUrl={result.image} resizable scaleToFit frame={{ maxHeight: 180 }} /> : null}
              <Text font="headline">{traceTitle(result)}</Text>
              <Text>{`相似度：${formatSimilarity(result.similarity)}`}</Text>
              <Text>{`集数：${result.episode ?? "未知"}`}</Text>
              <Text>{`时间：${formatTraceTime(result.from)} - ${formatTraceTime(result.to)}`}</Text>
              {result.filename ? <Text foregroundStyle="gray">{result.filename}</Text> : null}
              {result.video ? (
                <Link url={result.video}>
                  <HStack spacing={8}>
                    <Image systemName="play.rectangle.fill" frame={{ width: 22, height: 22 }} foregroundStyle="accentColor" />
                    <Text foregroundStyle="accentColor">打开预览视频</Text>
                  </HStack>
                </Link>
              ) : null}
            </VStack>
          </Section>
        ))}
      </Form>
    </NavigationStack>
  )
}
