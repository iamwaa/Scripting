// xcili 详情页：磁力信息与文件列表

import {
  Button,
  HStack,
  Image,
  Navigation,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "scripting";

import { BLUE } from "../constants";
import { BackButton, MetaLine } from "../components/common";
import { glassSurface } from "../components/glass";
import { useToast } from "../hooks/useToast";
import type { XciliDetailInfo } from "../types";

const MAX_VISIBLE_FILES = 30;

export function XciliDetailPage({ detail }: { detail: XciliDetailInfo }) {
  const dismiss = Navigation.useDismiss();
  const { notify, toastProps } = useToast();
  const files = detail.files.slice(0, MAX_VISIBLE_FILES);

  const handleCopyMagnet = async () => {
    if (!detail.magnet) return;
    await Pasteboard.setString(detail.magnet);
    await notify("磁力链接已复制到剪贴板");
  };

  return (
    <ScrollView
      navigationTitle="文件列表"
      navigationBarTitleDisplayMode="inline"
      navigationBarBackButtonHidden
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarLeading">
            <BackButton action={dismiss} />
          </ToolbarItem>
        </Toolbar>
      }
      toast={toastProps}
    >
      <VStack alignment="leading" spacing={16} padding={18} frame={{ maxWidth: "infinity" }}>
        <VStack alignment="leading" spacing={14} padding={18} frame={{ maxWidth: "infinity" }} {...glassSurface(28, "card")}>
          <HStack spacing={8}>
            <Image systemName="doc.text.magnifyingglass" frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
            <Text font={15} fontWeight="semibold" foregroundStyle="secondaryLabel">磁力信息</Text>
          </HStack>
          <Text font={20} fontWeight="bold" fixedSize={{ horizontal: false, vertical: true }} textSelection>
            {detail.title}
          </Text>
          {detail.magnet ? (
            <Button action={() => void handleCopyMagnet()} buttonStyle="plain">
              <Text
                textSelection
                font={14}
                padding={14}
                fixedSize={{ horizontal: false, vertical: true }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
                {...glassSurface(18, "input")}
              >
                {detail.magnet}
              </Text>
            </Button>
          ) : (
            <MetaLine label="磁力" value="未找到" />
          )}
        </VStack>

        <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
          <HStack padding={{ horizontal: 4 }}>
            <Text font={20} fontWeight="bold">文件列表</Text>
            <Spacer />
            <Text font={13} foregroundStyle="secondaryLabel">{detail.files.length} 个</Text>
          </HStack>
          {files.length > 0 ? (
            files.map((file, index) => (
              <VStack
                key={`${index}-${file.name}`}
                alignment="leading"
                spacing={6}
                padding={14}
                frame={{ maxWidth: "infinity" }}
                {...glassSurface(20, "card")}
              >
                <Text font={14} fontWeight="semibold" fixedSize={{ horizontal: false, vertical: true }} textSelection>
                  {file.name}
                </Text>
                <Text font={13} foregroundStyle="secondaryLabel">{file.size}</Text>
              </VStack>
            ))
          ) : (
            <VStack spacing={10} padding={24} frame={{ maxWidth: "infinity" }} {...glassSurface(20, "card")}>
              <Text foregroundStyle="secondaryLabel">未提取到文件列表</Text>
            </VStack>
          )}
          {detail.files.length > files.length ? (
            <Text font={12} foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "center" }}>
              仅显示前 {files.length} 个文件
            </Text>
          ) : undefined}
        </VStack>
      </VStack>
    </ScrollView>
  );
}
