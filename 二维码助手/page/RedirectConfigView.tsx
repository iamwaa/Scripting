import { useState, useMemo, List, Section, VStack, HStack, ZStack, Text, Button, Toggle, Image, RoundedRectangle, Spacer, Menu, fetch } from "scripting";
import { RedirectRule } from "../types/types";
import { GlassCard } from "../components/GlassCard";
import { InputField } from "../components/InputField";
import { DEFAULT_REDIRECT_RULES } from "../types/constants";
import { compareMixed } from "../utils/pinyin";
import { mergeRemoteRules, formatRuleJSON } from "../utils/redirectRules";
import { KeywordManagerView } from "./KeywordManagerView";
import { AddRedirectRuleView } from "./AddRedirectRuleView";

export function RedirectConfigView({
  rules,
  onRulesChange,
  onBack,
  fallbackEnabled,
  onFallbackEnabledChange,
  fallbackUrlScheme,
  onFallbackUrlSchemeChange,
  subscriptionUrl,
  onSubscriptionUrlChange
}: {
  rules: RedirectRule[];
  onRulesChange: (rules: RedirectRule[]) => void;
  onBack: () => void;
  fallbackEnabled: boolean;
  onFallbackEnabledChange: (value: boolean) => void;
  fallbackUrlScheme: string;
  onFallbackUrlSchemeChange: (value: string) => void;
  subscriptionUrl: string;
  onSubscriptionUrlChange: (value: string) => void;
}) {
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [showAddRulePage, setShowAddRulePage] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [managingKeywordsForIndex, setManagingKeywordsForIndex] = useState<number | null>(null);

  // 按首字母中英混合排序规则列表，同时保留原始索引用于编辑/删除
  const sortedRulesWithIndices = useMemo(() => {
    return rules
      .map((rule, originalIndex) => ({ rule, originalIndex }))
      .sort((a, b) => compareMixed(a.rule.appName, b.rule.appName)); 
  }, [rules]);

  const notify = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };

  const handleAddRule = (rule: RedirectRule) => {
    onRulesChange([...rules, rule]);
    notify("已添加规则");
  };

  const handleDelete = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    onRulesChange(newRules);
    notify("已删除规则");
  };

  const handleUpdate = (index: number, rule: RedirectRule) => {
    const newRules = [...rules];
    newRules[index] = { ...rule, source: rules[index].source };
    onRulesChange(newRules);
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setShowAddRulePage(true);
  };

  const handleCopyRule = async (rule: RedirectRule) => {
    const ruleJson = formatRuleJSON(rule);
    await Pasteboard.setString(ruleJson);
    notify("已复制规则 JSON 到剪贴板");
  };

  const handleConfirmDelete = async (rule: RedirectRule, index: number) => {
    const ok = await Dialog.confirm({
      title: "删除规则",
      message: `确定要删除 "${rule.appName}" 规则吗？`
    });
    if (ok) {
      handleDelete(index);
    }
  };

  const handleReset = () => {
    onRulesChange([...DEFAULT_REDIRECT_RULES]);
    notify("已恢复默认规则");
  };

  const handleSync = async () => {
    const url = subscriptionUrl.trim();
    if (!url) {
      notify("请先填写订阅地址");
      return;
    }
    setIsSyncing(true);
    try {
      const resp = await fetch(url);
      const json = await resp.json();
      if (!Array.isArray(json)) {
        notify("订阅数据格式错误，需要 JSON 数组");
        return;
      }
      const remoteRules: RedirectRule[] = json.map((item: any) => ({
        keyword: item.keyword ?? "",
        urlScheme: item.urlScheme ?? "",
        appName: item.appName ?? "",
        iconUrl: item.iconUrl ?? undefined,
        source: "remote" as const
      })).filter((r: RedirectRule) => r.keyword && r.urlScheme && r.appName);
      const merged = mergeRemoteRules(rules, remoteRules);
      onRulesChange(merged);
      notify(`已同步 ${remoteRules.length} 条远程规则`);
    } catch (e) {
      console.error("订阅同步失败:", e);
      notify("同步失败，请检查地址和网络");
    } finally {
      setIsSyncing(false);
    }
  };

  if (managingKeywordsForIndex !== null) {
    return (
      <KeywordManagerView
        keywordString={rules[managingKeywordsForIndex].keyword}
        onKeywordsChange={(newKeywords: string) => {
          const newRules = [...rules];
          newRules[managingKeywordsForIndex] = { ...newRules[managingKeywordsForIndex], keyword: newKeywords };
          onRulesChange(newRules);
        }}
        onBack={() => setManagingKeywordsForIndex(null)}
      />
    );
  }

  if (showAddRulePage) {
    return (
      <AddRedirectRuleView
        onBack={() => { setShowAddRulePage(false); setEditingIndex(null); }}
        onAdd={handleAddRule}
        editRule={editingIndex !== null ? rules[editingIndex] : undefined}
        editIndex={editingIndex ?? undefined}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <List
      navigationTitle="跳转规则配置"
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
          <Button action={() => setShowAddRulePage(true)}>
            <HStack spacing={4}>
              <Image systemName="link.badge.plus" foregroundStyle="accentColor" fontWeight="semibold" />
            </HStack>
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
      <Section header={<Text>配置</Text>}>
          <GlassCard>
          <HStack spacing={6} alignment="center">
            <Text fontWeight="semibold">远程订阅</Text>
            <Spacer />
            <Button action={async () => {
              const template = JSON.stringify([
                { appName: "微信", iconUrl: "https://example.com", keyword: "wechat,weixin", urlScheme: "weixin://scanqrcode" }
              ], null, 2);
              await Pasteboard.setString(template);
              notify("已复制模板到剪贴板");
            }} buttonStyle="plain">
              <HStack spacing={4} alignment="center">
                <Image systemName="doc.on.doc" font={12} foregroundStyle="accentColor" />
                <Text font={12} foregroundStyle="accentColor">复制模板</Text>
              </HStack>
            </Button>
          </HStack>
          <InputField
            title="订阅地址 (JSON URL)"
            value={subscriptionUrl}
            onChanged={onSubscriptionUrlChange}
            icon="globe"
            singleLine={true}
          />
          <Button
            action={handleSync}
            disabled={isSyncing || !subscriptionUrl.trim()}
            buttonStyle="borderedProminent"
          >
            <HStack spacing={6} frame={{ maxWidth: Infinity, alignment: "center" }} padding={6}>
              <Image systemName="arrow.clockwise" />
              <Text fontWeight="bold">{isSyncing ? "同步中..." : "同步订阅"}</Text>
            </HStack>
          </Button>
        </GlassCard>
        <GlassCard padding={2}>
          <Toggle
            padding={4}
            title="兜底跳转"
            value={fallbackEnabled}
            onChanged={onFallbackEnabledChange}
            systemImage="arrow.triangle.branch"
          />
          {fallbackEnabled && (
            <InputField
              title="URL Scheme"
              value={fallbackUrlScheme}
              onChanged={onFallbackUrlSchemeChange}
              icon="link"
              footer="当扫码内容未匹配任何规则时，将使用此链接兜底。"
            />
          )}
        </GlassCard>
      </Section>

      <Section
        header={
          <HStack frame={{ maxWidth: Infinity }}>
            <Text fontWeight="bold">当前规则 ({rules.length})</Text>
            <Spacer />
            <Button action={handleReset} buttonStyle="plain">
              <Text font={13} foregroundStyle="accentColor">恢复默认</Text>
            </Button>
          </HStack>
        }
      >
        {sortedRulesWithIndices.map(({ rule, originalIndex }) => (
          <Menu
            key={originalIndex}
            primaryAction={() => handleStartEdit(originalIndex)}
            label={
              <GlassCard padding={2}>
                <VStack spacing={8} alignment="leading" frame={{ maxWidth: Infinity, alignment: "leading" }}>
                  <HStack spacing={10} frame={{ maxWidth: Infinity, alignment: "center" }}>
                    <ZStack
                      frame={{ width: 38, height: 38 }}
                      background={rule.iconUrl ? undefined : <RoundedRectangle cornerRadius={9} fill="tertiarySystemFill" />}
                    >
                      {rule.iconUrl ? (
                        <Image
                          imageUrl={rule.iconUrl}
                          resizable={true}
                          frame={{ width: 38, height: 38 }}
                          clipShape={{ type: "rect", cornerRadius: 9 }}
                          placeholder={<Image systemName="app" font={15} foregroundStyle="gray" />}
                        />
                      ) : (
                        <Image systemName="link" font={15} foregroundStyle="accentColor" />
                      )}
                    </ZStack>
                    <VStack spacing={3} alignment="leading" frame={{ maxWidth: Infinity, alignment: "leading" }}>
                      <HStack spacing={6} alignment="center">
                        <Text fontWeight="bold">{rule.appName}</Text>
                        <Text font={10} foregroundStyle={rule.source === "remote" ? "systemOrange" : "systemGreen"}>
                          {rule.source === "remote" ? "订阅" : "本地"}
                        </Text>
                      </HStack>
                      <Text
                        font={11}
                        foregroundStyle="gray"
                        lineLimit={1}
                        truncationMode="tail"
                        frame={{ maxWidth: Infinity, alignment: "leading" }}
                      >关键词：{rule.keyword}</Text>
                    </VStack>
                    <Image systemName="chevron.right" font={14} foregroundStyle="systemGray2" />
                  </HStack>

                  <VStack
                    spacing={4}
                    padding={8}
                    alignment="leading"
                    frame={{ maxWidth: Infinity, alignment: "leading" }}
                    background={<RoundedRectangle cornerRadius={9} fill="tertiarySystemFill" />}
                  >
                    <Text font={10} foregroundStyle="gray">URL Scheme</Text>
                    <Text
                      font={12}
                      foregroundStyle="label"
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: Infinity, alignment: "leading" }}
                    >{rule.urlScheme}</Text>
                  </VStack>
                </VStack>
              </GlassCard>
            }
          >
            <Button title="管理关键词" systemImage="tag" action={() => setManagingKeywordsForIndex(originalIndex)} />
            <Button title="复制为JSON" systemImage="doc.on.doc" action={() => handleCopyRule(rule)} />
            <Button title="删除规则" systemImage="trash" role="destructive" action={() => handleConfirmDelete(rule, originalIndex)} />
          </Menu>
        ))}
      </Section>
    </List>
  );
}
