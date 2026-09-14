import { VStack, Text, Widget, VirtualNode, Image, HStack, Spacer, Button, modifiers, fetch, Path, Color } from "scripting";
import { calculateRiskValue } from "./utils/ip";
import { fetchIPInfo, fetchChinaIP } from "./api/ip";
import type { WidgetProps } from "./types/widget";
import { RefreshIPIntent } from "./app_intents";
import { RiskColorBar } from "./components/RiskColorBar";
import { MediumIPWidget, mediumMapSize } from "./components/MediumIPWidget";
import { getIPMapImages } from "./services/mapSnapshot";

export type { WidgetProps } from "./types/widget";

const COLORS = {
  safe: "#34C759",
  warning: "#FF9500",
  danger: "#FF3B30",
  secondary: "#8E8E93",
} satisfies Record<string, Color>;

// 标签胶囊：用于「原生 / 家宽」状态
function Tag({ text, color }: { text: string; color: Color }): VirtualNode {
  return (
    <Text
      font={10}
      bold
      foregroundStyle={color}
      padding={{ horizontal: 6, vertical: 2 }}
      background={{ color, opacity: 0.15 }}
      clipShape="capsule"
      lineLimit={1}
    >
      {text}
    </Text>
  );
}

function WidgetView(props: WidgetProps): VirtualNode {
  const { ipInfo, riskValue, riskSource, isHomeBroadband, isNative, vpnStatus, countryFlagPath } = props;
  if (!ipInfo) {
    return (
      <VStack alignment="center" spacing={4} safeAreaPadding={10}>
        <Text foregroundStyle={COLORS.danger}>无法获取 IP 数据</Text>
      </VStack>
    );
  }

  if (Widget.family === "systemMedium") {
    return (
      <Button
        intent={RefreshIPIntent(undefined)}
        buttonStyle="plain"
        modifiers={modifiers()
          .widgetBackground("clear")
          .ignoresSafeArea()
          .frame({ maxWidth: "infinity", maxHeight: "infinity" })}
      >
        <MediumIPWidget {...props} ipInfo={ipInfo} size={Widget.displaySize} />
      </Button>
    );
  }

  const isSmall = Widget.family === "systemSmall";
  const { query: ip, country, city, isp } = ipInfo;
  // 国旗已表达国家，国名与城市重复（如 Hong Kong · Hong Kong）时只保留一份
  const countryText = country ?? "未知";
  const location = city && !countryText.includes(city) && !city.includes(countryText)
    ? `${countryText} · ${city}`
    : (city || countryText);
  const isTunneled = vpnStatus === "分流" || vpnStatus === "全局代理" || vpnStatus === "代理";
  const vpnColor = isTunneled ? COLORS.safe : COLORS.secondary;
  const vpnIcon = isTunneled ? "lock.shield.fill" : vpnStatus === "直连" ? "globe" : "questionmark.circle";
  // Image 的 filePath 在小组件上不稳定，改用 UIImage 显式加载
  const flagImage = countryFlagPath ? UIImage.fromFile(countryFlagPath) : null;

  return (
    <Button
      intent={RefreshIPIntent(undefined)}
      buttonStyle="plain"
      modifiers={modifiers()
        .widgetBackground("clear" as any)
        .ignoresSafeArea()
        .frame({ maxWidth: "infinity", maxHeight: "infinity" })
      }
    >
      <VStack spacing={0} safeAreaPadding={{ horizontal: 14, vertical: isSmall ? 12 : 14 }} alignment="center" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        {/* 顶部：连接状态 + 数据来源 */}
        <HStack spacing={5} alignment="center" frame={{ maxWidth: "infinity" }}>
          <Image systemName={vpnIcon} font={11} imageScale="small" foregroundStyle={vpnColor} />
          <Text font={11} fontWeight="medium" foregroundStyle={vpnColor} lineLimit={1}>{vpnStatus}</Text>
          <Spacer />
          <Text font={9} foregroundStyle={COLORS.secondary} lineLimit={1}>{riskSource}</Text>
        </HStack>

        <Spacer minLength={isSmall ? 0 : undefined} />

        {/* 主体：IP 地址 */}
        <Text
          font={isSmall ? 25 : 30} bold lineLimit={1} minScaleFactor={0.5} foregroundStyle="label"
          fixedSize={isSmall ? { horizontal: false, vertical: true } : undefined}
        >
          {ip}
        </Text>

        {/* 地区紧跟 IP；固定竖向理想尺寸，机房换行只消耗其余空白 */}
        <HStack
          spacing={6} alignment="center" padding={{ top: isSmall ? 0 : 6 }}
          frame={isSmall ? { maxWidth: "infinity", alignment: "center" } : undefined}
          fixedSize={isSmall ? { horizontal: false, vertical: true } : undefined}
        >
          {flagImage ? (
            <Image
              image={flagImage}
              frame={{ width: 15, height: 15 }}
              resizable={true}
              widgetAccentedRenderingMode="fullColor"
              fixedSize={true}
            />
          ) : (
            <Image systemName="mappin.and.ellipse" font={12} imageScale="small" foregroundStyle={COLORS.secondary} fixedSize={true} />
          )}
          <Text
            font={17} fontWeight="semibold" lineLimit={isSmall ? 2 : 1}
            minScaleFactor={isSmall ? 0.7 : 0.7} foregroundStyle="label"
            multilineTextAlignment="center"
            fixedSize={isSmall ? { horizontal: false, vertical: true } : undefined}
          >
            {location}
          </Text>
        </HStack>

        {/* 运营商：名称普遍较长，靠 fixedSize 的竖向自由强制换行；
            不设 minScaleFactor，否则会优先缩字而不换行 */}
        <Text
          font={8}
          foregroundStyle={COLORS.secondary}
          lineLimit={2}
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity" }}
          fixedSize={{ horizontal: false, vertical: true }}
          padding={{ top: isSmall ? 0 : 4 }}
        >
          {isp ?? "未知网络"}
        </Text>

        {isSmall ? <Spacer minLength={0} /> : null}

        {/* 状态标签：原生 / 家宽；风险等级已并入色度条气泡 */}
        <HStack spacing={5} alignment="center" padding={{ top: isSmall ? 0 : 9 }}>
          <Tag text={isNative} color={isNative === "原生" ? COLORS.safe : isNative === "未知" ? COLORS.secondary : COLORS.warning} />
          <Tag text={isHomeBroadband} color={isHomeBroadband === "家宽" ? COLORS.safe : COLORS.secondary} />
        </HStack>

        <Spacer minLength={isSmall ? 0 : undefined} />

        {/* 底部：风险色度条，气泡内同时展示百分比与风险等级 */}
        <RiskColorBar value={riskValue} showScale={!isSmall} barHeight={isSmall ? 6 : 7} compact={false} />
      </VStack>
    </Button>
  );
}

