import { useState, List, Section, Text, Button, HStack, Image, TextField, Spacer } from "scripting";
import { RedirectRule } from "../types/types";
import { FormRow } from "./FormRow";
import { KeywordManagerView } from "./KeywordManagerView";

export function AddRedirectRuleView({
  onBack,
  onAdd,
  editRule,
  editIndex,
  onUpdate,
  onDelete
}: {
  onBack: () => void;
  onAdd?: (rule: RedirectRule) => void;
  editRule?: RedirectRule;
  editIndex?: number;
  onUpdate?: (index: number, rule: RedirectRule) => void;
  onDelete?: (index: number) => void;
}) {
  const isEdit = !!editRule;
  const [newKeyword, setNewKeyword] = useState(editRule?.keyword ?? "");
  const [newUrlScheme, setNewUrlScheme] = useState(editRule?.urlScheme ?? "");
  const [newAppName, setNewAppName] = useState(editRule?.appName ?? "");
  const [newIconUrl, setNewIconUrl] = useState(editRule?.iconUrl ?? "");
  const [showKeywordManager, setShowKeywordManager] = useState(false);
  const [recognizeText, setRecognizeText] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);

  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  const handleRecognize = () => {
    const text = recognizeText.trim();
    if (!text) { notify("请先粘贴内容"); return; }

    // 尝试 JSON 解析
    try {
      const obj = JSON.parse(text);
      const item = Array.isArray(obj) ? obj[0] : obj;
      if (item && typeof item === "object") {
        if (item.appName) setNewAppName(String(item.appName));
        if (item.keyword) setNewKeyword(String(item.keyword));
        if (item.urlScheme) setNewUrlScheme(String(item.urlScheme));
        if (item.iconUrl) setNewIconUrl(String(item.iconUrl));
        notify("已识别 JSON 内容");
        return;
      }
    } catch {}

    // 尝试提取 URL Scheme
    const schemeMatch = text.match(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"]+)/);
    if (schemeMatch) {
      setNewUrlScheme(schemeMatch[1].replace(/["',;]+$/, ""));
      const prefix = schemeMatch[1].split("://")[0];
      if (!newAppName) setNewAppName(prefix);
      notify("已识别 URL Scheme");
      return;
    }

    // 尝试提取 http/https 链接
    const urlMatch = text.match(/(https?:\/\/[^\s"]+)/);
    if (urlMatch) {
      setNewUrlScheme(urlMatch[1].replace(/["',;]+$/, ""));
      notify("已识别链接");
      return;
    }

    notify("未能识别，请手动填写");
  };

  const handleSave = () => {
    const keyword = newKeyword.trim();
    const urlScheme = newUrlScheme.trim();
    const appName = newAppName.trim();
    if (!keyword || !urlScheme || !appName) { notify("请填写完整信息"); return; }
    const rule: RedirectRule = { keyword, urlScheme, appName, ...(newIconUrl.trim() ? { iconUrl: newIconUrl.trim() } : {}) };
    if (isEdit && editIndex !== undefined && onUpdate) {
      onUpdate(editIndex, rule);
      notify("已更新规则");
    } else if (onAdd) {
      onAdd(rule);
      notify("已添加规则");
    }
    onBack();
  };

  if (showKeywordManager) {
    return (
      <KeywordManagerView
        keywordString={newKeyword}
        onKeywordsChange={setNewKeyword}
        onBack={() => setShowKeywordManager(false)}
      />
    );
  }

  return (
    <List
      navigationTitle={isEdit ? "编辑规则" : "添加规则"}
      navigationBarTitleDisplayMode="inline"
      navigationBarBackButtonHidden={true}
      toolbar={{
        topBarLeading: (
          <Button action={onBack}>
            <HStack spacing={4}>
              <Image systemName="chevron.left" foregroundStyle="accentColor" fontWeight="semibold" />
            </HStack>
          </Button>
        ),
        topBarTrailing: (
          <Button
            action={handleSave}
            disabled={!newKeyword.trim() || !newUrlScheme.trim() || !newAppName.trim()}
          >
            <Text
              fontWeight="semibold"
              foregroundStyle={(!newKeyword.trim() || !newUrlScheme.trim() || !newAppName.trim()) ? "systemGray2" : "accentColor"}
            >
              {isEdit ? "保存" : "添加"}
            </Text>
          </Button>
        )
      }}
      toast={{
        isPresented: showToast,
        onChanged: setShowToast,
        message: toastMessage,
        position: "top",
        duration: 2,
      }}
    >
      {!isEdit && (
        <Section
          header={<Text>智能识别</Text>}
          footer={<Text>粘贴规则 JSON 或包含 URL Scheme 的文本，自动填充下方字段</Text>}
        >
          <TextField
            title="粘贴文本"
            value={recognizeText}
            onChanged={setRecognizeText}
            prompt="请输入内容"
            padding={4}
          />
          <Button
            action={handleRecognize}
            disabled={!recognizeText.trim()}
            frame={{ maxWidth: Infinity }}
          >
            <HStack spacing={6} frame={{ maxWidth: Infinity, alignment: "center" }}>
              <Image systemName="sparkles" foregroundStyle={recognizeText.trim() ? "accentColor" : "systemGray2"} />
              <Text foregroundStyle={recognizeText.trim() ? "accentColor" : "systemGray2"} fontWeight="semibold">识别填充</Text>
            </HStack>
          </Button>
        </Section>
      )}

      <Section header={<Text>规则信息</Text>} footer={<Text>{"{content}：作为占位符传递扫码内容\n 例如: taobao://search?q={content}\n{url}：扫码结果是完整链接时填入参数可直接打开"}</Text>}>
        <FormRow label="应用名称" value={newAppName} onChanged={setNewAppName} prompt="例如：微信" />
        <Button action={() => setShowKeywordManager(true)} buttonStyle="plain">
          <HStack alignment="center" spacing={8} frame={{ maxWidth: Infinity }} padding={{ vertical: 4 }}>
            <Text foregroundStyle="#333333">关键词</Text>
            <Spacer />
            <Text font={14} foregroundStyle="gray">
              {newKeyword ? `${newKeyword.split(/[,，]/).filter((k: string) => k.trim()).length} 个` : "未设置"}
            </Text>
            <Image systemName="chevron.right" font={14} foregroundStyle="systemGray2" />
          </HStack>
        </Button>
        <FormRow label="URL Scheme" value={newUrlScheme} onChanged={setNewUrlScheme} prompt="weixin://scanqrcode" />
        <FormRow label="图标 URL" value={newIconUrl} onChanged={setNewIconUrl} prompt="选填" />
      </Section>

      {isEdit && onDelete && editIndex !== undefined && (
        <Section>
          <Button
            action={async () => {
              const ok = await Dialog.confirm({ title: "删除规则", message: "确定要删除这条规则吗？" });
              if (ok) { onDelete(editIndex); notify("已删除规则"); onBack(); }
            }}
            frame={{ maxWidth: Infinity }}
          >
            <HStack spacing={6} frame={{ maxWidth: Infinity, alignment: "center" }} padding={4}>
              <Image systemName="trash" foregroundStyle="red" />
              <Text foregroundStyle="red" fontWeight="bold">删除此规则</Text>
            </HStack>
          </Button>
        </Section>
      )}
    </List>
  );
}
