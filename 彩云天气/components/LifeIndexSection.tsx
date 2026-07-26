import { HStack, Image, Text, VStack } from "scripting"
import type { DailyWeather, LifeIndexItem, RealtimeWeather } from "../types"
import { textColor, weatherCardProps } from "./tokens"

type IndexRow = {
  key: string
  title: string
  icon: string
  desc: string
}

function pickToday(items?: LifeIndexItem[]): LifeIndexItem | undefined {
  if (!items?.length) return undefined
  return items[0]
}

function formatDesc(item?: LifeIndexItem | null, fallback?: string): string | null {
  const desc = item?.desc?.trim() || fallback?.trim()
  if (!desc) return null
  return desc
}

function IndexChip({
  title,
  icon,
  desc,
}: {
  title: string
  icon: string
  desc: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={12}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      background={{
        style: {
          light: "rgba(120,120,128,0.10)",
          dark: "rgba(120,120,128,0.18)",
        },
        shape: { type: "rect", cornerRadius: 14, style: "continuous" },
      }}
    >
      <HStack spacing={6}>
        <Image systemName={icon} font={13} foregroundStyle="systemBlue" />
        <Text font="caption" fontWeight="semibold" foregroundStyle={textColor.secondary}>
          {title}
        </Text>
      </HStack>
      <Text font={14} fontWeight="medium" foregroundStyle={textColor.primary} lineLimit={2}>
        {desc}
      </Text>
    </VStack>
  )
}

// 今日生活指数详情：优先 daily.life_index，回退 realtime.life_index
export function LifeIndexSection({
  realtime,
  daily,
}: {
  realtime?: RealtimeWeather
  daily?: DailyWeather
}) {
  const life = daily?.life_index
  const rows: IndexRow[] = []

  const comfortDaily = pickToday(life?.comfort)
  const comfortDesc = formatDesc(comfortDaily, realtime?.life_index?.comfort?.desc)
  if (comfortDesc) {
    rows.push({
      key: "comfort",
      title: "舒适度",
      icon: "face.smiling",
      desc: comfortDesc,
    })
  }

  const dressing = pickToday(life?.dressing)
  const dressingDesc = formatDesc(dressing)
  if (dressingDesc) {
    rows.push({
      key: "dressing",
      title: "穿衣",
      icon: "tshirt.fill",
      desc: dressingDesc,
    })
  }

  const cold = pickToday(life?.coldRisk)
  const coldDesc = formatDesc(cold)
  if (coldDesc) {
    rows.push({
      key: "cold",
      title: "感冒",
      icon: "thermometer.medium",
      desc: coldDesc,
    })
  }

  const wash = pickToday(life?.carWashing)
  const washDesc = formatDesc(wash)
  if (washDesc) {
    rows.push({
      key: "wash",
      title: "洗车",
      icon: "car.fill",
      desc: washDesc,
    })
  }

  if (rows.length === 0) return null

  // 两两一行
  const pairs: IndexRow[][] = []
  for (let i = 0; i < rows.length; i += 2) {
    pairs.push(rows.slice(i, i + 2))
  }

  return (
    <VStack alignment="leading" spacing={12} {...weatherCardProps}>
      <Text font="headline" foregroundStyle={textColor.primary}>
        生活指数
      </Text>
      {pairs.map((pair, idx) => (
        <HStack key={`life-row-${idx}`} spacing={10} frame={{ maxWidth: "infinity" }}>
          {pair.map(item => (
            <IndexChip
              key={item.key}
              title={item.title}
              icon={item.icon}
              desc={item.desc}
            />
          ))}
          {/* 奇数项时补空白占位，保持两列对齐 */}
          {pair.length === 1 ? (
            <VStack frame={{ maxWidth: "infinity" }} />
          ) : null}
        </HStack>
      ))}
    </VStack>
  )
}
