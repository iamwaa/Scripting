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

import { sauceCreator, sauceSubtitle, sauceTitle, searchSauceNao, type SauceNaoResult } from "./sauceNaoService"

type SauceNaoResultPageProps = {
  imageURL: string
}

export function SauceNaoResultPage({ imageURL }: SauceNaoResultPageProps) {
  const [results, setResults] = useState<SauceNaoResult[]>([])
  const [status, setStatus] = useState("正在搜索图片来源…")
  const [isLoading, setIsLoading] = useState(true)
  const dismiss = Navigation.useDismiss()

  async function loadResults() {
    setIsLoading(true)
    setStatus("正在搜索图片来源…")
    try {
      const nextResults = await searchSauceNao(imageURL)
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
        navigationTitle="SauceNAO"
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button title="关闭" systemImage="chevron.left" fontWeight="semibold" action={dismiss} />
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

        {results.map((result, index) => {
          const firstURL = result.data?.ext_urls?.[0]
          const creator = sauceCreator(result)
          return (
            <Section title={`结果 ${index + 1}`}>
              <VStack alignment="leading" spacing={8}>
                {result.header?.thumbnail ? (
                  <Image imageUrl={result.header.thumbnail} resizable scaleToFit frame={{ maxHeight: 180 }} />
                ) : null}
                <Text font="headline">{sauceTitle(result)}</Text>
                <Text>{sauceSubtitle(result)}</Text>
                {creator ? <Text foregroundStyle="gray">{creator}</Text> : null}
                {firstURL ? (
                  <Link url={firstURL}>
                    <HStack spacing={8}>
                      <Image systemName="link" frame={{ width: 22, height: 22 }} foregroundStyle="accentColor" />
                      <Text foregroundStyle="accentColor">打开来源页面</Text>
                    </HStack>
                  </Link>
                ) : null}
              </VStack>
            </Section>
          )
        })}
      </Form>
    </NavigationStack>
  )
}