/**
 * 异步下载并缓存国旗 PNG
 */
async function getFlagLocalPath(countryCode: string): Promise<string | undefined> {
  if (!countryCode) return undefined;

  try {
    const code = countryCode.toUpperCase();
    const flagUrl = `https://flagsapi.com/${code}/flat/64.png`;
    const cacheDir = Path.join(FileManager.appGroupDocumentsDirectory, "flags_png");
    const localPath = Path.join(cacheDir, `${code}.png`);

    if (!FileManager.existsSync(cacheDir)) {
      FileManager.createDirectorySync(cacheDir, true);
    }

    // 缓存可能因下载中断留下 0 字节坐文件，需校验大小后重下
    if (isValidFlagFile(localPath)) {
      return localPath;
    }

    const response = await fetch(flagUrl, { timeout: 8 });
    if (response.ok) {
      const data = await response.data();
      if (dataByteLength(data) > 0) {
        FileManager.writeAsDataSync(localPath, data);
      }
    }

    return isValidFlagFile(localPath) ? localPath : undefined;
  } catch (e) {
    console.error("[Widget] 国旗处理失败", e);
    return undefined;
  }
}

// Data 是原生对象，没有 byteLength，取长度需走 toArrayBuffer()
function dataByteLength(data: unknown): number {
  const buffer = (data as { toArrayBuffer?: () => ArrayBuffer })?.toArrayBuffer?.();
  return buffer?.byteLength ?? 0;
}

// 国旗缓存有效性：文件存在且内容非空
function isValidFlagFile(path: string): boolean {
  if (!FileManager.existsSync(path)) return false;
  try {
    return dataByteLength(FileManager.readAsDataSync(path)) > 0;
  } catch {
    return false;
  }
}

async function getWidgetProps(): Promise<WidgetProps> {
  const ipInfo = await fetchIPInfo();

  if (!ipInfo) {
    return {
      ipInfo: null,
      riskValue: null,
      riskSource: "",
      isHomeBroadband: "未知",
      isNative: "未知",
      vpnStatus: "未知",
      countryFlagPath: undefined,
    };
  }

  // 台湾特殊映射处理
  let countryCode = ipInfo.countryCode;
  if (ipInfo.country.includes("台湾") && ipInfo.countryCode === "CN") {
    countryCode = "TW";
  }

  // 仅中号加载地图；地图与国旗、出口对比并行，地图失败不影响 IP 信息。
  const [chinaIP, countryFlagPath, mapImages] = await Promise.all([
    fetchChinaIP(),
    getFlagLocalPath(countryCode),
    Widget.family === "systemMedium"
      ? getIPMapImages(ipInfo, mediumMapSize(Widget.displaySize)).catch((error) => {
        console.warn("[Widget] 地图暂不可用", error);
        return undefined;
      })
      : Promise.resolve(undefined),
  ]);
  // 对比出口仅用于连接状态，绝不进入归属地、风险与坐标字段。
  const { riskValue, riskSource, isHomeBroadband, isNative, vpnStatus } = calculateRiskValue(ipInfo, chinaIP);

  return {
    ipInfo,
    riskValue,
    riskSource,
    isHomeBroadband,
    isNative,
    vpnStatus,
    countryFlagPath,
    mapImages,
  };
}

export async function renderIPWidget() {
  const widgetProps = await getWidgetProps();
  return <WidgetView {...widgetProps} />;
}

// 自动执行以进行预览/测试
renderIPWidget().then(view => Widget.present(view));