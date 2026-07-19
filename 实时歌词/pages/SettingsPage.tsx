import {
  Button,
  HStack,
  List,
  NavigationStack,
  Section,
  Spacer,
  Stepper,
  Text,
  Toggle,
  VStack,
} from "scripting"
import { CloseButton, CacheStats } from "./LyricsTabs"

type SettingsPageProps = {
  offsetText: string
  lyricsPageOffsetEnabled: boolean
  openMusic: boolean
  locationKeepAlive: boolean
  adaptiveKeepAlive: boolean
  cache: CacheStats
  onClose: () => void
  onIncrementOffset: () => void
  onDecrementOffset: () => void
  onLyricsPageOffsetChanged: (value: boolean) => void
  onOpenMusicChanged: (value: boolean) => void
  onLocationKeepAliveChanged: (value: boolean) => void
  onAdaptiveKeepAliveChanged: (value: boolean) => void
  onClearCache: () => void
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    offsetText,
    lyricsPageOffsetEnabled,
    openMusic,
    locationKeepAlive,
    adaptiveKeepAlive,
    cache,
    onClose,
    onIncrementOffset,
    onDecrementOffset,
    onLyricsPageOffsetChanged,
    onOpenMusicChanged,
    onLocationKeepAliveChanged,
    onAdaptiveKeepAliveChanged,
    onClearCache,
  } = props

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <CloseButton onClose={onClose} /> }}
      >
        <Section title="歌词同步">
          <HStack spacing={12} frame={{ maxWidth: Infinity, alignment: "center" }}>
            <VStack alignment="leading" spacing={3}>
              <Text font="body">时间偏移</Text>
              <Text font="caption" foregroundStyle="gray">正值延迟，负值提早</Text>
            </VStack>
            <Spacer minLength={0} />
            <Stepper onIncrement={onIncrementOffset} onDecrement={onDecrementOffset}>
              <Text font="body" fontWeight="semibold">{offsetText}</Text>
            </Stepper>
          </HStack>
          <Toggle
            title="歌词页应用偏移"
            value={lyricsPageOffsetEnabled}
            onChanged={onLyricsPageOffsetChanged}
          />
        </Section>

        <Section title="播放">
          <Toggle title="开启后打开 Apple Music" value={openMusic} onChanged={onOpenMusicChanged} />
        </Section>

        <Section title="后台运行">
          <VStack alignment="leading" spacing={5} frame={{ maxWidth: Infinity, alignment: "topLeading" }}>
            <Toggle
              title="定位保活"
              value={locationKeepAlive}
              onChanged={onLocationKeepAliveChanged}
            />
            <Text font="caption" foregroundStyle="gray">
              需要将 Scripting 定位权限设为"始终"，开启后会增加耗电。
            </Text>
          </VStack>
          {locationKeepAlive ? (
            <VStack alignment="leading" spacing={5} frame={{ maxWidth: Infinity, alignment: "topLeading" }}>
              <Toggle
                title="自适应保活"
                value={adaptiveKeepAlive}
                onChanged={onAdaptiveKeepAliveChanged}
              />
              <Text font="caption" foregroundStyle="gray">
                暂停播放时自动停止定位，恢复播放后再次启动。
              </Text>
            </VStack>
          ) : null}
        </Section>

        <Section title="缓存">
          <HStack frame={{ maxWidth: Infinity, alignment: "center" }}>
            <Text>歌词</Text>
            <Spacer />
            <Text foregroundStyle="gray">{cache.lyrics} 条</Text>
          </HStack>
          <HStack frame={{ maxWidth: Infinity, alignment: "center" }}>
            <Text>封面</Text>
            <Spacer />
            <Text foregroundStyle="gray">{cache.artworks} 张</Text>
          </HStack>
          <HStack frame={{ maxWidth: Infinity, alignment: "center" }}>
            <Text>更新时间</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="gray">
              {cache.updatedAt ? new Date(cache.updatedAt * 1000).toLocaleString() : "—"}
            </Text>
          </HStack>
          <Button title="清除缓存" systemImage="trash" tint="red" action={onClearCache} />
        </Section>
      </List>
    </NavigationStack>
  )
}