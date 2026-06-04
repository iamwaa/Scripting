import { useState, useEffect, List, Section, VStack, HStack, ZStack, Text, Button, Image, Navigation, RoundedRectangle } from "scripting";
import { QrRecord } from "../types/types";
import { GlassCard } from "../components/GlassCard";
import { InputField } from "../components/InputField";
import { getQrImage } from "../utils/qr";
import { isProbablyURL, getValidURL } from "../utils/url";

export function GenerateView({ onAddRecord }: { onAddRecord: (record: QrRecord) => void }) {
  const dismiss = Navigation.useDismiss();
  const [content, setContent] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewImage, setPreviewImage] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);

  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  useEffect(() => {
    const text = content.trim();
    if (!text) {
      setPreviewContent("");
      setPreviewImage(null);
      return;
    }

    let cancelled = false;
    setIsGenerating(true);
    getQrImage(text)
      .then((img) => {
        if (cancelled) return;
        setPreviewContent(text);
        setPreviewImage(img ?? null);
      })
      .finally(() => {
        if (!cancelled) setIsGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  const handleGenerateAndSave = async () => {
    const text = content.trim();
    if (!text) return;
    onAddRecord({ id: Date.now().toString(), content: text, timestamp: Date.now(), type: "GENERATE" });
    setPreviewContent(text);
    setPreviewImage(await getQrImage(text));
    notify("已保存到历史记录");
  };

  // 保存图片到相册，失败则降级使用系统分享面板
  const handleSaveImage = async () => {
    if (!previewImage) return;
    setIsSaving(true);
    
    try {
      const imageData = previewImage.toPNGData(); 
      const ok = await Photos.savePhoto(imageData, {
        fileName: `qr-${Date.now()}.png`
      });
      
      if (ok) {
        notify("已保存到相册");
      } else {
        throw new Error("写入系统相册被拒绝");
      }
    } catch (error: any) {
      console.error("相册存储失败：", error);
      notify("保存失败，请使用分享面板存储");
      
      try {
        await ShareSheet.present([previewImage]);
      } catch (shareError) {
        console.log("用户取消了分享");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    const text = previewContent.trim();
    if (!text) return;
    if (isProbablyURL(text)) {
      await Safari.present(getValidURL(text), true);
      return;
    }
    await Pasteboard.setString(text);
    notify("不是链接，已复制到剪贴板");
  };

  return (
    <List
      navigationTitle="生成"
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
          <VStack spacing={10} alignment="leading" frame={{ maxWidth: Infinity }}>
            <Text fontWeight="semibold">二维码内容</Text>
            
            <InputField
              title="输入文本或网址..."
              value={content}
              onChanged={setContent}
              onSubmit={handleGenerateAndSave}
              icon="text.cursor"
            />

            <Button 
              action={() => {
                Keyboard.hide();
                handleGenerateAndSave();
              }} 
              disabled={!content.trim()} 
              buttonStyle="borderedProminent"
            >
              <HStack spacing={6} frame={{ maxWidth: Infinity, alignment: "center" }} padding={6}>
                <Image systemName="qrcode" font={16} />
                <Text fontWeight="bold">保存二维码</Text>
              </HStack>
            </Button>

            <HStack spacing={8} frame={{ maxWidth: Infinity, alignment: "center" }}>
              <Button 
                action={handleSaveImage} 
                disabled={!previewImage || isSaving} 
                buttonStyle="bordered"
              >
                <HStack spacing={4} frame={{ maxWidth: Infinity, alignment: "center" }} padding={2}>
                  <Image systemName="square.and.arrow.down" font={14} />
                  <Text font={13}>{isSaving ? "保存中..." : "保存图片"}</Text>
                </HStack>
              </Button>

              <Button 
                action={handlePreview} 
                disabled={!previewContent} 
                buttonStyle="bordered"
              >
                <HStack spacing={4} frame={{ maxWidth: Infinity, alignment: "center" }} padding={2}>
                  <Image systemName="safari" font={14} />
                  <Text font={13}>打开链接</Text>
                </HStack>
              </Button>
            </HStack>
          </VStack>
        </GlassCard>
      </Section>

      {previewContent ? (
        <Section title="实时预览">
          <GlassCard padding={8}>
            <VStack spacing={12} alignment="center" frame={{ maxWidth: Infinity }}>
              <ZStack
                frame={{ width: 180, height: 180, alignment: "center" }}
                background={<RoundedRectangle cornerRadius={12} fill="secondarySystemGroupedBackground" />}
              >
                {previewImage ? (
                  <Image image={previewImage} resizable={true} frame={{ width: 180, height: 180 }} />
                ) : (
                  <VStack spacing={6} alignment="center">
                    <Image systemName="arrow.triangle.2.circlepath" foregroundStyle="gray" font={20} />
                    <Text font={12} foregroundStyle="gray">{isGenerating ? "生成中..." : "暂无预览"}</Text>
                  </VStack>
                )}
              </ZStack>

              <VStack spacing={4} alignment="center">
                <Text font={11} foregroundStyle="gray">当前内容：</Text>
                <Text font={13} fontWeight="medium" lineLimit={3}>{previewContent}</Text>
              </VStack>
            </VStack>
          </GlassCard>
        </Section>
      ) : null}
    </List>
  );
}
