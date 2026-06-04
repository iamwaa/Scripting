import { VStack, Text, RoundedRectangle } from "scripting";

export function StatCard({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <VStack
      spacing={6}
      padding={12}
      alignment="leading"
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      background={<RoundedRectangle cornerRadius={12} fill="secondarySystemGroupedBackground" />}
    >
      <Text foregroundStyle="gray" font={13}>{icon} {title}</Text>
      <Text font={20} fontWeight="bold">{value}</Text>
    </VStack>
  );
}
