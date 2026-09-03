/**
 * components/ImageDiffPreview.tsx - Diff 页二进制图片预览
 *
 * 修改的图片显示「原版本 / 新版本」两块，新增/删除只显示存在的一侧。
 * 缩略图用 UIImage 解码（失败回退占位）；点击经 onOpen 上抛 data URL，
 * 由页面 fullScreenCover + ImageViewer 全屏查看（缩放交给 WebKit）。
 */

import { Button, HStack, Image, Text, VStack, useMemo } from "scripting"
import type { ImagePreviewVersion } from "../services/diffService"
import { buildImageDataUrl, formatBytes } from "../utils/imageDiff"
import {
  COLOR_SECONDARY_LABEL,
  COLOR_TERTIARY_BG,
  COLOR_TERTIARY_LABEL,
} from "../constants/colors"

/** 扩展名大写展示（如 png → PNG） */
function extLabel(filepath: string): string {
  const idx = filepath.lastIndexOf(".")
  return idx < 0 ? "" : filepath.slice(idx + 1).toUpperCase()
}

/** 单个版本的缩略图卡片 */
function PreviewVersionView({
  label,
  filepath,
  version,
  onOpen,
}: {
  label: string
  filepath: string
  version: ImagePreviewVersion
  onOpen: (dataUrl: string) => void
}) {
  // base64 解码失败（损坏图片）返回 null，回退占位
  const image = useMemo(
    () => UIImage.fromBase64String(version.base64),
    [version.base64]
  )
  const meta = [extLabel(filepath), formatBytes(version.bytes)]
    .filter(Boolean)
    .join(" · ")

  return (
    <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={6} alignment="center">
        <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
          {label}
        </Text>
        {meta ? (
          <Text font={11} foregroundStyle={COLOR_TERTIARY_LABEL}>
            {meta}
          </Text>
        ) : null}
      </HStack>
      <Button
        buttonStyle="plain"
        action={() => onOpen(buildImageDataUrl(version.mime, version.base64))}
      >
        {image ? (
          <VStack
            frame={{ maxWidth: "infinity", minHeight: 120 }}
            background={COLOR_TERTIARY_BG}
            alignment="center"
          >
            <Image
              image={image}
              resizable
              scaleToFit
              aspectRatio={{ value: null, contentMode: "fit" }}
              frame={{ maxWidth: "infinity", maxHeight: 320 }}
            />
          </VStack>
        ) : (
          <HStack
            spacing={8}
            alignment="center"
            frame={{ maxWidth: "infinity", minHeight: 80 }}
            background={COLOR_TERTIARY_BG}
            padding={12}
          >
            <Image
              systemName="photo"
              font={18}
              foregroundStyle={COLOR_TERTIARY_LABEL}
            />
            <Text font={13} foregroundStyle={COLOR_SECONDARY_LABEL}>
              无法解码预览，点击尝试全屏查看
            </Text>
          </HStack>
        )}
      </Button>
    </VStack>
  )
}

/** 二进制图片 diff 预览：旧/新版本并排或单侧展示 */
export function ImageDiffPreview({
  filepath,
  oldVersion,
  newVersion,
  onOpen,
}: {
  filepath: string
  oldVersion: ImagePreviewVersion | null
  newVersion: ImagePreviewVersion | null
  onOpen: (dataUrl: string) => void
}) {
  // 两个版本都在时并排（各占一半），否则单侧铺满
  const sideBySide = oldVersion != null && newVersion != null
  return (
    <VStack alignment="leading" spacing={14} frame={{ maxWidth: "infinity" }}>
      {sideBySide ? (
        <HStack spacing={12} alignment="top" frame={{ maxWidth: "infinity" }}>
          <PreviewVersionView
            label="原版本"
            filepath={filepath}
            version={oldVersion!}
            onOpen={onOpen}
          />
          <PreviewVersionView
            label="新版本"
            filepath={filepath}
            version={newVersion!}
            onOpen={onOpen}
          />
        </HStack>
      ) : newVersion ? (
        <PreviewVersionView
          label="新版本"
          filepath={filepath}
          version={newVersion}
          onOpen={onOpen}
        />
      ) : oldVersion ? (
        <PreviewVersionView
          label="原版本"
          filepath={filepath}
          version={oldVersion}
          onOpen={onOpen}
        />
      ) : null}
    </VStack>
  )
}
