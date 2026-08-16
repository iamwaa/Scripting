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
  autoCloseInactiveMinutes: number
  cache: CacheStats
  onClose: () => void
  onIncrementOffset: () => void
  onDecrementOffset: () => void
  onLyricsPageOffsetChanged: (value: boolean) => void
  onOpenMusicChanged: (value: boolean) => void
  onLocationKeepAliveChanged: (value: boolean) => void
  onAdaptiveKeepAliveChanged: (value: boolean) => void
  onAutoCloseInactiveMinutesChanged: (value: number) => void
  onClearCache: () => void
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    offsetText,
    lyricsPageOffsetEnabled,
    openMusic,
    locationKeepAlive,
    adaptiveKeepAlive,
    autoCloseInactiveMinutes,
    cache,
    onClose,
    onIncrementOffset,
    onDecrementOffset,
    onLyricsPageOffsetChanged,
    onOpenMusicChanged,
    onLocationKeepAliveChanged,
    onAdaptiveKeepAliveChanged,
    onAutoCloseInactiveMinutesChanged,
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
              <Text font={13} foregroundStyle="gray">
                暂停时停止定位以节省电量，实时活动保持显示；恢复播放后再次启动定位。
              </Text>
            </VStack>
          ) : null}
          <VStack alignment="leading" spacing={5} frame={{ maxWidth: Infinity, alignment: "topLeading" }}>
            <HStack spacing={12} frame={{ maxWidth: Infinity, alignment: "center" }}>
              <Text font={16}>不活跃自动关闭</Text>
              <Spacer minLength={0} />
              <Stepper
                onIncrement={() => onAutoCloseInactiveMinutesChanged(autoCloseInactiveMinutes + 1)}
                onDecrement={() => onAutoCloseInactiveMinutesChanged(autoCloseInactiveMinutes - 1)}
              >
                <Text font={16} fontWeight="semibold">
                  {autoCloseInactiveMinutes > 0 ? `${autoCloseInactiveMinutes} 分钟` : "永不"}
                </Text>
              </Stepper>
            </HStack>
            <Text font={13} foregroundStyle="gray">
              只有在后台/最小化且歌曲已暂停时才计时；回到前台或恢复播放会取消计时。
            </Text>
          </VStack>
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