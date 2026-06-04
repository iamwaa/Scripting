import { useState, useMemo, List, Section, VStack, HStack, Text, Button, Image, TextField, RoundedRectangle } from "scripting";
import { compareMixed, getFirstLetter } from "../utils/pinyin";

export function KeywordManagerView({
  keywordString,
  onKeywordsChange,
  onBack,
}: {
  keywordString: string;
  onKeywordsChange: (keywords: string) => void;
  onBack: () => void;
}) {
  const [keywords, setKeywords] = useState<string[]>(() =>
    keywordString.split(/[,，]/).map(k => k.trim()).filter(Boolean)
  );
  const [inputText, setInputText] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  const groupedKeywords = useMemo(() => {
    const sorted = [...keywords].sort((a, b) => compareMixed(a, b));
    const groups: { letter: string; words: string[] }[] = [];
    let currentLetter = "";
    for (const kw of sorted) {
      const letter = getFirstLetter(kw);
      if (letter !== currentLetter) {
        currentLetter = letter;
        groups.push({ letter, words: [] });
      }
      groups[groups.length - 1].words.push(kw);
    }
    return groups;
  }, [keywords]);

  const handleAdd = () => {
    const input = inputText.trim();
    if (!input) { notify("请输入关键词"); return; }
    const newKws = input.split(/[,，]/).map(k => k.trim()).filter(Boolean);
    if (newKws.length === 0) { notify("请输入关键词"); return; }

    const existingLower = keywords.map(k => k.toLowerCase());
    const toAdd: string[] = [];
    let skipped = 0;
    for (const kw of newKws) {
      if (existingLower.includes(kw.toLowerCase())) {
        skipped++;
      } else {
        toAdd.push(kw);
        existingLower.push(kw.toLowerCase());
      }
    }

    if (toAdd.length === 0) { notify("关键词均已存在"); return; }
    const updated = [...keywords, ...toAdd];
    setKeywords(updated);
    onKeywordsChange(updated.join(","));
    setInputText("");
    const msg = skipped > 0 ? `已添加 ${toAdd.length} 个，跳过 ${skipped} 个重复` : `已添加 ${toAdd.length} 个关键词`;
    notify(msg);
  };

  const handleDelete = (kw: string) => {
    const updated = keywords.filter(k => k !== kw);
    setKeywords(updated);
    onKeywordsChange(updated.join(","));
    notify("已删除");
  };

  const handleBack = () => {
    const sorted = [...keywords].sort((a, b) => compareMixed(a, b));
    onKeywordsChange(sorted.join(","));
    onBack();
  };

  const toggleSelect = (kw: string) => {
    setSelectedKeywords(prev => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedKeywords.size === keywords.length && keywords.length > 0) {
      setSelectedKeywords(new Set());
    } else {
      setSelectedKeywords(new Set(keywords));
    }
  };

  const enterSelectionMode = () => {
    setSelectedKeywords(new Set());
    setSelectionMode(true);
  };

  const exitSelectionMode = () => {
    setSelectedKeywords(new Set());
    setSelectionMode(false);
  };

  const handleMultiCopy = async () => {
    const selected = [...selectedKeywords];
    await Pasteboard.setString(selected.join(","));
    notify(`已复制 ${selected.length} 个关键词`);
    exitSelectionMode();
  };

  const handleMultiDelete = async () => {
    if (selectedKeywords.size === 0) return;
    const ok = await Dialog.confirm({
      title: "批量删除",
      message: `确定要删除选中的 ${selectedKeywords.size} 个关键词吗？`
    });
    if (ok) {
      const updated = keywords.filter(k => !selectedKeywords.has(k));
      setKeywords(updated);
      onKeywordsChange(updated.join(","));
      notify(`已删除 ${selectedKeywords.size} 个关键词`);
      exitSelectionMode();
    }
  };

  return (
    <List
      navigationTitle="关键词管理"
      navigationBarTitleDisplayMode="inline"
      navigationBarBackButtonHidden={true}
      toolbar={{
        topBarLeading: selectionMode ? (
          <Button action={exitSelectionMode}>
            <Text foregroundStyle="red" fontWeight="semibold">取消</Text>
          </Button>
        ) : (
          <Button action={handleBack}>
            <HStack spacing={4}>
              <Image systemName="chevron.left" foregroundStyle="accentColor" fontWeight="semibold" />
            </HStack>
          </Button>
        ),
        topBarTrailing: selectionMode ? (
          <Button action={toggleSelectAll}>
            <Text foregroundStyle="accentColor" fontWeight="semibold">
              {selectedKeywords.size === keywords.length && keywords.length > 0 ? "取消全选" : "全选"}
            </Text>
          </Button>
        ) : (
          <Button action={enterSelectionMode} disabled={keywords.length === 0}>
            <Text foregroundStyle={keywords.length === 0 ? "gray" : "accentColor"} fontWeight="semibold">选择</Text>
          </Button>
        ),
        bottomBar: selectionMode ? (
          <HStack spacing={16} alignment="center" padding={{ horizontal: 10 }}>
            <Button action={handleMultiCopy} disabled={selectedKeywords.size === 0}>
              <HStack spacing={4} alignment="center">
                <Image systemName="doc.on.doc" font="footnote" fontWeight="semibold" foregroundStyle={selectedKeywords.size === 0 ? "gray" : "accentColor"} />
                <Text font="footnote" fontWeight="semibold" foregroundStyle={selectedKeywords.size === 0 ? "gray" : "accentColor"}>
                  复制{selectedKeywords.size > 0 ? `(${selectedKeywords.size})` : ""}
                </Text>
              </HStack>
            </Button>
            <Button action={handleMultiDelete} disabled={selectedKeywords.size === 0}>
              <HStack spacing={4} alignment="center">
                <Image systemName="trash" font="footnote" fontWeight="semibold" foregroundStyle={selectedKeywords.size === 0 ? "gray" : "red"} />
                <Text font="footnote" fontWeight="semibold" foregroundStyle={selectedKeywords.size === 0 ? "gray" : "red"}>
                  删除{selectedKeywords.size > 0 ? `(${selectedKeywords.size})` : ""}
                </Text>
              </HStack>
            </Button>
          </HStack>
        ) : undefined
      }}
      toast={{
        isPresented: showToast,
        onChanged: setShowToast,
        message: toastMessage,
        position: "top",
        duration: 2,
      }}
    >
      {!selectionMode && (
        <Section padding={-10} header={<Text>新增关键词</Text>} footer={<Text>支持用逗号分隔同时添加多个关键词</Text>}>
          <HStack spacing={8} alignment="center" padding={4}>
            <TextField
              label={<Text>{" "}</Text>}
              value={inputText}
              onChanged={setInputText}
              prompt="请输入内容"
              onSubmit={handleAdd}
            />
            <Button action={handleAdd} disabled={!inputText.trim()} buttonStyle="borderedProminent">
              <HStack spacing={4} alignment="center" padding={{ horizontal: 10, vertical: 6 }}>
                <Image systemName="plus" font={14} />
                <Text font={14} fontWeight="semibold">添加</Text>
              </HStack>
            </Button>
          </HStack>
        </Section>
      )}

      {groupedKeywords.length > 0 ? (
        groupedKeywords.map(group => (
          <Section key={group.letter} header={<Text>{group.letter}</Text>}>
            {group.words.map(kw => (
              selectionMode ? (
                <HStack key={kw} spacing={10} alignment="center" frame={{ maxWidth: Infinity }} padding={{ vertical: 6 }}
                  background={<RoundedRectangle cornerRadius={10} fill="secondarySystemGroupedBackground" />}
                  onTapGesture={() => toggleSelect(kw)}
                >
                  <Image
                    systemName={selectedKeywords.has(kw) ? "checkmark.circle.fill" : "circle"}
                    font={20}
                    foregroundStyle={selectedKeywords.has(kw) ? "accentColor" : "systemGray2"}
                  />
                  <Text font={15} fontWeight="medium" frame={{ maxWidth: Infinity, alignment: "leading" }}>{kw}</Text>
                </HStack>
              ) : (
                <HStack key={kw} spacing={10} alignment="center" frame={{ maxWidth: Infinity }} padding={{ vertical: 4 }}>
                  <Text font={15} fontWeight="medium" frame={{ maxWidth: Infinity, alignment: "leading" }}>{kw}</Text>
                  <Button action={() => handleDelete(kw)} buttonStyle="plain">
                    <Image systemName="minus.circle.fill" foregroundStyle="red" font={20} />
                  </Button>
                </HStack>
              )
            ))}
          </Section>
        ))
      ) : (
        <Section>
          <VStack padding={40} spacing={12} alignment="center" frame={{ maxWidth: Infinity }}>
            <Image systemName="tag" font={36} foregroundStyle="gray" />
            <Text foregroundStyle="gray" fontWeight="medium">暂无关键词</Text>
            <Text foregroundStyle="gray" font={12}>在上方输入框添加关键词</Text>
          </VStack>
        </Section>
      )}
    </List>
  );
}
