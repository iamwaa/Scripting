// ============================================================================
// Settings page — manage 哪吒 (Nezha) endpoints (add / edit / delete / switch).
// S: Single Purpose — config CRUD UI; persistence delegated to class/config.
// E: Environment-Agnostic — endpoints are user data, nothing is hardcoded.
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  SecureField,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useObservable,
  useState,
} from "scripting";
import {
  loadConfig,
  upsertInstance,
  removeInstance,
  setActiveInstance,
  normalizeBaseUrl,
} from "../class/config";
import { getBackend, ALL_BACKENDS } from "../class/server";
import { useMonitor } from "../context/Monitor";
import { View as NodeManagerView } from "./addnode";
import { View as AdminHubView } from "./admin";
import type { Instance, AuthMode, AuthConfig, BackendKind } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const version = useObservable<number>(0);

  const cfg = loadConfig();

  async function afterChange() {
    version.setValue(version.value + 1);
    await monitor.reload();
  }

  // Present the editor imperatively on its own presentation layer. Nesting it
  // as a declarative `sheet` inside this already-modal page made the form
  // freeze once the keyboard appeared (fixed-height detent vs. keyboard inset).
  async function openEditor(inst: Instance | null) {
    await Navigation.present({
      element: <EditorView instance={inst} onSaved={afterChange} />,
    });
  }

  // Open the admin node manager for an authenticated instance. Activates the
  // instance first so the manager (and the rest of the app) reads its data.
  async function openNodeManager(inst: Instance) {
    setActiveInstance(inst.id);
    await monitor.reload();
    await Navigation.present({ element: <NodeManagerView /> });
    await afterChange();
  }

  async function openAdmin(inst: Instance) {
    await Navigation.present({ element: <AdminHubView /> });
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"探针设置"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [
            <Button title={"完成"} action={dismiss} />,
          ],
          topBarTrailing: [
            <Button
              title={"添加"}
              systemImage={"plus"}
              action={() => openEditor(null)}
            />,
          ],
        }}
      >
        <Section
          header={<Text>探针面板</Text>}
          footer={
            <Text>
              支持 Komari 与哪吒（Nezha）两种探针。填写面板地址（如 https://status.example.com）并选择类型；
              公开 / 游客面板可直接读取，私有面板在编辑页设置 Token 或账号密码登录。
            </Text>
          }
        >
          {cfg.instances.length === 0 ? (
            <Text foregroundStyle={"secondaryLabel"}>暂无探针，点击右上角 + 添加</Text>
          ) : (
            cfg.instances.map((inst) => (
              <HStack
                key={inst.id}
                trailingSwipeActions={{
                  allowsFullSwipe: true,
                  actions: [
                    <Button
                      title={"删除"}
                      role={"destructive"}
                      action={async () => {
                        removeInstance(inst.id);
                        await afterChange();
                      }}
                    />,
                    <Button
                      title={"编辑"}
                      action={() => openEditor(inst)}
                    />,
                  ],
                }}
                leadingSwipeActions={
                  inst.auth && inst.auth.mode !== "none"
                    ? {
                        allowsFullSwipe: false,
                        actions: [
                          <Button
                            title={"管理面板"}
                            systemImage={"gearshape.2"}
                            action={() => openAdmin(inst)}
                          />,
                          <Button
                            title={"管理节点"}
                            systemImage={"server.rack"}
                            action={() => openNodeManager(inst)}
                          />,
                        ],
                      }
                    : undefined
                }
              >
                <Button
                  action={async () => {
                    setActiveInstance(inst.id);
                    await afterChange();
                  }}
                >
                  <HStack>
                    <Image
                      systemName={
                        inst.id === cfg.activeId
                          ? "checkmark.circle.fill"
                          : "circle"
                      }
                      foregroundStyle={
                        inst.id === cfg.activeId ? "systemGreen" : "systemGray"
                      }
                    />
                    <VStack alignment={"leading"} spacing={1}>
                      <HStack spacing={4}>
                        <Text font={"headline"} lineLimit={1}>
                          {inst.name}
                        </Text>
                        {inst.auth && inst.auth.mode !== "none" ? (
                          <Image
                            systemName={inst.auth.mode === "token" ? "key.fill" : "lock.fill"}
                            font={"caption2"}
                            foregroundStyle={"systemBlue"}
                          />
                        ) : null}
                      </HStack>
                      <Text
                        font={"caption"}
                        foregroundStyle={"secondaryLabel"}
                        lineLimit={1}
                      >
                        {getBackend(inst.kind).caps.label} · {inst.baseUrl}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Image systemName={"chevron.right"} foregroundStyle={"tertiaryLabel"} />
                  </HStack>
                </Button>
              </HStack>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}

function EditorView({
  instance,
  onSaved,
}: {
  instance: Instance | null;
  onSaved: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const [name, setName] = useState<string>(instance?.name ?? "");
  const [kind, setKind] = useState<BackendKind>(instance?.kind ?? "komari");
  const [url, setUrl] = useState<string>(instance?.baseUrl ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(instance?.auth?.mode ?? "none");
  const [apiKey, setApiKey] = useState<string>(instance?.auth?.apiKey ?? "");
  const [username, setUsername] = useState<string>(instance?.auth?.username ?? "");
  const [password, setPassword] = useState<string>(instance?.auth?.password ?? "");
  const [twoFactor, setTwoFactor] = useState<string>(instance?.auth?.twoFactor ?? "");
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string>("");

  // Assemble an AuthConfig from the current form state (may be undefined).
  function currentAuth(sessionToken?: string): AuthConfig | undefined {
    if (authMode === "token") {
      return { mode: "token", apiKey: apiKey.trim() };
    }
    if (authMode === "password") {
      const a: AuthConfig = { mode: "password", username: username.trim(), password };
      if (twoFactor.trim()) a.twoFactor = twoFactor.trim();
      const token = sessionToken ?? instance?.auth?.sessionToken;
      if (token) a.sessionToken = token;
      return a;
    }
    return { mode: "none" };
  }

  async function save() {
    const baseUrl = normalizeBaseUrl(url);
    if (!baseUrl) {
      setTestResult("请填写有效的地址");
      return;
    }
    // Password mode: log in first so we persist a fresh session token.
    let sessionToken: string | undefined;
    if (authMode === "password") {
      if (!username.trim() || !password) {
        setTestResult("请填写用户名和密码");
        return;
      }
      setTesting(true);
      setTestResult("正在登录…");
      const r = await getBackend(kind).login(baseUrl, username.trim(), password, twoFactor.trim() || undefined);
      setTesting(false);
      if (!r.ok) {
        setTestResult(r.needs2FA ? "需要两步验证码（请填写 2FA）" : `登录失败：${r.error}`);
        return;
      }
      sessionToken = r.sessionToken;
    } else if (authMode === "token" && !apiKey.trim()) {
      setTestResult(`请填写 ${getBackend(kind).caps.tokenLabel}`);
      return;
    }
    upsertInstance({ id: instance?.id, name, kind, baseUrl, auth: currentAuth(sessionToken) });
    dismiss();
    await onSaved();
  }

  async function test() {
    const baseUrl = normalizeBaseUrl(url);
    if (!baseUrl) {
      setTestResult("请填写有效的地址");
      return;
    }
    const backend = getBackend(kind);
    setTesting(true);
    setTestResult("测试中…");

    if (authMode === "none") {
      const v = await backend.fetchVersion(baseUrl);
      setTesting(false);
      setTestResult(v ? `连接成功 · ${v}` : "已连接，但无法读取信息（仍可保存）");
      return;
    }

    if (authMode === "token") {
      if (!apiKey.trim()) {
        setTesting(false);
        setTestResult(`请填写 ${backend.caps.tokenLabel}`);
        return;
      }
      const r = await backend.verifyAuth(baseUrl, { mode: "token", apiKey: apiKey.trim() });
      setTesting(false);
      setTestResult(r.ok ? `认证成功${r.username ? ` · ${r.username}` : ""}` : `认证失败：${r.error}`);
      return;
    }

    // password mode
    if (!username.trim() || !password) {
      setTesting(false);
      setTestResult("请填写用户名和密码");
      return;
    }
    const r = await backend.login(baseUrl, username.trim(), password, twoFactor.trim() || undefined);
    setTesting(false);
    if (!r.ok) {
      setTestResult(r.needs2FA ? "需要两步验证码（请填写 2FA）" : `登录失败：${r.error}`);
      return;
    }
    setTestResult("登录成功 · 凭证有效");
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={instance ? "编辑探针" : "添加探针"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [<Button title={"取消"} action={dismiss} />],
          confirmationAction: [<Button title={"保存"} action={save} />],
        }}
      >
        <Section header={<Text>名称（可选）</Text>}>
          <TextField
            title={"名称"}
            prompt={"例如：我的服务器"}
            value={name}
            onChanged={setName}
          />
        </Section>

        <Section
          header={<Text>探针类型</Text>}
          footer={<Text>选择面板对应的探针软件，连接方式与可用功能会随之调整。</Text>}
        >
          <Picker
            title={"类型"}
            value={kind}
            onChanged={(v: string) => {
              setKind(v as BackendKind);
              setTestResult("");
            }}
          >
            {ALL_BACKENDS.map((b) => (
              <Text key={b.caps.kind} tag={b.caps.kind}>
                {b.caps.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<Text>面板地址</Text>}
          footer={<Text>{testResult}</Text>}
        >
          <TextField
            title={"地址"}
            prompt={"https://status.example.com"}
            value={url}
            onChanged={setUrl}
          />
          <Button action={test} disabled={testing}>
            <HStack>
              <Image systemName={"bolt.horizontal.circle"} />
              <Text>测试连接</Text>
            </HStack>
          </Button>
        </Section>

        <Section
          header={<Text>登录方式（可选）</Text>}
          footer={
            <Text>
              {kind === "nezha"
                ? "开启游客访问的面板无需登录。私有面板可用 Access Token（系统设置 → API Token）或账号密码访问；账号密码会换取 JWT 会话凭证。凭证以明文保存在本机。"
                : "公开面板无需登录。私有面板可用 API Key 或账号密码访问；账号密码会换取会话凭证。凭证以明文保存在本机。"}
            </Text>
          }
        >
          <Picker
            title={"认证方式"}
            value={authMode}
            onChanged={(v: string) => {
              setAuthMode(v as AuthMode);
              setTestResult("");
            }}
          >
            <Text tag={"none"}>{kind === "nezha" ? "无（游客）" : "无（公开）"}</Text>
            <Text tag={"token"}>{getBackend(kind).caps.tokenLabel}</Text>
            <Text tag={"password"}>用户名密码</Text>
          </Picker>

          {authMode === "token" ? (
            <SecureField
              title={getBackend(kind).caps.tokenLabel}
              prompt={`粘贴 ${getBackend(kind).caps.tokenLabel}`}
              value={apiKey}
              onChanged={setApiKey}
            />
          ) : null}

          {authMode === "password" ? (
            <>
              <TextField
                title={"用户名"}
                prompt={"账号"}
                value={username}
                onChanged={setUsername}
              />
              <SecureField
                title={"密码"}
                prompt={"密码"}
                value={password}
                onChanged={setPassword}
              />
              <TextField
                title={"2FA（可选）"}
                prompt={"两步验证码"}
                value={twoFactor}
                onChanged={setTwoFactor}
              />
            </>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  );
}
