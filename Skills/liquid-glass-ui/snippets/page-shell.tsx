/**
 * 液态玻璃页面骨架示例
 * 展示：PageBackground + 隐藏系统 List 底 + 玻璃行 + 空态 + toolbar
 * 表面通过 glassRowProps / GlassCard 自动在 iOS 26+ 与 Material 回退间切换
 */

import {
  Button,
  ContentUnavailableView,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { PageBackground } from "./PageBackground"
import { AnimText, GlassBadge, GlassCard, GlassTag } from "./components"
import { glassRowProps, plainListChrome, textColor } from "./tokens"

function CloseButton() {
  return <Button title="" systemImage="xmark" action={Navigation.useDismiss()} />
}

function DemoRow({ title, meta }: { title: string; meta: string }) {
  return (
    <VStack alignment="leading" spacing={8} {...glassRowProps}>
      <HStack spacing={8}>
        <Text font="body" fontWeight="semibold" foregroundStyle={textColor.primary}>
          {title}
        </Text>
      </HStack>
      <HStack spacing={4}>
        <GlassTag>{meta}</GlassTag>
        <GlassBadge style="info">
          <Text font={12} fontWeight="medium" foregroundStyle="systemBlue">
            活跃
          </Text>
        </GlassBadge>
      </HStack>
    </VStack>
  )
}

export default function LiquidGlassDemoPage() {
  const items = [
    { id: "1", title: "示例项目 A", meta: "v1.0" },
    { id: "2", title: "示例项目 B", meta: "v2.3" },
  ]

  return (
    <NavigationStack>
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <PageBackground />
        <List
          {...plainListChrome}
          navigationTitle="液态玻璃"
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            topBarLeading: <CloseButton />,
            topBarTrailing: (
              <Button title="" systemImage="gearshape" action={() => {}} />
            ),
          }}
          overlay={
            items.length === 0 ? (
              <ContentUnavailableView
                title="暂无内容"
                systemImage="sparkles"
                description="添加项目后将显示在这里"
              />
            ) : undefined
          }
        >
          <Section
            header={
              <HStack spacing={6} padding={{ bottom: 4 }}>
                <AnimText font={14} foregroundStyle={textColor.primary}>
                  项目列表
                </AnimText>
                <GlassBadge style="neutral">
                  <Text font={12} fontWeight="medium">
                    共{items.length}项
                  </Text>
                </GlassBadge>
              </HStack>
            }
          >
            {items.map(item => (
              <DemoRow key={item.id} title={item.title} meta={item.meta} />
            ))}
          </Section>

          <Section>
            <GlassCard>
              <AnimText font="callout" foregroundStyle={textColor.secondary}>
                这是一块独立玻璃卡片，适合表单、登录历史、设置摘要等非列表行内容。
              </AnimText>
            </GlassCard>
          </Section>
        </List>
      </ZStack>
    </NavigationStack>
  )
}

// 入口用法：
// await Navigation.present({ element: <LiquidGlassDemoPage /> })
// Script.exit()
