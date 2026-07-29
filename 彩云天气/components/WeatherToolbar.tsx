import { Button, HStack, Image, NavigationLink, type VirtualNode } from "scripting"

// 首页系统导航栏工具栏：左侧关闭，右侧定位 / 搜索 / 设置
export function createWeatherToolbar({
  onDismiss,
  onLocate,
  onSearch,
  settingsDestination,
}: {
  onDismiss: () => void
  onLocate: () => void
  onSearch: () => void
  settingsDestination: VirtualNode
}) {
  return {
    topBarLeading: (
      <Button
        title="关闭"
        systemImage="xmark"
        fontWeight="semibold"
        tint="red"
        action={onDismiss}
      />
    ),
    topBarTrailing: (
      <HStack spacing={14}>
        <Button title="" systemImage="location.fill" action={onLocate} />
        <Button title="" systemImage="magnifyingglass" action={onSearch} />
        <NavigationLink destination={settingsDestination}>
          <Image systemName="gearshape" />
        </NavigationLink>
      </HStack>
    ),
  }
}
