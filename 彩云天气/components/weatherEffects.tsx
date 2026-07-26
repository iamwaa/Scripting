/**
 * 天气背景动画效果层（雨/雪/云/雾/阳光晕/星空/闪电）
 * 仅被 WeatherBackground 使用
 *
 * 运行时注意（探针实测）：
 * - animation modifier 的 repeatForever 在本环境不循环，动画只跑一程
 * - 同一视图树上嵌套两个不同 value 的 animation modifier 会互相干扰
 * - blur / shadow 发光对 Shape 无效，柔和感一律用渐变与低透明叠加
 * - 因此：下落类用 key 重建循环；往返类用 setTimeout 交替 state（usePingPong）
 * - 效果层必须用固定 SCREEN 尺寸铺满；勿再写 ignoresSafeArea，避免撑破 List 安全区
 */

import {
  Capsule,
  Circle,
  Ellipse,
  Image,
  Rectangle,
  ZStack,
  useEffect,
  useMemo,
  useState,
  type Color,
  type DynamicShapeStyle,
} from "scripting"

const { width: SCREEN_W, height: SCREEN_H } = Device.screen

const rand = (min: number, max: number) => min + Math.random() * (max - min)

// 挂载后翻转开关，驱动本粒子的单程动画
function useAutoStart() {
  const [go, setGo] = useState(false)
  useEffect(() => {
    setGo(true)
  }, [])
  return go
}

// 周期往返开关：delay 后每 halfPeriod 秒翻转一次，配合 animation modifier 做往返动画
function usePingPong(halfPeriod: number, delay = 0) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      if (cancelled) return
      setOn(v => !v)
      timer = setTimeout(tick, halfPeriod * 1000)
    }
    timer = setTimeout(tick, delay * 1000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [halfPeriod, delay])
  return on
}

/** 全屏效果宿主：固定屏幕尺寸 + 裁切，保证粒子按整屏坐标分布 */
export function EffectsStage({ children }: { children: any }) {
  return (
    <ZStack
      frame={{ width: SCREEN_W, height: SCREEN_H }}
      clipped={true}
      allowsHitTesting={false}
    >
      {/* 透明底图锚定尺寸，避免仅有 offset 子视图时 ZStack 收缩 */}
      <Rectangle
        fill="clear"
        frame={{ width: SCREEN_W, height: SCREEN_H }}
        allowsHitTesting={false}
      />
      {children}
    </ZStack>
  )
}

// ── 雨 ────────────────────────────────────────────────

const rainLevelConfig = {
  1: { count: 14, farCount: 6, duration: [1.3, 1.9], length: [10, 16], width: 1.5 },
  2: { count: 20, farCount: 8, duration: [1.05, 1.55], length: [12, 19], width: 1.8 },
  3: { count: 28, farCount: 10, duration: [0.85, 1.25], length: [14, 22], width: 2 },
  4: { count: 36, farCount: 12, duration: [0.62, 1.0], length: [16, 28], width: 2.2 },
} as const

type DropSpec = {
  x: number
  firstY: number
  firstDuration: number
  length: number
  duration: number
  opacity: number
  width: number
  far: boolean
}

// 雨丝倾斜角 14°，下落同时带水平漂移，方向与雨丝一致
const RAIN_TILT_DEGREES = 14
const RAIN_DRIFT = SCREEN_H * 0.24

// 单次下落；动画跑完后由父级换 key 重建，回到屏顶开始下一轮
function RainDropOnce({
  drop,
  startY,
  duration,
  onDone,
}: {
  drop: DropSpec
  startY: number
  duration: number
  onDone: () => void
}) {
  const go = useAutoStart()
  useEffect(() => {
    const timer = setTimeout(onDone, duration * 1000 + 100)
    return () => clearTimeout(timer)
  }, [])
  const drift = drop.far ? RAIN_DRIFT * 0.55 : RAIN_DRIFT
  return (
    <Capsule
      fill={
        drop.far
          ? { light: "rgba(70,100,135,0.28)", dark: "rgba(180,205,230,0.28)" }
          : { light: "rgba(55,85,120,0.62)", dark: "rgba(195,220,245,0.62)" }
      }
      frame={{ width: drop.width, height: drop.length }}
      rotationEffect={{ degrees: RAIN_TILT_DEGREES, anchor: "center" }}
      opacity={drop.opacity}
      offset={{
        x: drop.x + (go ? drift / 2 : -drift / 2),
        y: go ? SCREEN_H / 2 + 48 : startY,
      }}
      animation={{
        animation: Animation.linear(duration),
        value: go,
      }}
    />
  )
}

