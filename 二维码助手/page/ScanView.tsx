import { useState, useEffect, List, Section, VStack, HStack, Text, Button, Picker, Image, Toggle, Navigation, Spacer } from "scripting";
import { QrRecord, ScanMode, RedirectRule } from "../types/types";
import { GlassCard } from "../components/GlassCard";
import { matchRedirectRule } from "../utils/redirectRules";
import { RedirectConfigView } from "./RedirectConfigView";
import { CameraScanView } from "./CameraScanView";

export function ScanView({
  onAddRecord,
  autoScanOnOpen,
  onAutoScanChange,
  autoRedirect,
  redirectRules,
  onAutoRedirectChange,
  onRedirectRulesChange,
  fallbackEnabled,
  onFallbackEnabledChange,
  fallbackUrlScheme,
  onFallbackUrlSchemeChange,
  subscriptionUrl,
  onSubscriptionUrlChange,
  isConfigOpen,
  onConfigToggle
}: {
  onAddRecord: (record: QrRecord) => void;
  autoScanOnOpen: boolean;
  onAutoScanChange: (value: boolean) => void;
  autoRedirect: boolean;
  redirectRules: RedirectRule[];
  onAutoRedirectChange: (value: boolean) => void;
  onRedirectRulesChange: (rules: RedirectRule[]) => void;
  fallbackEnabled: boolean;
  onFallbackEnabledChange: (value: boolean) => void;
  fallbackUrlScheme: string;
  onFallbackUrlSchemeChange: (value: string) => void;
  subscriptionUrl: string;
  onSubscriptionUrlChange: (value: string) => void;
  isConfigOpen: boolean;
  onConfigToggle: (open: boolean) => void;
}) {
  const dismiss = Navigation.useDismiss();
  const [isLaunching, setIsLaunching] = useState(false);
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>("single");
  const [sessionResults, setSessionResults] = useState<string[]>([]);
  const [didAutoLaunch, setDidAutoLaunch] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  const copyResult = async (content: string) => {
    await Pasteboard.setString(content);
    notify("已复制到剪贴板");
  };

  const appendScanRecord = (content: string) => {
    onAddRecord({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      timestamp: Date.now(),
      type: "SCAN"
    });
    setSessionResults(prev => [content, ...prev]);
  };

  const tryRedirect = async (content: string) => {
    if (!autoRedirect) return;
    
    const parseUrl = (scheme: string) => {
      return scheme
        .replace(/{content}/g, encodeURIComponent(content))
        .replace(/{url}/g, content);
    };

    const rule = matchRedirectRule(content, redirectRules);
    
    if (rule) {
      try {
        await Safari.openURL(parseUrl(rule.urlScheme));
        notify(`已跳转到${rule.appName}`);
      } catch {
        notify(`跳转${rule.appName}失败，可能未安装该应用`);
      }
    } 
    else if (fallbackEnabled && fallbackUrlScheme.trim()) {
      try {
        await Safari.openURL(parseUrl(fallbackUrlScheme.trim()));
        notify(`已兜底跳转`);
      } catch {
        notify(`兜底跳转失败`);
      }
    }
  };

  const handleStartScan = async () => {
    if (isLaunching) return;
    setIsLaunching(true);
    try {
      // 打开相机风格扫码页面
      const result = await Navigation.present({
        element: (
          <CameraScanView
            scanMode={scanMode}
            onScanModeChange={setScanMode}
            onScanResult={(content) => {
              appendScanRecord(content);
              tryRedirect(content);
            }}
          />
        ),
        modalPresentationStyle: "fullScreen"
      });
    } finally {
      setIsLaunching(false);
    }
  };

  const handlePhotoScan = async () => {
    if (isPickingPhoto) return;
    setIsPickingPhoto(true);
    try {
      const images = await Photos.pickPhotos(1);
      const image = images?.[0];
      if (!image) return;

      const result = await QRCode.parseImage(image);
      if (!result) {
        notify("未识别到二维码，请换一张更清晰的图片");
        return;
      }

      appendScanRecord(result);
      tryRedirect(result);
      notify("识别成功");
    } finally {
      setIsPickingPhoto(false);
    }
  };

  useEffect(() => {
    if (!autoScanOnOpen || didAutoLaunch) return;
    setDidAutoLaunch(true);
    handleStartScan();
  }, [autoScanOnOpen, didAutoLaunch]);

  if (isConfigOpen) {
    return (
      <RedirectConfigView
        rules={redirectRules}
        onRulesChange={onRedirectRulesChange}
        onBack={() => onConfigToggle(false)}
        fallbackEnabled={fallbackEnabled}
        onFallbackEnabledChange={onFallbackEnabledChange}
        fallbackUrlScheme={fallbackUrlScheme}
        onFallbackUrlSchemeChange={onFallbackUrlSchemeChange}
        subscriptionUrl={subscriptionUrl}
        onSubscriptionUrlChange={onSubscriptionUrlChange}
      />
    );
  }

  return (
    <List
      navigationTitle="扫码"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: (
          <Button action={() => dismiss()} buttonStyle="plain">
            <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
          </Button>
        )
      }}
      toast={{
        isPresented: showToast,
        onChanged: setShowToast,
        message: toastMessage,
        position: "top",
        duration: 2,
      }}
    >
      <Section header={<Text>配置</Text>}>
        <GlassCard>
          <Text fontWeight="semibold">模式选择</Text>
          <Picker
            title="模式"
            value={scanMode}
            onChanged={(v: string) => setScanMode(v as ScanMode)}
            pickerStyle="palette"
          >
            <Text tag="single">单次扫码</Text>
            <Text tag="continuous">连续扫码</Text>
          </Picker>
          <Toggle 
            padding={4}
            title="启动时自动打开扫码"
            value={autoScanOnOpen}
            onChanged={onAutoScanChange}
            systemImage="viewfinder"
          />
          <Toggle 
            padding={4}
            title="识别后自动跳转 App"
            value={autoRedirect}
            onChanged={onAutoRedirectChange}
            systemImage="arrow.up.right"
          />
          {autoRedirect && (
            <Button
              action={() => onConfigToggle(true)}
              buttonStyle="plain"
              foregroundStyle="accentColor"
              frame={{ maxWidth: Infinity, alignment: "leading" }}
            >
              <HStack spacing={4}>
                <Image systemName="list.bullet" font={14} />
                <Text font={14}>管理跳转规则 ({redirectRules.length})</Text>
              </HStack>
            </Button>
          )}
          <HStack spacing={8} frame={{ maxWidth: Infinity }}>
            <Button action={handleStartScan} disabled={isLaunching} buttonStyle="borderedProminent" padding={4}>
              <HStack spacing={6} frame={{ maxWidth: Infinity, alignment: "center" }} padding={6}>
                <Image systemName="qrcode.viewfinder" font={16} />
                <Text fontWeight="bold">{isLaunching ? "启动中..." : "开始识别"}</Text>
              </HStack>
            </Button>
          </HStack>
          <Button 
            padding={-6} 
            title={isPickingPhoto ? "识别中..." : "相册识别"} 
            action={handlePhotoScan} 
            disabled={isPickingPhoto || isLaunching} 
            buttonStyle="plain"
            foregroundStyle="accentColor"
            font={14}
            frame={{ maxWidth: Infinity, alignment: "center" }} 
          />
        </GlassCard>
      </Section>

      {sessionResults.length > 0 && (
        <Section 
          header={
            <HStack frame={{ maxWidth: Infinity }}>
              <Text>{`本次结果 (${sessionResults.length})`}</Text>
              <Spacer />
              <Text font={12} foregroundStyle="gray">点击卡片复制</Text>
            </HStack>
          }
        >
          {sessionResults.map((result, idx) => (
            <Button key={idx} action={() => copyResult(result)} buttonStyle="plain">
              <GlassCard padding={2}>
                <VStack spacing={6} alignment="leading" frame={{ maxWidth: Infinity, alignment: "leading" }}>
                  <HStack frame={{ maxWidth: Infinity }}>
                    <Text font={12} foregroundStyle="gray">#{sessionResults.length - idx}</Text>
                    <Spacer />
                  </HStack>
                  <Text frame={{ maxWidth: Infinity, alignment: "leading" }}>{result}</Text>
                </VStack>
              </GlassCard>
            </Button>
          ))}
        </Section>
      )}
    </List>
  );
}
