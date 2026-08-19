// 资源预览卡：封面轮播、元信息、链接与操作入口

import {
  Button,
  HStack,
  Image,
  ProgressView,
  Spacer,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting";

import { BLUE } from "../constants";
import type { WhatsLinkResponse } from "../types";
import { displayFileType, formatBytes, getCover, getPreviewHeight, loadPreviewHeight } from "../utils/format";
import { buildMissavSearchUrl, extractFanhao } from "../utils/magnet";
import { MetaLine } from "./common";
import { GlassShape, glassSurface } from "./glass";

export function PreviewCard({
  result,
  url,
  screenshotSelection,
  onCopyUrl,
  onPreviewImage,
  initialImageHeight,
  exportMode = false,
}: {
  result: WhatsLinkResponse;
  url: string;
  screenshotSelection: Observable<number>;
  onCopyUrl?: () => void;
  onPreviewImage?: (index: number) => void;
  initialImageHeight?: number;
  exportMode?: boolean;
}) {
  const shots = result.screenshots ?? [];
  const screenshotIndex = Math.min(Math.max(screenshotSelection.value, 0), Math.max(0, shots.length - 1));
  const cover = getCover(result, screenshotIndex);
  const title = result.name || "未知资源";
  const titleFont = title.length > 90 ? 17 : title.length > 56 ? 19 : title.length > 32 ? 21 : 23;
  const fanhao = extractFanhao(title || url);
  const missavSearchUrl = fanhao ? buildMissavSearchUrl(fanhao) : "";
  const [imageHeight, setImageHeight] = useState(() => initialImageHeight ?? getPreviewHeight(undefined, undefined, exportMode));

  useEffect(() => {
    if (exportMode) {
      setImageHeight(206);
      return;
    }
    if (!cover) {
      setImageHeight(getPreviewHeight(undefined, undefined, exportMode));
      return;
    }

    let cancelled = false;
    loadPreviewHeight(cover, exportMode).then((height) => {
      if (!cancelled) setImageHeight(height);
    });

    return () => {
      cancelled = true;
    };
  }, [cover, exportMode]);

  return (
    <VStack
      alignment="leading"
      spacing={16}
      padding={18}
      frame={exportMode ? { width: 370 } : { maxWidth: "infinity" }}
      {...glassSurface(30, "card")}
    >
      {cover ? (
        <ZStack alignment="topTrailing" frame={{ maxWidth: "infinity" }}>
          {exportMode || shots.length <= 1 ? (
            <ZStack
              frame={{ maxWidth: "infinity", height: imageHeight }}
              background={<GlassShape cornerRadius={20} />}
              onTapGesture={() => onPreviewImage?.(screenshotIndex)}
            >
              <Image
                imageUrl={cover}
                resizable
                scaleToFit
                frame={{ maxWidth: "infinity", height: imageHeight }}
                clipShape={{ type: "rect", cornerRadius: 20 }}
                placeholder={
                  <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} />}>
                    <ProgressView />
                  </ZStack>
                }
              />
            </ZStack>
          ) : (
            <TabView
              selection={screenshotSelection}
              tabViewStyle="pageAutomaticDisplayIndex"
              indexViewStyle="pageBackgroundInteractiveDisplay"
              frame={{ maxWidth: "infinity", height: imageHeight }}
            >
              {shots.map((shot, idx) => (
                <ZStack
                  tag={idx}
                  key={`${idx}-${shot.screenshot}`}
                  frame={{ maxWidth: "infinity", height: imageHeight }}
                  background={<GlassShape cornerRadius={20} />}
                  onTapGesture={() => onPreviewImage?.(idx)}
                >
                  <Image
                    imageUrl={shot.screenshot}
                    resizable
                    scaleToFit
                    frame={{ maxWidth: "infinity", height: imageHeight }}
                    clipShape={{ type: "rect", cornerRadius: 20 }}
                    placeholder={
                      <ZStack frame={{ maxWidth: "infinity", height: imageHeight }} background={<GlassShape cornerRadius={20} />}>
                        <ProgressView />
                      </ZStack>
                    }
                  />
                </ZStack>
              ))}
            </TabView>
          )}
        </ZStack>
      ) : (
        <HStack frame={{ maxWidth: "infinity", height: imageHeight }}>
          <Spacer />
          <VStack spacing={8} frame={{ alignment: "center" }}>
            <Image systemName="doc.text.magnifyingglass" resizable frame={{ width: 38, height: 44 }} foregroundStyle={BLUE} />
            <Text foregroundStyle="secondaryLabel">暂无预览图</Text>
          </VStack>
          <Spacer />
        </HStack>
      )}

      <Text
        font={titleFont}
        fontWeight="bold"
        allowsTightening
        fixedSize={{ horizontal: false, vertical: true }}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        textSelection
      >
        {title}
      </Text>

      <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
        <MetaLine label="大小" value={formatBytes(result.size)} />
        <MetaLine label="文件数量" value={result.count ?? 0} />
        <MetaLine label="文件类型" value={displayFileType(result)} />
      </VStack>

      <Button action={() => onCopyUrl?.()} buttonStyle="plain">
        <Text
          textSelection
          font={14}
          padding={14}
          fixedSize={{ horizontal: false, vertical: true }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          {...glassSurface(18, "input")}
        >
          {url}
        </Text>
      </Button>

      {!exportMode ? (
        <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
          <Button action={() => void onCopyUrl?.()} buttonStyle="plain">
            <Text font={13} fontWeight="semibold" padding={{ vertical: 7, horizontal: 10 }} {...glassSurface(14, "control", true, false)}>
              复制磁力链接
            </Text>
          </Button>
          {missavSearchUrl ? (
            <Button action={() => void Safari.present(missavSearchUrl, true)} buttonStyle="plain">
              <Text
                font={13}
                fontWeight="semibold"
                padding={{ vertical: 7, horizontal: 10 }}
                {...glassSurface(14, "prominent", true, false)}
                foregroundStyle="white"
              >
                在线播放
              </Text>
            </Button>
          ) : null}
          <Spacer />
        </HStack>
      ) : null}

      {exportMode ? (
        <Text foregroundStyle="secondaryLabel" font={12} frame={{ maxWidth: "infinity", alignment: "center" }}>
          File information by whatslink.info
        </Text>
      ) : null}
    </VStack>
  );
}
