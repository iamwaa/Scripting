// 收藏列表行

import { Button, HStack, Image, Text, VStack, ZStack } from "scripting";

import { INPUT_GLASS_FILL } from "../constants";
import type { FavoriteItem } from "../types";
import { formatBytes } from "../utils/format";
import { GlassShape, glassSurface } from "./glass";

export function FavoriteRow({
  item,
  onOpen,
  onDelete,
}: {
  item: FavoriteItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <HStack spacing={6} padding={12} {...glassSurface(20, "card")}>
      {item.cover ? (
        <Image imageUrl={item.cover} resizable frame={{ width: 68, height: 50 }} clipShape={{ type: "rect", cornerRadius: 14 }} />
      ) : (
        <ZStack frame={{ width: 68, height: 50 }} background={<GlassShape cornerRadius={14} fill={INPUT_GLASS_FILL} />}>
          <Image systemName="doc" foregroundStyle="secondaryLabel" />
        </ZStack>
      )}
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text font={14} fontWeight="semibold" lineLimit={1} truncationMode="middle">{item.name}</Text>
        <Text font={12} foregroundStyle="secondaryLabel">
          {formatBytes(item.size)} · {item.count} 个文件 · {item.fileType.toUpperCase()}
        </Text>
      </VStack>
      <Button title="打开" font={16} action={onOpen} buttonStyle="glass" />
      <Button title="删除" font={16} role="destructive" action={onDelete} buttonStyle="glass" foregroundStyle="red" />
    </HStack>
  );
}
