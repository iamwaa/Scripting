import { VStack, RoundedRectangle } from "scripting";

export function GlassCard({ children, padding = 10, onLongPressGesture }: { children: any; padding?: number; onLongPressGesture?: () => void }) {
  return (
    <VStack
      spacing={8}
      padding={padding}
      alignment="leading"
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      background={<RoundedRectangle cornerRadius={12} fill="secondarySystemGroupedBackground" />}
      onLongPressGesture={onLongPressGesture}
    >
      {children}
    </VStack>
  );
}
