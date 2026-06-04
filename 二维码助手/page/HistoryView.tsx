import { useState, List, Section, VStack, HStack, Text, Button, Image, Spacer, Picker, Navigation, Toolbar, ToolbarItem, ToolbarSpacer, RoundedRectangle } from "scripting";
import { QrRecord } from "../types/types";
import { HistoryRow } from "./HistoryRow";

export function HistoryView({
  records,
  onClear,
  onDelete,
  onDeleteMultiple,
  selectionMode,
  onEnterSelectionMode,
  onExitSelectionMode
}: {
  records: QrRecord[];
  onClear: () => void | Promise<void>;
  onDelete: (id: string) => void;
  onDeleteMultiple: (ids: string[]) => void;
  selectionMode: boolean;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
}) {
  const dismiss = Navigation.useDismiss();
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  const scanCount = records.filter((r) => r.type === "SCAN").length;
  const generateCount = records.filter((r) => r.type === "GENERATE").length;

  const filteredRecords = records.filter((r) => {
    if (historyFilter === "scan") return r.type === "SCAN";
    if (historyFilter === "generate") return r.type === "GENERATE";
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length && filteredRecords.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)));
    }
  };

  const enterSelectionMode = () => {
    setSelectedIds(new Set());
    onEnterSelectionMode();
  };

  const exitSelectionMode = () => {
    setSelectedIds(new Set());
    onExitSelectionMode();
  };

  const handleClearHistory = async () => {
    setShowClearConfirm(false);
    await onClear();
    notify("已清空历史");
  };

  const clearConfirmPopover = (
    <VStack
      spacing={12}
      alignment="leading"
      padding={14}
      frame={{ width: 220 }}
    >
      <Text font={14} foregroundStyle="gray">
        清空后将删除所有历史记录，无法撤销。
      </Text>
      <Button action={handleClearHistory}>
        <HStack
          spacing={6}
          alignment="center"
          padding={{ horizontal: 14, vertical: 10 }}
          frame={{ maxWidth: Infinity }}
          background={<RoundedRectangle cornerRadius={10} fill="red" />}
        >
          <Image systemName="trash.fill" foregroundStyle="white" font="footnote" fontWeight="semibold" />
          <Text foregroundStyle="white" font="footnote" fontWeight="semibold">确认清空</Text>
        </HStack>
      </Button>
    </VStack>
  );

  const handleMultiCopy = async () => {
    const selected = records.filter(r => selectedIds.has(r.id));
    const text = selected.map(r => r.content).join("\n");
    await Pasteboard.setString(text);
    notify(`已复制 ${selected.length} 条记录`);
    exitSelectionMode();
  };

  const handleMultiDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const ok = await Dialog.confirm({
        title: "批量删除",
        message: `确定要删除选中的 ${selectedIds.size} 条记录吗？`
      });
      if (ok) {
        onDeleteMultiple(Array.from(selectedIds));
        notify(`已删除 ${selectedIds.size} 条记录`);
        exitSelectionMode();
      }
    } catch (error) {
      console.error("批量删除弹窗失败:", error);
    }
  };

  const historyToolbar = (
    <Toolbar>
      <ToolbarItem placement="topBarLeading">
        {selectionMode ? (
          <Button action={exitSelectionMode}>
            <Text foregroundStyle="red" fontWeight="semibold">取消</Text>
          </Button>
        ) : (
          <Button action={() => dismiss()} buttonStyle="plain">
            <Image systemName="xmark" foregroundStyle="red" fontWeight="semibold" />
          </Button>
        )}
      </ToolbarItem>
      {selectionMode ? (
        <ToolbarItem placement="topBarTrailing">
          <Button action={toggleSelectAll}>
            <Text foregroundStyle="accentColor" fontWeight="semibold">
              {selectedIds.size === filteredRecords.length && filteredRecords.length > 0 ? "取消全选" : "全选"}
            </Text>
          </Button>
        </ToolbarItem>
      ) : undefined}
      {!selectionMode ? (
        <ToolbarItem placement="topBarTrailing">
          <Button action={enterSelectionMode} disabled={records.length === 0}>
            <Text foregroundStyle={records.length === 0 ? "gray" : "accentColor"} fontWeight="semibold">选择</Text>
          </Button>
        </ToolbarItem>
      ) : undefined}
      {!selectionMode ? <ToolbarSpacer placement="topBarTrailing" /> : undefined}
      {!selectionMode ? (
        <ToolbarItem placement="topBarTrailing">
          <Button
            action={() => setShowClearConfirm(true)}
            disabled={records.length === 0}
            popover={{
              isPresented: showClearConfirm,
              onChanged: setShowClearConfirm,
              arrowEdge: "top",
              presentationCompactAdaptation: "popover",
              content: clearConfirmPopover
            }}
          >
            <Image
              systemName="trash"
              foregroundStyle={records.length === 0 ? "gray" : "red"}
              fontWeight="semibold"
            />
          </Button>
        </ToolbarItem>
      ) : undefined}
      {selectionMode ? (
        <ToolbarItem placement="bottomBar">
          <HStack spacing={16} alignment="center" padding={{ horizontal: 10 }}>
            <Button action={handleMultiCopy} disabled={selectedIds.size === 0}>
              <HStack spacing={4} alignment="center">
                <Image systemName="doc.on.doc" font="footnote" fontWeight="semibold" foregroundStyle={selectedIds.size === 0 ? "gray" : "accentColor"} />
                <Text font="footnote" fontWeight="semibold" foregroundStyle={selectedIds.size === 0 ? "gray" : "accentColor"}>
                  复制{selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Text>
              </HStack>
            </Button>
            <Button action={handleMultiDelete} disabled={selectedIds.size === 0}>
              <HStack spacing={4} alignment="center">
                <Image systemName="trash" font="footnote" fontWeight="semibold" foregroundStyle={selectedIds.size === 0 ? "gray" : "red"} />
                <Text font="footnote" fontWeight="semibold" foregroundStyle={selectedIds.size === 0 ? "gray" : "red"}>
                  删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Text>
              </HStack>
            </Button>
          </HStack>
        </ToolbarItem>
      ) : undefined}
    </Toolbar>
  );

  const historyToast = {
    isPresented: showToast,
    onChanged: setShowToast,
    message: toastMessage,
    position: "top" as const,
    duration: 2,
  };

  const emptyState = (
    <VStack spacing={12} alignment="center">
      <Image systemName="tray" font={48} foregroundStyle="gray" />
      <Text foregroundStyle="gray" fontWeight="medium">暂无历史记录</Text>
      <Text foregroundStyle="gray" font={12}>快去扫描或生成二维码吧！</Text>
    </VStack>
  );

  if (records.length === 0) {
    return (
      <VStack
        navigationTitle="历史"
        navigationBarTitleDisplayMode="inline"
        toolbar={historyToolbar}
        toast={historyToast}
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
        background="systemGroupedBackground"
        ignoresSafeArea
      >
        <Spacer />
        {emptyState}
        <Spacer />
      </VStack>
    );
  }

  return (
    <List
      navigationTitle="历史"
      navigationBarTitleDisplayMode="inline"
      toolbar={historyToolbar}
      toast={historyToast}
    >
      <Section 
        header={
          <HStack frame={{ maxWidth: Infinity }}>
            <Text>
              {historyFilter === "all" ? "全部记录" : historyFilter === "scan" ? "扫码记录" : "生成记录"}
            </Text>
            <Spacer />
            <Text font={12} foregroundStyle="gray">
              {selectionMode ? "点击选择" : "点击卡片复制"}
            </Text>
          </HStack>
        }
      >
        <Picker
            title="筛选"
            value={historyFilter}
            onChanged={(v: string) => setHistoryFilter(v)}
            pickerStyle="palette"
          >
            <Text tag="all">全部 ({records.length})</Text>
            <Text tag="scan">扫码 ({scanCount})</Text>
            <Text tag="generate">生成 ({generateCount})</Text>
          </Picker>
        {filteredRecords.map((r) => (
          <HistoryRow 
            key={r.id} 
            record={r} 
            onDelete={onDelete} 
            notify={notify}
            isSelectionMode={selectionMode}
            isSelected={selectedIds.has(r.id)}
            onToggleSelect={() => toggleSelect(r.id)}
          />
        ))}
      </Section>
    </List>
  );
}
