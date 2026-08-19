// 空状态提示卡

import { Image, Text, VStack, ZStack } from "scripting";

import { BLUE } from "../constants";
import { glassSurface } from "./glass";

export function EmptyState() {
  return (
    <VStack
      spacing={14}
      padding={32}
      frame={{ maxWidth: "infinity", minHeight: 420 }}
      {...glassSurface(28, "card")}
    >
      <ZStack frame={{ width: 66, height: 66 }} {...glassSurface(24, "icon", false, false)}>
        <Image systemName="link.badge.plus" resizable frame={{ width: 34, height: 34 }} foregroundStyle={BLUE} />
      </ZStack>
      <Text font={20} fontWeight="bold">粘贴磁力链接</Text>
      <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">
        输入链接后点击「查询预览」，获取资源名称、大小、类型和截图信息。
      </Text>
    </VStack>
  );
}
