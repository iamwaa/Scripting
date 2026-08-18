import { Button, Group, HStack, VStack, Image, Text, Navigation, ZStack } from "scripting"
import type { ResourceItem } from "../types/resource"
import { WebURL } from "../utils/WebURL"
import { getTypeInfo } from "../functions/resourceInfo"
import { ResourceDetailView } from "../pages/ResourceDetailView"
import { showToast } from "../state/appState"
import { enqueueResourceDownload } from "../state/downloadManager"

export function ResourceItemRow({ item }: { item: ResourceItem }) {
  const info = getTypeInfo(item.type)
  let host = ""
  try {
    host = new WebURL(item.url).host
  } catch (e) {
    host = ""
  }
  const metadata = [item.source, item.quality, item.format, host].filter(Boolean).join(" · ")

  return (
    <Button
      buttonStyle="plain"
      action={() => Navigation.present(<ResourceDetailView resource={item} />)}
      contextMenu={{
        menuItems: (
          <Group>
            <Button
              title="下载"
              systemImage="arrow.down.circle"
              action={() => {
                enqueueResourceDownload(item)
                showToast("正在下载…")
              }}
            />
            <Button
              title="复制链接"
              systemImage="doc.on.doc"
              action={async () => {
                await Pasteboard.setString(item.url)
                showToast("资源链接已复制")
              }}
            />
            <Button
              title="用浏览器打开"
              systemImage="safari"
              action={async () => { await Safari.present(item.url) }}
            />
          </Group>
        ),
      }}
    >
      <HStack spacing={10} padding={-8}>
        {item.type === "image" ? (
          <ZStack
            frame={{ width: 50, height: 50 }}
            background={{ style: "ultraThinMaterial", shape: { type: 'rect', cornerRadius: 10 } }}
            border={{ style: { light: "rgba(209,209,214,0.55)", dark: "rgba(235,235,245,0.22)" }, width: 0.5 }}
            shadow={{ color: "rgba(0,0,0,0.035)", radius: 14, x: 0, y: 1 }}
            clipShape={{ type: 'rect', cornerRadius: 10 }}
          >
            <Image
              imageUrl={item.url}
              resizable
              aspectRatio={{ value: 1, contentMode: "fit" }}
              padding={3}
              frame={{ width: 50, height: 50 }}
            />
          </ZStack>
        ) : item.type === "video" ? (
          <Image
            systemName="film"
            resizable
            frame={{ width:30, height: 30 }}
            tint="accentColor"
          />
        ) : (
          <Image
            systemName={info.icon}
            resizable
            frame={{ width: 30, height: 30 }}
            tint="accentColor"
          />
        )}
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text
              font={12}
              fontWeight="medium"
              foregroundStyle="white"
              padding={{ horizontal: 6, vertical: 2 }}
              background={info.color}
              clipShape={{ type: 'rect', cornerRadius: 4 }}
            >
              {info.label}
            </Text>
            <Text font={15} lineLimit={1}>
              {item.name}
            </Text>
          </HStack>
          <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>
            {metadata || item.url}
          </Text>
        </VStack>
      </HStack>
    </Button>
  )
}