function RainDrop({ drop }: { drop: DropSpec }) {
  const [cycle, setCycle] = useState(0)
  // 首轮起点随机分布在屏内，打开即是满屏雨幕；之后从屏顶循环
  const first = cycle === 0
  return (
    <RainDropOnce
      key={cycle}
      drop={drop}
      startY={first ? drop.firstY : -(SCREEN_H / 2 + 48)}
      duration={first ? drop.firstDuration : drop.duration}
      onDone={() => setCycle(c => c + 1)}
    />
  )
}

function makeDrops(
  count: number,
  durationRange: readonly [number, number],
  lengthRange: readonly [number, number],
  width: number,
  far: boolean
): DropSpec[] {
  return Array.from({ length: count }, () => {
    const duration = rand(durationRange[0], durationRange[1]) * (far ? 1.35 : 1)
    const firstY = rand(-(SCREEN_H / 2 + 48), SCREEN_H / 2)
    const travel = SCREEN_H + 96
    const firstDuration = Math.max(0.2, duration * ((SCREEN_H / 2 + 48 - firstY) / travel))
    const drift = far ? RAIN_DRIFT * 0.55 : RAIN_DRIFT
    return {
      // 把横向漂移计入边界，避免雨滴长期被 EffectsStage 裁掉
      x: rand(-SCREEN_W / 2 + drift / 2 + 6, SCREEN_W / 2 - drift / 2 - 6),
      firstY,
      firstDuration,
      length: rand(lengthRange[0], lengthRange[1]) * (far ? 0.72 : 1),
      duration,
      opacity: far ? rand(0.2, 0.4) : rand(0.42, 0.78),
      width: far ? Math.max(1, width * 0.7) : width,
      far,
    }
  })
}

export function RainLayer({ level }: { level: number }) {
  const config = rainLevelConfig[level as keyof typeof rainLevelConfig] ?? rainLevelConfig[2]
  const drops = useMemo<DropSpec[]>(
    () => [
      ...makeDrops(config.farCount, config.duration, config.length, config.width, true),
      ...makeDrops(config.count, config.duration, config.length, config.width, false),
    ],
    [level]
  )
  return (
    <>
      {drops.map((drop, index) => (
        <RainDrop key={`${level}-${index}`} drop={drop} />
      ))}
    </>
  )
}

// ── 雪 ────────────────────────────────────────────────

const snowLevelConfig = {
  1: { count: 18, duration: [5.2, 8], size: [3.5, 5.5] },
  2: { count: 28, duration: [4.6, 7.2], size: [4, 6.5] },
  3: { count: 38, duration: [4, 6.4], size: [4.5, 7.5] },
  4: { count: 50, duration: [3.4, 5.6], size: [5, 9] },
} as const

type FlakeSpec = {
  x: number
  firstY: number
  firstDuration: number
  size: number
  duration: number
  drift: number
  opacity: number
}

// 单次飘落；嵌套双动画在此环境会互相干扰，斜漂与下落合并到同一动画
function SnowFlakeOnce({
  flake,
  startY,
  duration,
  onDone,
}: {
  flake: FlakeSpec
  startY: number
  duration: number
  onDone: () => void
}) {
  const go = useAutoStart()
  useEffect(() => {
    const timer = setTimeout(onDone, duration * 1000 + 100)
    return () => clearTimeout(timer)
  }, [])
  return (
    <Circle
      fill={{ light: "rgba(125,150,180,0.95)", dark: "rgba(255,255,255,0.92)" }}
      frame={{ width: flake.size, height: flake.size }}
      opacity={flake.opacity}
      offset={{
        x: flake.x + (go ? flake.drift : 0),
        y: go ? SCREEN_H / 2 + 36 : startY,
      }}
      animation={{
        animation: Animation.linear(duration),
        value: go,
      }}
    />
  )
}

