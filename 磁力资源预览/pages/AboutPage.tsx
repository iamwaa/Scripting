// 关于页：集中展示三个来源服务信息

import { Button, HStack, Image, ScrollView, Text, VStack, ZStack } from "scripting";

import { glassSurface } from "../components/glass";
import { BLUE } from "../constants";

// 三个来源服务的统一描述
const SOURCES = [
  {
    icon: "link.circle",
    name: "whatslink.info",
    desc: "磁力资源预览。粘贴磁力链接后，获取资源名称、大小、类型与截图。",
    url: "https://whatslink.info/",
  },
  {
    icon: "magnifyingglass.circle",
    name: "xcili.net",
    desc: "磁力搜索。按电影、剧集或资源名称关键词，查找可用磁力链接。",
    url: "https://xcili.net/",
  },
  {
    icon: "viewfinder",
    name: "whos.tv",
    desc: "以图搜片。上传影片截图识别番号，再跳转磁力搜索。",
    url: "https://whos.tv/",
  },
];

export function AboutPage() {
  return (
    <ScrollView navigationTitle="关于" navigationBarTitleDisplayMode="inline">
      <VStack alignment="leading" spacing={16} padding={18} frame={{ maxWidth: "infinity" }}>
        {/* 应用简介 */}
        <VStack alignment="center" spacing={12} padding={30} frame={{ maxWidth: "infinity" }} {...glassSurface(28, "card", false)}>
          <ZStack frame={{ width: 60, height: 60 }} {...glassSurface(22, "icon", false, false)}>
            <Image systemName="link" resizable frame={{ width: 30, height: 30 }} foregroundStyle={BLUE} />
          </ZStack>
          <Text font={22} fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "center" }}>磁力资源预览</Text>
          <Text
            font={16}
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="center"
            frame={{ maxWidth: "infinity", alignment: "center" }}
          >
            集成磁力预览、磁力搜索与以图搜片，聚合三个外部服务。
          </Text>
        </VStack>

        {/* 来源信息列表 */}
        <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
          <Text font={20} fontWeight="bold" padding={{ horizontal: 4 }}>数据来源</Text>
          {SOURCES.map((src) => (
            <VStack key={src.name} alignment="leading" spacing={10} padding={16} frame={{ maxWidth: "infinity" }} {...glassSurface(22, "card")}>
              <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <ZStack frame={{ width: 40, height: 40 }} {...glassSurface(14, "icon", false, false)}>
                  <Image systemName={src.icon} frame={{ width: 20, height: 20 }} foregroundStyle={BLUE} />
                </ZStack>
                <Text font={16} fontWeight="semibold">{src.name}</Text>
              </HStack>
              <Text
                font={14}
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="leading"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                {src.desc}
              </Text>
              <HStack spacing={10} frame={{ maxWidth: "infinity", alignment: "center" }}>
                <Button action={() => void Safari.present(src.url, true)} buttonStyle="plain">
                  <Text
                    font={13}
                    fontWeight="semibold"
                    padding={{ vertical: 8, horizontal: 12 }}
                    {...glassSurface(14, "control", true, false)}
                    foregroundStyle={BLUE}
                  >
                    查看接口与服务说明
                  </Text>
                </Button>
              </HStack>
            </VStack>
          ))}
        </VStack>

        <Text
          font={12}
          foregroundStyle="secondaryLabel"
          multilineTextAlignment="center"
          frame={{ maxWidth: "infinity", alignment: "center" }}
        >
          本应用仅聚合展示以上公开服务的数据，不存储任何资源。
        </Text>
      </VStack>
    </ScrollView>
  );
}
