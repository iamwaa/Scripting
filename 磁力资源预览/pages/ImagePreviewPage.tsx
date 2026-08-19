// 全屏图片预览页：分页浏览 + 双指缩放

import {
  Image,
  MagnifyGesture,
  Navigation,
  ProgressView,
  TabView,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useState,
} from "scripting";

import type { WhatsLinkScreenshot } from "../types";

export function ImagePreviewPage({
  screenshots,
  initialIndex,
}: {
  screenshots: WhatsLinkScreenshot[];
  initialIndex: number;
}) {
  const dismiss = Navigation.useDismiss();
  const previewSelection = useObservable(Math.min(Math.max(initialIndex, 0), Math.max(0, screenshots.length - 1)));
  const [baseScale, setBaseScale] = useState(1);
  const [pinchScale, setPinchScale] = useState(1);
  const [scaleAnchor, setScaleAnchor] = useState<any>("center");
  const imageScale = Math.min(4, Math.max(1, baseScale * pinchScale));

  // 切换图片时复位缩放
  useEffect(() => {
    const resetScale = () => {
      setBaseScale(1);
      setPinchScale(1);
      setScaleAnchor("center");
    };
    previewSelection.subscribe(resetScale);
    return () => previewSelection.unsubscribe(resetScale);
  }, []);

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
      ignoresSafeArea
      onTapGesture={dismiss}
    >
      <TabView
        selection={previewSelection}
        tabViewStyle="pageAutomaticDisplayIndex"
        indexViewStyle="pageBackgroundInteractiveDisplay"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={{ bottom: 28 }}
      >
        {screenshots.map((shot, idx) => (
          <ZStack
            tag={idx}
            key={`fullscreen-${idx}-${shot.screenshot}`}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            background="black"
            onTapGesture={dismiss}
          >
            <Image
              imageUrl={shot.screenshot}
              resizable
              scaleToFit
              scaleEffect={idx === previewSelection.value ? { x: imageScale, y: imageScale, anchor: scaleAnchor } : 1}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              onTapGesture={dismiss}
              gesture={
                MagnifyGesture()
                  .onChanged((value) => {
                    setScaleAnchor(value.startAnchor);
                    setPinchScale(value.magnification);
                  })
                  .onEnded((value) => {
                    const nextScale = Math.min(4, Math.max(1, baseScale * value.magnification));
                    setBaseScale(nextScale);
                    setPinchScale(1);
                    if (nextScale <= 1) {
                      setScaleAnchor("center");
                    }
                  })
              }
              placeholder={
                <VStack spacing={12} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
                  <ProgressView />
                  <Text foregroundStyle="secondaryLabel">正在加载图片…</Text>
                </VStack>
              }
            />
          </ZStack>
        ))}
      </TabView>
    </ZStack>
  );
}
