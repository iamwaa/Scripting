import { VStack, HStack, Text, TextField, Image, RoundedRectangle } from "scripting";

export function InputField({
  title,
  value,
  onChanged,
  onSubmit,
  icon,
  placeholder,
  singleLine,
  footer
}: {
  title: string;
  value: string;
  onChanged: (value: string) => void;
  onSubmit?: () => void;
  icon?: string;
  placeholder?: string;
  singleLine?: boolean;
  footer?: string;
}) {
  const inner = singleLine ? (
    <TextField
      title={title}
      value={value}
      onChanged={onChanged}
      onSubmit={onSubmit}
      prompt={placeholder}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
    />
  ) : (
    <TextField
      title={title}
      value={value}
      onChanged={onChanged}
      onSubmit={onSubmit}
      prompt={placeholder}
      axis="vertical"
      frame={{ maxWidth: Infinity, alignment: "leading" }}
    />
  );

  const inputRow = (
    <HStack
      spacing={8}
      padding={{ vertical: singleLine ? 8 : 12, horizontal: 12 }}
      alignment={singleLine ? "center" : "top"}
      frame={{ maxWidth: Infinity, alignment: "leading" }}
      background={<RoundedRectangle cornerRadius={10} fill="tertiarySystemFill" />}
    >
      {icon ? (
        singleLine ? (
          <Image systemName={icon} font={15} foregroundStyle="gray" />
        ) : (
          <Image systemName={icon} font={15} foregroundStyle="gray" padding={{ top: 2 }} />
        )
      ) : null}
      {inner}
    </HStack>
  );

  if (!footer) return inputRow;

  return (
    <VStack spacing={6} alignment="leading" frame={{ maxWidth: Infinity }}>
      {inputRow}
      <Text font={11} foregroundStyle="gray" padding={{ horizontal: 4 }}>
        {footer}
      </Text>
    </VStack>
  );
}
