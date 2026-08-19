// 磁力搜索结果行

import { HStack, Spacer, Text, VStack } from "scripting";

import type { XciliSearchItem } from "../types";
import { SmallGlassButton } from "./common";
import { glassSurface } from "./glass";

export function SearchResultRow({
  item,
  loading,
  loadingDetail,
  onUseMagnet,
  onShowDetail,
}: {
  item: XciliSearchItem;
  loading: boolean;
  loadingDetail: boolean;
  onUseMagnet: () => void;
  onShowDetail: () => void;
}) {
  return (
    <VStack alignment="leading" spacing={10} padding={14} frame={{ maxWidth: "infinity" }} {...glassSurface(22, "card")}>
      <Text font={16} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }} textSelection>
        {item.title}
      </Text>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Text font={13} foregroundStyle="secondaryLabel">{item.size}</Text>
        {item.date ? <Text font={13} foregroundStyle="secondaryLabel">{item.date}</Text> : undefined}
        <Spacer />
        <SmallGlassButton title={loadingDetail ? "加载中…" : "文件列表"} action={onShowDetail} />
        <SmallGlassButton title={loading ? "获取中…" : "使用磁力"} action={onUseMagnet} />
      </HStack>
    </VStack>
  );
}