function SnowFlake({ flake }: { flake: FlakeSpec }) {
  const [cycle, setCycle] = useState(0)
  // 首轮起点随机分布在屏内，打开即是满屏雪幕；之后从屏顶循环
  const first = cycle === 0
  return (
    <SnowFlakeOnce
      key={cycle}
      flake={flake}
      startY={first ? flake.firstY : -(SCREEN_H / 2 + 36)}
      duration={first ? flake.firstDuration : flake.duration}
      onDone={() => setCycle(c => c + 1)}
    />
  )
}

export function SnowLayer({ level }: { level: number }) {
  const config = snowLevelConfig[level as keyof typeof snowLevelConfig] ?? snowLevelConfig[2]
  const flakes = useMemo<FlakeSpec[]>(
    () =>
      Array.from({ length: config.count }, () => {
        const duration = rand(config.duration[0], config.duration[1])
        const firstY = rand(-(SCREEN_H / 2 + 36), SCREEN_H / 2)
        const travel = SCREEN_H + 72
        const firstDuration = Math.max(0.35, duration * ((SCREEN_H / 2 + 36 - firstY) / travel))
        return {
          x: rand(-SCREEN_W / 2 + 4, SCREEN_W / 2 - 4),
          firstY,
          firstDuration,
          size: rand(config.size[0], config.size[1]),
          duration,
          drift: rand(-42, 42),
          opacity: rand(0.45, 0.92),
        }
      }),
    [level]
  )
  return (
    <>
      {flakes.map((flake, index) => (
        <SnowFlake key={`${level}-${index}`} flake={flake} />
      ))}
    </>
  )
}

// ── 云（单一矢量云形，缓慢横向飘动） ────────────────────
// 使用 SF Symbol 的完整轮廓，避免透明椭圆交叠产生圈和深浅接缝

type CloudSpec = {
  x: number
  y: number
  width: number
  drift: number
  halfPeriod: number
  delay: number
  alpha: number
}

// 雾层仍用横向薄带
type BandSpec = {
  y: number
  height: number
  widthFactor: number
  drift: number
  halfPeriod: number
  delay: number
}

function cloudTint(alpha: number): DynamicShapeStyle {
  return {
    light: {
      colors: [
        `rgba(248,251,253,${alpha})` as Color,
        `rgba(235,242,247,${alpha * 0.5})` as Color,
      ],
      startPoint: "top",
      endPoint: "bottom",
    },
    dark: {
      colors: [
        `rgba(180,195,214,${alpha * 0.68})` as Color,
        `rgba(135,153,177,${alpha * 0.34})` as Color,
      ],
      startPoint: "top",
      endPoint: "bottom",
    },
  }
}

function CloudBlob({ cloud }: { cloud: CloudSpec }) {
  const on = usePingPong(cloud.halfPeriod, cloud.delay)
  return (
    <Image
      systemName="cloud.fill"
      resizable={true}
      renderingMode="template"
      interpolation="high"
      antialiased={true}
      scaleToFit={true}
      foregroundStyle={cloudTint(cloud.alpha)}
      frame={{ width: cloud.width, height: cloud.width * 0.58 }}
      offset={{
        x: cloud.x + (on ? cloud.drift : -cloud.drift),
        y: cloud.y,
      }}
      animation={{
        animation: Animation.smooth({ duration: cloud.halfPeriod }),
        value: on,
      }}
      allowsHitTesting={false}
    />
  )
}

