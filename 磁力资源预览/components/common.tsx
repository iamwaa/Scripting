// 通用小组件：导航按钮、信息行、胶囊按钮与折叠输入卡

import { Button, HStack, Image, Text, VStack } from "scripting";

import { BLUE } from "../constants";
import { glassSurface } from "./glass";

export function BackButton({ action }: { action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Image systemName="chevron.left" fontWeight="semibold" foregroundStyle="#007AFF" />
    </Button>
  );
}

export function CloseButton({ action }: { action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Image systemName="xmark" foregroundStyle="#FF3B30" fontWeight="semibold" />
    </Button>
  );
}

export function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text foregroundStyle="secondaryLabel" font={15}>{label}：</Text>
      <Text foregroundStyle="secondaryLabel" font={15} textSelection frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {String(value)}
      </Text>
    </HStack>
  );
}

export function SmallGlassButton({ title, action }: { title: string; action: () => void }) {
  return (
    <Button action={action} buttonStyle="plain">
      <Text
        font={13}
        fontWeight="semibold"
        padding={{ vertical: 7, horizontal: 10 }}
        {...glassSurface(14, "control", true, false)}
      >
        {title}
      </Text>
    </Button>
  );
}

/** 折叠状态下展示当前输入内容，点击可重新展开输入区 */
export function CompactInputCard({
  icon,
  title,
  value,
  placeholder,
  action,
  centerValue = false,
}: {
  icon: string;
  title: string;
  value: string;
  placeholder: string;
  action: () => void;
  centerValue?: boolean;
}) {
  return (
    <Button action={action} buttonStyle="plain">
      <HStack
        spacing={10}
        padding={{ vertical: 12, horizontal: 14 }}
        frame={{ maxWidth: "infinity" }}
        {...glassSurface(20, "control")}
      >
        <Image systemName={icon} frame={{ width: 18, height: 18 }} foregroundStyle={BLUE} />
        <VStack alignment={centerValue ? "center" : "leading"} spacing={2} frame={{ maxWidth: "infinity" }}>
          <Text font={13} fontWeight="semibold" foregroundStyle="secondaryLabel">{title}</Text>
          <Text
            font={15}
            lineLimit={1}
            truncationMode="middle"
            foregroundStyle={value ? "label" : "secondaryLabel"}
            frame={centerValue ? { maxWidth: "infinity", alignment: "center" } : undefined}
          >
            {value || placeholder}
          </Text>
        </VStack>
        <Image systemName="chevron.down" frame={{ width: 13, height: 13 }} foregroundStyle={BLUE} fontWeight="semibold" />
      </HStack>
    </Button>
  );
}
