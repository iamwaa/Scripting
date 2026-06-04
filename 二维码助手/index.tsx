import { useState, TabView, Tab, NavigationStack, Navigation, Script } from "scripting";
import { QrRecord, AppSettings, RedirectRule } from "./types/types";
import { loadRecords, persistRecords, loadSettings, persistSettings } from "./types/storage";
import { ScanView } from "./page/ScanView";
import { GenerateView } from "./page/GenerateView";
import { HistoryView } from "./page/HistoryView";

function MainApp() {
  const [records, setRecords] = useState<QrRecord[]>(() => loadRecords());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isLoaded] = useState(true);

  const [isScanConfigOpen, setIsScanConfigOpen] = useState(false);
  const [historySelectionMode, setHistorySelectionMode] = useState(false);

  const saveRecords = async (list: QrRecord[]) => {
    setRecords(list);
    persistRecords(list);
  };

  const handleAdd = (r: QrRecord) => saveRecords([r, ...records]);
  const handleDelete = (id: string) => saveRecords(records.filter((r) => r.id !== id));
  const handleDeleteMultiple = (ids: string[]) => saveRecords(records.filter((r) => !ids.includes(r.id)));

  const handleClear = async () => {
    await saveRecords([]);
  };

  const handleAutoScanChange = (value: boolean) => {
    const next = { ...settings, autoScanOnOpen: value };
    setSettings(next);
    persistSettings(next);
  };

  const handleAutoRedirectChange = (value: boolean) => {
    const next = { ...settings, autoRedirect: value };
    setSettings(next);
    persistSettings(next);
  };

  const handleRedirectRulesChange = (rules: RedirectRule[]) => {
    const next = { ...settings, redirectRules: rules };
    setSettings(next);
    persistSettings(next);
  };

  const handleFallbackEnabledChange = (value: boolean) => {
    const next = { ...settings, fallbackEnabled: value };
    setSettings(next);
    persistSettings(next);
  };

  const handleFallbackUrlSchemeChange = (value: string) => {
    const next = { ...settings, fallbackUrlScheme: value };
    setSettings(next);
    persistSettings(next);
  };

  const handleSubscriptionUrlChange = (value: string) => {
    const next = { ...settings, subscriptionUrl: value };
    setSettings(next);
    persistSettings(next);
  };

  if (!isLoaded) return null;

  return (
    <TabView>
      <Tab
        title="扫码"
        systemImage="qrcode.viewfinder"
        value={0}
        tabBarVisibility={isScanConfigOpen ? "hidden" : "visible"}
      >
        <NavigationStack tabBarVisibility={isScanConfigOpen ? "hidden" : "visible"}>
          <ScanView
            onAddRecord={handleAdd}
            autoScanOnOpen={settings.autoScanOnOpen}
            onAutoScanChange={handleAutoScanChange}
            autoRedirect={settings.autoRedirect}
            redirectRules={settings.redirectRules}
            onAutoRedirectChange={handleAutoRedirectChange}
            onRedirectRulesChange={handleRedirectRulesChange}
            fallbackEnabled={settings.fallbackEnabled}
            onFallbackEnabledChange={handleFallbackEnabledChange}
            fallbackUrlScheme={settings.fallbackUrlScheme}
            onFallbackUrlSchemeChange={handleFallbackUrlSchemeChange}
            subscriptionUrl={settings.subscriptionUrl}
            onSubscriptionUrlChange={handleSubscriptionUrlChange}
            isConfigOpen={isScanConfigOpen}
            onConfigToggle={setIsScanConfigOpen}
          />
        </NavigationStack>
      </Tab>

      <Tab title="生成" systemImage="plus.app" value={1}>
        <NavigationStack>
          <GenerateView onAddRecord={handleAdd} />
        </NavigationStack>
      </Tab>

      <Tab
        title="历史"
        systemImage="clock.fill"
        value={2}
        tabBarVisibility={historySelectionMode ? "hidden" : "visible"}
      >
        <NavigationStack tabBarVisibility={historySelectionMode ? "hidden" : "visible"}>
          <HistoryView
            records={records}
            onClear={handleClear}
            onDelete={handleDelete}
            onDeleteMultiple={handleDeleteMultiple}
            selectionMode={historySelectionMode}
            onEnterSelectionMode={() => setHistorySelectionMode(true)}
            onExitSelectionMode={() => setHistorySelectionMode(false)}
          />
        </NavigationStack>
      </Tab>
    </TabView>
  );
}

const run = async () => {
  await Navigation.present({
    element: <MainApp />,
    modalPresentationStyle: "fullScreen"
  });
  Script.exit();
};

run();