export function CloudLayer({
  dense,
  alpha,
  windy = false,
}: {
  dense: boolean
  alpha?: number
  windy?: boolean
}) {
  const clouds = useMemo<CloudSpec[]>(() => {
    const baseAlpha = alpha ?? (dense ? 0.26 : 0.21)
    const layout = dense
      ? [
          { x: -SCREEN_W * 0.3, y: -SCREEN_H * 0.37, width: 190, depth: 0.95 },
          { x: SCREEN_W * 0.29, y: -SCREEN_H * 0.3, width: 142, depth: 0.72 },
          { x: SCREEN_W * 0.02, y: -SCREEN_H * 0.18, width: 215, depth: 0.55 },
        ]
      : [
          { x: -SCREEN_W * 0.28, y: -SCREEN_H * 0.35, width: 168, depth: 0.86 },
          { x: SCREEN_W * 0.3, y: -SCREEN_H * 0.23, width: 132, depth: 0.62 },
        ]

    return layout.map(item => ({
      x: item.x + rand(-14, 14),
      y: item.y + rand(-10, 10),
      width: item.width * rand(0.92, 1.08),
      // 普通云也需肉眼可辨；大风天气更快、更远
      drift: windy ? rand(105, 155) : rand(62, 96),
      halfPeriod: windy ? rand(5.5, 8) : rand(8.5, 13),
      delay: rand(0, 0.8),
      alpha: baseAlpha * item.depth,
    }))
  }, [dense, alpha, windy])

  return (
    <>
      {clouds.map((cloud, index) => (
        <CloudBlob key={index} cloud={cloud} />
      ))}
    </>
  )
}

// ── 雾 / 霾（中部薄雾带，缓慢往返） ─────────────────────

function mistBandFill(alpha: number, lightRgb: string, darkRgb: string): DynamicShapeStyle {
  return {
    light: {
      stops: [
        { color: `rgba(${lightRgb},${alpha * 0.72})` as Color, location: 0 },
        { color: `rgba(${lightRgb},${alpha * 0.48})` as Color, location: 0.48 },
        { color: `rgba(${lightRgb},0)` as Color, location: 1 },
      ],
      center: "center",
      startRadius: 0,
      endRadius: SCREEN_W * 0.62,
    },
    dark: {
      stops: [
        { color: `rgba(${darkRgb},${alpha * 0.32})` as Color, location: 0 },
        { color: `rgba(${darkRgb},${alpha * 0.2})` as Color, location: 0.48 },
        { color: `rgba(${darkRgb},0)` as Color, location: 1 },
      ],
      center: "center",
      startRadius: 0,
      endRadius: SCREEN_W * 0.62,
    },
  }
}

function MistBand({ band, fill }: { band: BandSpec; fill: DynamicShapeStyle }) {
  const on = usePingPong(band.halfPeriod, band.delay)
  return (
    <Ellipse
      fill={fill}
      frame={{ width: SCREEN_W * band.widthFactor, height: band.height }}
      offset={{ x: on ? band.drift : -band.drift, y: band.y }}
      animation={{
        animation: Animation.smooth({ duration: band.halfPeriod }),
        value: on,
      }}
    />
  )
}

export function MistLayer({ kind }: { kind: "fog" | "haze" }) {
  const bands = useMemo<BandSpec[]>(
    () => [
      {
        y: -SCREEN_H * 0.12,
        height: rand(90, 130),
        widthFactor: 1.0,
        drift: rand(18, 34),
        halfPeriod: rand(9, 13),
        delay: 0,
      },
      {
        y: SCREEN_H * 0.08,
        height: rand(120, 160),
        widthFactor: 1.0,
        drift: rand(22, 40),
        halfPeriod: rand(11, 15),
        delay: rand(1, 3),
      },
      {
        y: SCREEN_H * 0.28,
        height: rand(100, 140),
        widthFactor: 0.95,
        drift: rand(16, 30),
        halfPeriod: rand(10, 14),
        delay: rand(2, 4),
      },
    ],
    []
  )
  // 雾偏灰白，霾偏黄褐
  const fill =
    kind === "fog"
      ? mistBandFill(0.5, "238,240,242", "170,180,190")
      : mistBandFill(0.42, "215,205,175", "180,165,130")
  return (
    <>
      {bands.map((band, index) => (
        <MistBand key={index} band={band} fill={fill} />
      ))}
    </>
  )
}

