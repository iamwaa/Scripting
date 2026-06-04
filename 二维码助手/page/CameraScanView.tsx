import { useState, useEffect, useRef, VStack, HStack, Text, Button, Image, Spacer, ZStack, Navigation, CaptureVideoPreviewView, RoundedRectangle, Circle, GeometryReader, MagnifyGesture } from "scripting";
import { ScanMode } from "../types/types";

export function CameraScanView({
  scanMode,
  onScanResult,
  onScanModeChange
}: {
  scanMode: ScanMode;
  onScanResult: (content: string) => void;
  onScanModeChange?: (mode: ScanMode) => void;
}) {
  const dismiss = Navigation.useDismiss();
  const [isScanning, setIsScanning] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isPreviewCoverVisible, setIsPreviewCoverVisible] = useState(true);
  const [torchMode, setTorchMode] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [maxZoomFactor, setMaxZoomFactor] = useState(5);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "found" | "error">("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [highlightBounds, setHighlightBounds] = useState<AVCaptureRect | null>(null);
  const [currentScanMode, setCurrentScanMode] = useState<ScanMode>(scanMode);
  
  // 使用 ref 跟踪状态避免闭包问题
  const isProcessingRef = useRef(false);
  const pinchBaseZoomRef = useRef<number | null>(null);
  const zoomFactorRef = useRef(zoomFactor);
  const scanModeRef = useRef(currentScanMode);
  const lastContinuousContentRef = useRef<string | null>(null);
  const scanReadyAtRef = useRef(0);
  const lastDetectionRef = useRef<{ content: string | null; bounds: AVCaptureRect; time: number } | null>(null);
  const displayBoundsRef = useRef<AVCaptureRect | null>(null);
  const pendingRecognitionRef = useRef<{ content: string; firstSeenAt: number } | null>(null);
  const lastMetadataTimeRef = useRef(0);
  const warmupDurationMs = 500;
  const recognitionDelayMs = 250;
  const predictionDelayMs = 60;
  const smoothingFactor = 0.45;
  const maxPredictionRatio = 0.22;
  zoomFactorRef.current = zoomFactor;
  scanModeRef.current = currentScanMode;

  const sessionRef = useRef<AVCaptureSession | null>(null);
  const cameraRef = useRef<AVCaptureDevice | null>(null);
  const interactionRef = useRef<AVCaptureEventInteraction | null>(null);

  const resetHighlightTracking = () => {
    lastDetectionRef.current = null;
    displayBoundsRef.current = null;
    pendingRecognitionRef.current = null;
    lastMetadataTimeRef.current = 0;
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

  const getPredictedBounds = (content: string | null, bounds: AVCaptureRect, now: number) => {
    const previous = lastDetectionRef.current;
    let target = { ...bounds };

    if (previous && previous.content === content) {
      const dt = Math.max(16, now - previous.time);
      if (dt < 500) {
        const previousCenterX = previous.bounds.x + previous.bounds.width / 2;
        const previousCenterY = previous.bounds.y + previous.bounds.height / 2;
        const currentCenterX = bounds.x + bounds.width / 2;
        const currentCenterY = bounds.y + bounds.height / 2;
        const maxOffset = Math.max(bounds.width, bounds.height) * maxPredictionRatio;
        const predictedCenterX = currentCenterX + clamp(((currentCenterX - previousCenterX) / dt) * predictionDelayMs, -maxOffset, maxOffset);
        const predictedCenterY = currentCenterY + clamp(((currentCenterY - previousCenterY) / dt) * predictionDelayMs, -maxOffset, maxOffset);
        const predictedWidth = Math.max(0.001, bounds.width + clamp(((bounds.width - previous.bounds.width) / dt) * predictionDelayMs, -maxOffset, maxOffset));
        const predictedHeight = Math.max(0.001, bounds.height + clamp(((bounds.height - previous.bounds.height) / dt) * predictionDelayMs, -maxOffset, maxOffset));

        target = {
          x: predictedCenterX - predictedWidth / 2,
          y: predictedCenterY - predictedHeight / 2,
          width: predictedWidth,
          height: predictedHeight
        };
      }
    } else {
      displayBoundsRef.current = null;
    }

    lastDetectionRef.current = { content, bounds, time: now };
    return target;
  };

  const getSmoothedBounds = (target: AVCaptureRect) => {
    const current = displayBoundsRef.current;
    const next = current
      ? {
          x: lerp(current.x, target.x, smoothingFactor),
          y: lerp(current.y, target.y, smoothingFactor),
          width: lerp(current.width, target.width, smoothingFactor),
          height: lerp(current.height, target.height, smoothingFactor)
        }
      : target;
    displayBoundsRef.current = next;
    return next;
  };

  const setupCamera = async () => {
    setIsPreviewVisible(false);
    setIsPreviewCoverVisible(true);
    try {
      const camera = AVCaptureDevice.default("video");
      if (!camera) {
        setScanStatus("error");
        return false;
      }
      cameraRef.current = camera;
      setMaxZoomFactor(Math.max(1, Math.min(10, camera.maxAvailableVideoZoomFactor)));

      const input = new AVCaptureDeviceInput(camera);
      const session = new AVCaptureSession();
      sessionRef.current = session;

      const metaOutput = new AVCaptureMetadataOutput();

      // 配置 session
      session.configure(() => {
        session.sessionPreset = "high";
        if (session.canAddInput(input)) {
          session.addInput(input);
        }
        if (session.canAddOutput(metaOutput)) {
          session.addOutput(metaOutput);
        }
      });

      // 设置扫码类型（必须在 output 添加后）
      const types = metaOutput.availableMetadataObjectTypes;
      const qrType = types.find(t => t === "org.iso.QRCode" || t === "qr");
      
      if (!qrType) {
        setScanStatus("error");
        return false;
      }
      
      metaOutput.metadataObjectTypes = [qrType];

      // 设置监听器
      metaOutput.setMetadataObjectsListener(objects => {
        const detectedObject = objects.find(o => o.bounds && o.stringValue) ?? objects.find(o => o.bounds);
        const now = Date.now();
        const isReady = now >= scanReadyAtRef.current;

        if (!isReady) {
          setHighlightBounds(null);
          resetHighlightTracking();
          return;
        }

        if (!detectedObject?.bounds) {
          if (!isProcessingRef.current) {
            setHighlightBounds(null);
            resetHighlightTracking();
            lastContinuousContentRef.current = null;
          }
          return;
        }

        // metadata 结果只保留最新：如果系统/桥接层偶发回调旧时间戳，直接丢弃。
        if (detectedObject.time && detectedObject.time < lastMetadataTimeRef.current) {
          return;
        }
        if (detectedObject.time) {
          lastMetadataTimeRef.current = detectedObject.time;
        }

        const content = detectedObject.stringValue ?? null;
        const predictedBounds = getPredictedBounds(content, detectedObject.bounds, now);
        const smoothedBounds = getSmoothedBounds(predictedBounds);
        setHighlightBounds(smoothedBounds);

        if (!detectedObject.stringValue || isProcessingRef.current) {
          pendingRecognitionRef.current = null;
          return;
        }

        const pendingRecognition = pendingRecognitionRef.current;
        if (!pendingRecognition || pendingRecognition.content !== detectedObject.stringValue) {
          pendingRecognitionRef.current = { content: detectedObject.stringValue, firstSeenAt: now };
          return;
        }

        if (now - pendingRecognition.firstSeenAt < recognitionDelayMs) {
          return;
        }

        if (scanModeRef.current === "continuous" && lastContinuousContentRef.current === detectedObject.stringValue) {
          // 连续扫码时，同一个二维码只处理一次；等二维码离开画面后再允许再次识别。
          return;
        }

        isProcessingRef.current = true;
        if (scanModeRef.current === "continuous") {
          lastContinuousContentRef.current = detectedObject.stringValue;
        }
        
        setScanStatus("found");
        setLastResult(detectedObject.stringValue);
        setHighlightBounds(smoothedBounds);
        setShowResult(true);
        onScanResult(detectedObject.stringValue);
        
        // 播放成功反馈
        Haptics.transient(0.8, 0.8);
        
        // 单次模式延迟关闭
        if (scanModeRef.current === "single") {
          setTimeout(() => {
            dismiss();
          }, 1200);
        } else {
          // 连续模式，短暂显示后继续扫描
          setTimeout(() => {
            setShowResult(false);
            setHighlightBounds(null);
            resetHighlightTracking();
            setScanStatus("scanning");
            isProcessingRef.current = false;
          }, 1000);
        }
      });

      // 添加 Camera Control 支持
      if (session.supportsControls) {
        const zoom = new AVCaptureSystemZoomSlider(camera, value => {
          setZoomFactor(Math.round(value * 10) / 10);
        });
        
        const exposure = new AVCaptureSystemExposureBiasSlider(camera, () => {});

        session.configure(() => {
          if (session.canAddControl(zoom)) session.addControl(zoom);
          if (session.canAddControl(exposure)) session.addControl(exposure);
        });
      }

      // 添加硬件按钮支持
      const interaction = new AVCaptureEventInteraction((phase, kind) => {
        if (phase === "ended" && kind === "primary") {
          Haptics.transient(0.6, 0.6);
        }
      });
      interaction.attach();
      interactionRef.current = interaction;

      // 错误监听
      session.addRuntimeErrorListener(() => {
        setScanStatus("error");
      });

      scanReadyAtRef.current = Date.now() + warmupDurationMs;
      resetHighlightTracking();
      await session.startRunning();
      setIsScanning(true);
      setScanStatus("scanning");
      setIsPreviewVisible(true);
      // 预览层刚挂载时系统可能先按安全区/父页面尺寸布局，随后才更新到全屏。
      // 让预览先在黑色遮罩下完成首轮布局，再移除遮罩，避免用户看到上下白边跳变。
      setTimeout(() => setIsPreviewCoverVisible(false), 450);

      return true;
    } catch {
      setScanStatus("error");
      return false;
    }
  };

  const toggleTorch = async () => {
    if (!cameraRef.current) return;
    
    try {
      const newMode = !torchMode;
      cameraRef.current.setTorchMode(newMode ? "on" : "off");
      setTorchMode(newMode);
      Haptics.transient(0.5, 0.5);
    } catch {
    }
  };

  const handleZoomChange = (newZoom: number) => {
    if (!cameraRef.current) return;
    
    try {
      const maxZoom = cameraRef.current.maxAvailableVideoZoomFactor;
      const clampedZoom = Math.max(1, Math.min(newZoom, maxZoom));
      cameraRef.current.setVideoZoomFactor(clampedZoom);
      setZoomFactor(Math.round(clampedZoom * 10) / 10);
    } catch {
    }
  };

  const handleZoomButtonTap = () => {
    const presets = [1, 2, 5].filter(value => value <= maxZoomFactor + 0.05);
    const availablePresets = presets.length > 0 ? presets : [1];
    const currentIndex = availablePresets.findIndex(value => Math.abs(zoomFactor - value) < 0.15);
    const nextZoom = currentIndex >= 0
      ? availablePresets[(currentIndex + 1) % availablePresets.length]
      : availablePresets.find(value => value > zoomFactor) ?? availablePresets[0];

    handleZoomChange(nextZoom);
    Haptics.transient(0.45, 0.45);
  };

  const handlePinchZoom = (magnification: number) => {
    if (pinchBaseZoomRef.current === null) {
      pinchBaseZoomRef.current = zoomFactorRef.current;
    }
    handleZoomChange(pinchBaseZoomRef.current * magnification);
  };

  const toggleScanMode = () => {
    const nextMode: ScanMode = currentScanMode === "continuous" ? "single" : "continuous";
    setCurrentScanMode(nextMode);
    scanModeRef.current = nextMode;
    onScanModeChange?.(nextMode);
    Haptics.transient(0.35, 0.35);
  };

  useEffect(() => {
    setCurrentScanMode(scanMode);
    scanModeRef.current = scanMode;
  }, [scanMode]);

  useEffect(() => {
    setupCamera();
    
    return () => {
      if (interactionRef.current) {
        interactionRef.current.detach();
      }
      if (sessionRef.current) {
        sessionRef.current.stopRunning();
        sessionRef.current.dispose();
      }
    };
  }, []);

  const getStatusColor = () => {
    switch (scanStatus) {
      case "scanning": return "#007AFF";
      case "found": return "#34C759";
      case "error": return "#FF3B30";
      default: return "#8E8E93";
    }
  };

  const getStatusText = () => {
    switch (scanStatus) {
      case "scanning": return "正在扫描";
      case "found": return "识别成功";
      case "error": return "相机错误";
      default: return "准备就绪";
    }
  };

  const getHighlightFrame = (bounds: AVCaptureRect, size: { width: number; height: number }) => {
    const isNormalized = Math.max(bounds.x, bounds.y, bounds.width, bounds.height) <= 1.01;
    const padding = 14;
    const minSide = 72;
    const edgeInset = 14;

    if (!isNormalized) {
      const side = Math.min(
        Math.max(minSide, Math.max(bounds.width, bounds.height) + padding * 2),
        Math.min(size.width, size.height) - edgeInset * 2
      );
      return {
        centerX: bounds.x + bounds.width / 2,
        centerY: bounds.y + bounds.height / 2,
        side
      };
    }

    // AVCaptureMetadataOutput 返回的是标准化 metadata 坐标；在竖屏预览中需要先转换为
    // 预览层的竖屏坐标，再按 resizeAspectFill 映射到屏幕。直接用 x/y 会导致框偏离二维码。
    const portraitRect = {
      x: 1 - bounds.y - bounds.height,
      y: bounds.x,
      width: bounds.height,
      height: bounds.width
    };

    // 预览使用 resizeAspectFill，超出的部分会被裁切。
    // 不要固定写死 9:16：在纯色背景/不同设备格式下，metadata 输出可能基于当前
    // activeFormat 的实际画幅（常见为 4:3 或 16:9）。使用真实格式比例可以避免高亮框偏移。
    const format = cameraRef.current?.activeFormat;
    const videoAspect = format && format.width > 0 && format.height > 0
      ? Math.min(format.width, format.height) / Math.max(format.width, format.height)
      : 9 / 16;
    const viewAspect = size.width / size.height;
    let displayWidth = size.width;
    let displayHeight = size.height;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspect < viewAspect) {
      displayHeight = size.width / videoAspect;
      offsetY = (size.height - displayHeight) / 2;
    } else {
      displayWidth = size.height * videoAspect;
      offsetX = (size.width - displayWidth) / 2;
    }

    const x = offsetX + portraitRect.x * displayWidth;
    const y = offsetY + portraitRect.y * displayHeight;
    const width = portraitRect.width * displayWidth;
    const height = portraitRect.height * displayHeight;
    const side = Math.min(
      Math.max(minSide, Math.max(width, height) + padding * 2),
      Math.min(size.width, size.height) - edgeInset * 2
    );

    return {
      centerX: x + width / 2,
      centerY: y + height / 2,
      side
    };
  };

  return (
    <ZStack
      frame={{ maxHeight: Infinity, maxWidth: Infinity }}
      ignoresSafeArea
      background="black"
      gesture={MagnifyGesture()
        .onChanged(value => handlePinchZoom(value.magnification))
        .onEnded(() => {
          pinchBaseZoomRef.current = null;
        })}
    >
      {/* 相机预览 - 覆盖整个屏幕 */}
      {isScanning && isPreviewVisible && sessionRef.current && cameraRef.current && (
        <CaptureVideoPreviewView
          session={sessionRef.current}
          videoDevice={cameraRef.current}
          videoGravity="resizeAspectFill"
          frame={{ maxHeight: Infinity, maxWidth: Infinity }}
          ignoresSafeArea
        />
      )}

      {isPreviewCoverVisible && (
        <ZStack
          frame={{ maxHeight: Infinity, maxWidth: Infinity }}
          background="black"
          ignoresSafeArea
        />
      )}

      {/* 检测到二维码时实时显示高亮框：识别中为蓝色，识别成功为绿色 */}
      {highlightBounds && (
        <GeometryReader>
          {proxy => {
            const frame = getHighlightFrame(highlightBounds, proxy.size);
            return (
              <RoundedRectangle
                cornerRadius={18}
                style="continuous"
                fill={scanStatus === "found" ? "rgba(52,199,89,0.14)" : "rgba(0,122,255,0.12)"}
                stroke={{
                  shapeStyle: scanStatus === "found" ? "rgba(52,199,89,0.98)" : "rgba(0,122,255,0.98)",
                  strokeStyle: { lineWidth: scanStatus === "found" ? 4 : 3 }
                }}
                shadow={{ color: scanStatus === "found" ? "rgba(52,199,89,0.42)" : "rgba(0,122,255,0.36)", radius: 18, y: 0 }}
                frame={{ width: frame.side, height: frame.side }}
                position={{ x: frame.centerX, y: frame.centerY }}
              />
            );
          }}
        </GeometryReader>
      )}

      {/* 顶部原生玻璃控制栏 */}
      <VStack spacing={0} frame={{ maxWidth: Infinity, maxHeight: Infinity }}>
        <HStack spacing={12} padding={{ leading: 18, trailing: 18, top: 58, bottom: 16 }} frame={{ maxWidth: Infinity }}>
          <Button action={() => dismiss()} buttonStyle="plain">
            <ZStack frame={{ width: 46, height: 46 }}>
              <Circle fill="ultraThinMaterial" />
              <Image systemName="xmark" font={17} foregroundStyle="white" fontWeight="semibold" />
            </ZStack>
          </Button>
          
          <Spacer />

          <Button action={toggleScanMode} buttonStyle="plain">
            <HStack
              spacing={8}
              padding={{ leading: 16, trailing: 16 }}
              frame={{ height: 46 }}
              background={<RoundedRectangle cornerRadius={23} style="continuous" fill="ultraThinMaterial" /> }
            >
              <VStack spacing={0} alignment="center">
                <HStack spacing={8}>
                  <Image systemName="viewfinder" font={15} foregroundStyle={getStatusColor()} />
                  <Text font={14} foregroundStyle="white" fontWeight="semibold">
                    {getStatusText()}
                  </Text>
                </HStack>
                <Text
                  font={11}
                  foregroundStyle={currentScanMode === "continuous" ? "#FFD60A" : "rgba(255,255,255,0.72)"}
                  fontWeight="semibold"
                >
                  {currentScanMode === "continuous" ? "连续扫码" : "单次扫码"}
                </Text>
              </VStack>
            </HStack>
          </Button>
          
          <Spacer />
          
          <Button action={toggleTorch} buttonStyle="plain">
            <ZStack frame={{ width: 46, height: 46 }}>
              <Circle fill="ultraThinMaterial" />
              <Image 
                systemName={torchMode ? "bolt.fill" : "bolt.slash.fill"} 
                font={19} 
                foregroundStyle={torchMode ? "#FFD60A" : "white"} 
              />
            </ZStack>
          </Button>
        </HStack>
        
        <Spacer />
        
        {/* 底部缩放按钮 */}
        <VStack spacing={0} padding={{ leading: 18, trailing: 18, top: 18, bottom: 100 }} frame={{ maxWidth: Infinity }}>
          <Button action={handleZoomButtonTap} buttonStyle="plain">
            <ZStack frame={{ width: 44, height: 44 }}>
              <Circle fill="ultraThinMaterial" stroke="rgba(255,255,255,0.18)" />
              <Text font={15} fontWeight="bold" foregroundStyle="#FFD60A">
                {zoomFactor.toFixed(zoomFactor % 1 === 0 ? 0 : 1)}×
              </Text>
            </ZStack>
          </Button>
        </VStack>
      </VStack>
    </ZStack>
  );
}
