import { HStack, Text, TextField, Button, Image } from "scripting";

export function FormRow({ label, value, onChanged, prompt, autofocus = false }: {
  label: string;
  value: string;
  onChanged: (v: string) => void;
  prompt?: string;
  autofocus?: boolean;
}) {
  return (
    <HStack alignment="center" spacing={12} padding={{ vertical: 4 }}>
      <Text frame={{ width: 75, alignment: "leading" }} foregroundStyle="#333333">{label}</Text>
      <TextField label={<Text>{"l"}</Text>} value={value} onChanged={onChanged} prompt={prompt} autofocus={autofocus} />
      {value.length > 0 ? (
        <Button action={() => onChanged("")} buttonStyle="plain">
          <Image systemName="xmark.circle.fill" foregroundStyle="#C7C7CC" font="subheadline" />
        </Button>
      ) : undefined}
    </HStack>
  );
}
