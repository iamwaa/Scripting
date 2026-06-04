import { useState, useEffect, HStack, VStack, Text, Button, Image, Spacer, ZStack, RoundedRectangle } from "scripting";
import { QrRecord } from "../types/types";
import { getQrImage } from "../utils/qr";
import { formatTime } from "../utils/time";
import { isProbablyURL, getValidURL } from "../utils/url";

export function HistoryRow({ record, onDelete, notify, isSelectionMode, isSelected, onToggleSelect }: { 
  record: QrRecord; 
  onDelete: (id: string) => void; 
  notify: (message: string) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [image, setImage] = useState<any>(null);

  const handleCopy = async () => {
    await Pasteboard.setString(record.content);
    notify("已复制内容");
  };

  useEffect(() => {
    let cancelled = false;
    getQrImage(record.content).then((img) => {
      if (!cancelled) setImage(img ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [record.content]);

  const handleOpen = async () => {
    if (isProbablyURL(record.content)) {
      await Safari.openURL(getValidURL(record.content));
      return;
    }
    await Pasteboard.setString(record.content);
    notify("不是链接，已复制内容");
  };

  const handleSaveImage = async () => {
    if (!image) { notify("二维码图片尚未加载"); return; }
    try {
      const imageData = image.toPNGData();
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
      try {
        await ShareSheet.present([image]);
      } catch {}
    }
  };

  const handleDelete = async () => {
    try {
      const ok = await Dialog.confirm({ 
        title: "确认删除", 
        message: "确定要删除这条记录吗？" 
      });
      if (ok) {
        onDelete(record.id);
      }
    } catch (error) {
      console.error("删除确认弹窗失败:", error);
    }
  };

  const handleTap = () => {
    if (isSelectionMode) {
      onToggleSelect?.();
    } else {
      handleCopy();
    }
  };

  return (
    <HStack spacing={8} alignment="center" frame={{ maxWidth: Infinity }} onTapGesture={handleTap}>
        {isSelectionMode && (
          <Image 
            systemName={isSelected ? "checkmark.circle.fill" : "circle"} 
            font={22} 
            foregroundStyle={isSelected ? "accentColor" : "systemGray2"} 
          />
        )}
        <VStack spacing={8} padding={2} alignment="leading" frame={{ maxWidth: Infinity }} background={<RoundedRectangle cornerRadius={10} fill="secondarySystemGroupedBackground" />}>
          <HStack frame={{ maxWidth: Infinity }}>
            <HStack spacing={4} alignment="center">
              <Image
                systemName={record.type === "SCAN" ? "qrcode.viewfinder" : "plus.app"}
                font={11}
                foregroundStyle="gray"
                fontWeight="bold"
              />
              <Text font={11} foregroundStyle="gray" fontWeight="bold">
                {record.type === "SCAN" ? "扫码" : "生成"}
              </Text>
            </HStack>
            <Spacer />
            <Text font={10} foregroundStyle="gray">{formatTime(record.timestamp)}</Text>
          </HStack>

          <HStack spacing={8} alignment="center" frame={{ maxWidth: Infinity }}>
            <ZStack frame={{ width: 48, height: 48 }} background={<RoundedRectangle cornerRadius={4} fill="tertiarySystemFill" />}>
              {image && (
                <Image image={image} resizable={true} frame={{ width: 48, height: 48 }} />
              )}
            </ZStack>

            <VStack spacing={6} alignment="leading" frame={{ maxWidth: Infinity }}>
              <Text font={13} frame={{ maxWidth: Infinity, alignment: "leading" }}>{record.content}</Text>
              
              {!isSelectionMode && (
                <HStack spacing={12} frame={{ maxWidth: Infinity }}>
                  <Spacer />
                  <Button action={handleSaveImage} buttonStyle="plain">
                    <HStack spacing={3} alignment="center">
                      <Image systemName="square.and.arrow.down" font={11} foregroundStyle="accentColor" />
                      <Text font={12} foregroundStyle="accentColor">保存图片</Text>
                    </HStack>
                  </Button>
                  <Button action={handleOpen} buttonStyle="plain">
                    <HStack spacing={3} alignment="center">
                      <Image systemName="safari" font={11} foregroundStyle="accentColor" />
                      <Text font={12} foregroundStyle="accentColor">打开</Text>
                    </HStack>
                  </Button>
                  <Button action={handleDelete} buttonStyle="plain">
                    <HStack spacing={3} alignment="center">
                      <Image systemName="trash" font={11} foregroundStyle="red" />
                      <Text font={12} foregroundStyle="red">删除</Text>
                    </HStack>
                  </Button>
                </HStack>
              )}
            </VStack>
          </HStack>
        </VStack>
      </HStack>
  );
}
