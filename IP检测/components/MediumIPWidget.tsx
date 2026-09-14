import {
  HStack, Image, Rectangle, Spacer, Text, VStack, ZStack, gradient,
} from "scripting";
import type { Color, VirtualNode, WidgetDisplaySize } from "scripting";
import type { IPInfo } from "../types/ip";
import type { WidgetProps } from "../types/widget";
import { getIPMapCoordinate } from "../services/mapSnapshot";
import { RiskColorBar } from "./RiskColorBar";

// 整体宽度按信息 60%、渐变 10%、清晰地图 30% 分配。
const MAP_FADE_RATIO = 0.1;
const INFO_VERTICAL_INSET = 12;
const RISK_BAR_HEIGHT = 6;

// 快照与显示都严格占右 40% 幅，不向文字区域延伸。
export function mediumMapSize(size: WidgetDisplaySize): WidgetDisplaySize {
  return { width: size.width * 0.4, height: Math.round(size.height) };
}

export function MediumIPWidget({
  ipInfo, riskValue, riskSource, isHomeBroadband, isNative, vpnStatus,
  countryFlagPath, mapImages, size,
}: WidgetProps & { ipInfo: IPInfo; size: WidgetDisplaySize }): VirtualNode {
  const mapSize = mediumMapSize(size);
  const columnWidth = size.width * 0.6;
  const fadeEnd = size.width * MAP_FADE_RATIO / mapSize.width;
  // 信息宽度保持半幅，左边距计入信息区。
  const infoWidth = columnWidth - 14;
  // 色带在信息区底部，RiskColorBar 的指针行高为色带高度 + 5。
  const riskBarCenterY = size.height - INFO_VERTICAL_INSET - (RISK_BAR_HEIGHT + 5) / 2;
  const coordinate = getIPMapCoordinate(ipInfo);
  const country = ipInfo.country || "未知";
  const city = ipInfo.city;
  const location = city && !country.includes(city) && !city.includes(country)
    ? `${country} · ${city}` : (city || country);
  const tunneled = ["分流", "全局代理", "代理"].includes(vpnStatus);
  const statusColor: Color = tunneled ? "systemGreen" : "secondaryLabel";
  const statusIcon = tunneled ? "lock.shield.fill" : vpnStatus === "直连" ? "globe" : "questionmark.circle";
  const flag = countryFlagPath ? UIImage.fromFile(countryFlagPath) : null;
  const isIPv6 = ipInfo.query.includes(":");
  const tags: { text: string; color: Color }[] = [
    { text: isNative, color: isNative === "原生" ? "systemGreen" : isNative === "未知" ? "secondaryLabel" : "systemOrange" },
    { text: isHomeBroadband, color: isHomeBroadband === "家宽" ? "systemGreen" : "secondaryLabel" },
  ];

  return (
    <ZStack alignment="leading" frame={size} clipped={true}>
      <HStack spacing={0} frame={size}>
        <Spacer minLength={0} />
        <ZStack
          frame={mapSize}
          clipped={true}
          mask={
            <Rectangle fill={gradient("linear", {
              // 仅柔化首尾各 15%，中段保持近似匀速，避免窄渐变带中部突然显色。
              stops: [
                { color: "rgba(0,0,0,0)", location: 0 },
                { color: "rgba(0,0,0,0.01)", location: fadeEnd * 0.05 },
                { color: "rgba(0,0,0,0.039)", location: fadeEnd * 0.1 },
                { color: "rgba(0,0,0,0.088)", location: fadeEnd * 0.15 },
                { color: "rgba(0,0,0,0.912)", location: fadeEnd * 0.85 },
                { color: "rgba(0,0,0,0.961)", location: fadeEnd * 0.9 },
                { color: "rgba(0,0,0,0.99)", location: fadeEnd * 0.95 },
                { color: "black", location: fadeEnd },
                { color: "black", location: 1 },
              ],
              startPoint: "leading",
              endPoint: "trailing",
            })} />
          }
        >
          {mapImages ? (
            <Image image={mapImages} resizable={true} frame={mapSize} widgetAccentedRenderingMode="fullColor" />
          ) : (
            <Rectangle fill={{ light: "#EAF1F5", dark: "#202C37" }} />
          )}
        </ZStack>
      </HStack>

      {!mapImages ? (
        <VStack
          spacing={6}
          frame={{ width: columnWidth * 0.72, height: size.height }}
          position={{ x: size.width - columnWidth * 0.36, y: size.height / 2 }}
          foregroundStyle="secondaryLabel"
        >
          <Image systemName="map" font={24} imageScale="small" />
          <Text font={10}>{coordinate ? "地图暂不可用" : "暂无 IP 坐标"}</Text>
        </VStack>
      ) : null}

      {mapImages ? (
        <Text
          font={7} foregroundStyle="secondaryLabel" lineLimit={1} fixedSize={true}
          padding={{ horizontal: 4, vertical: 2 }}
          background={{ light: "rgba(255,255,255,0.85)", dark: "rgba(28,28,30,0.85)" }}
          clipShape={{ type: "rect", cornerRadius: 4 }}
          position={{ x: size.width - mapSize.width / 2, y: riskBarCenterY }}
        >
          Apple 地图 · IP 近似位置
        </Text>
      ) : null}

      <VStack
        alignment="leading"
        spacing={0}
        frame={{ width: infoWidth, height: size.height - INFO_VERTICAL_INSET * 2 }}
        padding={{ leading: 14 }}
      >
        <HStack spacing={5}>
          <Image systemName={statusIcon} font={11} imageScale="small" foregroundStyle={statusColor} />
          <Text font={11} fontWeight="medium" foregroundStyle={statusColor} lineLimit={1}>{vpnStatus}</Text>
          <Spacer minLength={3} />
          <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1}>{riskSource}</Text>
        </HStack>
        <Spacer minLength={0} />
        <Text
          font={isIPv6 ? 13 : 25} bold lineLimit={isIPv6 ? 2 : 1}
          minScaleFactor={isIPv6 ? undefined : 0.5} foregroundStyle="label"
          fixedSize={{ horizontal: false, vertical: true }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          {ipInfo.query}
        </Text>
        <HStack
          spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {flag ? (
            <Image image={flag} resizable={true} frame={{ width: 15, height: 15 }} fixedSize={true} widgetAccentedRenderingMode="fullColor" />
          ) : (
            <Image systemName="mappin.and.ellipse" font={12} imageScale="small" foregroundStyle="secondaryLabel" fixedSize={true} />
          )}
          <Text
            font={17} fontWeight="semibold" foregroundStyle="label" lineLimit={2}
            minScaleFactor={0.7}
            multilineTextAlignment="leading"
            frame={{ width: infoWidth - 21, alignment: "leading" }}
            fixedSize={{ horizontal: false, vertical: true }}
          >
            {location}
          </Text>
        </HStack>
        <Spacer minLength={0} />
        <Text
          font={8} foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="leading"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          fixedSize={{ horizontal: false, vertical: true }}
        >
          {ipInfo.isp || "未知网络"}
        </Text>
        <Spacer minLength={0} />
        <HStack spacing={5}>
          {tags.map((tag) => (
            <Text
              font={10} bold foregroundStyle={tag.color} lineLimit={1}
              padding={{ horizontal: 6, vertical: 2 }}
              background={{ color: tag.color, opacity: 0.15 }} clipShape="capsule"
            >
              {tag.text}
            </Text>
          ))}
        </HStack>
        <Spacer minLength={0} />
        <VStack spacing={0} alignment="leading">
          {riskValue === null ? <Text font={8} foregroundStyle="secondaryLabel">--</Text> : null}
          <RiskColorBar value={riskValue} showScale={false} barHeight={RISK_BAR_HEIGHT} compact={false} />
        </VStack>
      </VStack>
    </ZStack>
  );
}