// ── 晴：径向阳光晕 / 星空 ──────────────────────────────

function sunHaloFill(): DynamicShapeStyle {
  return {
    light: {
      stops: [
        { color: "rgba(255,235,175,0.72)", location: 0 },
        { color: "rgba(255,235,175,0.28)", location: 0.34 },
        { color: "rgba(255,235,175,0.08)", location: 0.68 },
        { color: "rgba(255,235,175,0)", location: 1 },
      ],
      center: "center",
      startRadius: 0,
      endRadius: 250,
    },
    dark: {
      stops: [
        { color: "rgba(238,216,155,0.38)", location: 0 },
        { color: "rgba(238,216,155,0.14)", location: 0.4 },
        { color: "rgba(238,216,155,0)", location: 1 },
      ],
      center: "center",
      startRadius: 0,
      endRadius: 250,
    },
  }
}

export function SunHalo() {
  const on = usePingPong(5.5)
  return (
    <Circle
      fill={sunHaloFill()}
      frame={{ width: 500, height: 500 }}
      offset={{ x: SCREEN_W * 0.18, y: -SCREEN_H * 0.28 }}
      opacity={on ? 1 : 0.68}
      scaleEffect={on ? 1.04 : 0.96}
      animation={{
        animation: Animation.smooth({ duration: 5.5 }),
        value: on,
      }}
    />
  )
}

type StarSpec = {
  x: number
  y: number
  size: number
  halfPeriod: number
  delay: number
  peak: number
}

function StarDot({ star }: { star: StarSpec }) {
  const on = usePingPong(star.halfPeriod, star.delay)
  return (
    <Circle
      fill="white"
      frame={{ width: star.size, height: star.size }}
      offset={{ x: star.x, y: star.y }}
      opacity={on ? star.peak : 0.12}
      animation={{
        animation: Animation.smooth({ duration: star.halfPeriod }),
        value: on,
      }}
    />
  )
}

export function StarField() {
  const stars = useMemo<StarSpec[]>(
    () =>
      Array.from({ length: 22 }, () => ({
        x: rand(-SCREEN_W / 2 + 8, SCREEN_W / 2 - 8),
        y: rand(-SCREEN_H / 2 + 30, SCREEN_H * 0.12),
        size: rand(1.4, 3.2),
        halfPeriod: rand(0.85, 2.1),
        delay: rand(0, 3),
        peak: rand(0.55, 0.95),
      })),
    []
  )
  return (
    <>
      {stars.map((star, index) => (
        <StarDot key={index} star={star} />
      ))}
    </>
  )
}

// ── 暴雨闪电（周期双闪） ───────────────────────────────

function LightningOnce({
  period,
  delay,
  onDone,
}: {
  period: number
  delay: number
  onDone: () => void
}) {
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    // 主闪 → 熄 → 次闪 → 熄 → 等待下一轮
    const t1 = setTimeout(() => setFlash(1), delay * 1000)
    const t2 = setTimeout(() => setFlash(0), (delay + 0.08) * 1000)
    const t3 = setTimeout(() => setFlash(2), (delay + 0.16) * 1000)
    const t4 = setTimeout(() => setFlash(0), (delay + 0.3) * 1000)
    const t5 = setTimeout(onDone, (delay + period) * 1000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
      clearTimeout(t5)
    }
  }, [])
  const opacity = flash === 1 ? 0.28 : flash === 2 ? 0.16 : 0
  return (
    <Rectangle
      fill="white"
      frame={{ width: SCREEN_W, height: SCREEN_H }}
      opacity={opacity}
      animation={{
        animation: Animation.linear(0.08),
        value: flash,
      }}
    />
  )
}

export function LightningFlash({ period, delay }: { period: number; delay: number }) {
  const [cycle, setCycle] = useState(0)
  return (
    <LightningOnce
      key={cycle}
      period={period}
      delay={cycle === 0 ? delay : 0}
      onDone={() => setCycle(c => c + 1)}
    />
  )
}
