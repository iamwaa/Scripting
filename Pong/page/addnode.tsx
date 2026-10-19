// ============================================================================
// Node management page — view installed nodes, delete them, and show the agent
// install guide. Backend-aware:
//   - Komari (caps.canCreateNode): create a node via the admin API, which
//     returns an agent token; the install commands embed that token.
//   - 哪吒 Nezha: agents self-register against a GLOBAL Client Secret (系统设置
//     → Agent), so there is no per-node create/token API — the user pastes the
//     Client Secret and we build the one-line installer.
// S: Single Purpose — node management UI for one instance; I/O via backend.
// P: consumes useMonitor() + the Backend port; never touches fetch directly.
// E: endpoint + credentials come from the active instance, nothing hardcoded.
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Pasteboard,
  ScrollView,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useObservable,
  useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import { getBackend, editNode } from "../class/server";
import type { Instance, NodeBasicInfo, NodeEditPatch } from "../class/types";

export function View() {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const inst = monitor.instance.value;
  const version = useObservable<number>(0);
  const caps = inst ? getBackend(inst.kind).caps : null;

  // Reload node list after a delete and bump local re-render.
  async function refresh() {
    await monitor.reload();
    version.setValue(version.value + 1);
  }

  async function openInstall() {
    if (!inst) return;
    await Navigation.present({
      element: <InstallView instance={inst} onChanged={refresh} />,
    });
  }

  const nodes = monitor.nodes.value;
  const canManage = !!caps && (caps.canCreateNode || caps.canDeleteNode);

  return (
    <NavigationStack>
      <List
        navigationTitle={"管理节点"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          cancellationAction: [<Button title={"完成"} action={dismiss} />],
          topBarTrailing: caps
            ? [
                <Button
                  title={caps.canCreateNode ? "添加" : "安装"}
                  systemImage={"plus"}
                  action={openInstall}
                />,
              ]
            : [],
        }}
      >
        <Section
          header={<Text>已接入节点（{nodes.length}）</Text>}
          footer={
            <Text>
              {caps?.canCreateNode
                ? "点击右上角「添加」创建新节点并获取一键接入命令。删除不可恢复。"
                : "哪吒 Agent 使用面板「系统设置 → Agent」里的统一 Client Secret 自助注册，无需逐个创建。点击右上角「安装」查看一键接入命令。删除不可恢复。"}
            </Text>
          }
        >
          {nodes.length === 0 ? (
            <Text foregroundStyle={"secondaryLabel"}>
              {canManage ? "暂无节点，点击右上角查看接入命令" : "暂无节点"}
            </Text>
          ) : (
            nodes.map((node) => (
              <NodeManageRow
                key={node.uuid}
                node={node}
                instance={inst}
                canDelete={!!caps?.canDeleteNode}
                canEdit={!!caps?.canEditNode}
                onChanged={refresh}
              />
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}

function NodeManageRow({
  node,
  instance,
  canDelete,
  canEdit,
  onChanged,
}: {
  node: NodeBasicInfo;
  instance: Instance | null;
  canDelete: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  async function openEdit() {
    if (!instance) return;
    await Navigation.present({
      element: <EditNodeView instance={instance} node={node} onChanged={onChanged} />,
    });
  }

  async function confirmDelete() {
    if (!instance) return;
    await Navigation.present({
      element: (
        <DeleteConfirm
          name={node.name}
          onConfirm={async () => {
            setBusy(true);
            setMsg("");
            try {
              await getBackend(instance.kind).deleteNode(instance.baseUrl, node.uuid, instance.auth);
              await onChanged();
            } catch (e: any) {
              setMsg(e?.message || String(e));
              setBusy(false);
            }
          }}
        />
      ),
    });
  }

  const idLabel = node.id > 0 ? `ID ${node.id}` : node.uuid;

  return (
    <VStack
      alignment={"leading"}
      spacing={2}
      leadingSwipeActions={
        canEdit
          ? {
              allowsFullSwipe: false,
              actions: [<Button title={"编辑"} action={openEdit} />],
            }
          : undefined
      }
      trailingSwipeActions={
        canDelete
          ? {
              allowsFullSwipe: false,
              actions: [<Button title={"删除"} role={"destructive"} action={confirmDelete} />],
            }
          : undefined
      }
    >
      <HStack>
        <VStack alignment={"leading"} spacing={1}>
          <Text font={"headline"} lineLimit={1}>
            {node.name}
          </Text>
          <Text font={"caption"} foregroundStyle={"secondaryLabel"} lineLimit={1}>
            {idLabel}
            {node.region ? ` · ${node.region}` : ""}
          </Text>
        </VStack>
        <Spacer />
        {canEdit ? (
          <Button action={openEdit}>
            <Image systemName={"square.and.pencil"} foregroundStyle={"systemBlue"} />
          </Button>
        ) : null}
        {canDelete ? (
          busy ? (
            <Image systemName={"arrow.triangle.2.circlepath"} foregroundStyle={"systemGray"} />
          ) : (
            <Button role={"destructive"} action={confirmDelete}>
              <Image systemName={"trash"} foregroundStyle={"systemRed"} />
            </Button>
          )
        ) : null}
      </HStack>
      {msg ? (
        <Text font={"caption"} foregroundStyle={"systemRed"}>
          {msg}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * Install guide. For Komari it first creates a node (admin API) which returns
 * an agent token; for Nezha the user pastes the global Client Secret. Both then
 * render the backend's one-line install commands.
 */
function InstallView({
  instance,
  onChanged,
}: {
  instance: Instance;
  onChanged: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const backend = getBackend(instance.kind);
  const caps = backend.caps;

  // Komari: create-node flow yields a token. Nezha: paste a secret.
  const [name, setName] = useState<string>("");
  const [secret, setSecret] = useState<string>(""); // token (Komari) or Client Secret (Nezha)
  const [creating, setCreating] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  const commands = secret.trim() ? backend.buildInstallCommands(instance.baseUrl, secret.trim()) : [];

  async function createNode() {
    if (!backend.createNode) return;
    setCreating(true);
    setErr("");
    try {
      const created = await backend.createNode(instance.baseUrl, name.trim() || "新节点", instance.auth);
      setSecret(created.token);
      await onChanged();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={caps.canCreateNode ? "添加节点" : "接入命令"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{ cancellationAction: [<Button title={"完成"} action={dismiss} />] }}
      >
        {caps.canCreateNode ? (
          <Section
            header={<Text>新建节点</Text>}
            footer={
              <Text>
                创建后会返回该节点的 Agent Token，下方命令会自动填入。需要当前凭证具备管理员权限。
              </Text>
            }
          >
            <TextField title={"名称"} prompt={"节点名称（可选）"} value={name} onChanged={setName} />
            <Button action={createNode}>
              <HStack spacing={6}>
                <Image systemName={creating ? "arrow.triangle.2.circlepath" : "plus.circle.fill"} />
                <Text>{creating ? "创建中…" : "创建并获取 Token"}</Text>
              </HStack>
            </Button>
            {err ? (
              <Text font={"caption"} foregroundStyle={"systemRed"}>
                {err}
              </Text>
            ) : null}
          </Section>
        ) : (
          <Section
            header={<Text>Client Secret</Text>}
            footer={
              <Text>
                在面板「系统设置 → Agent」复制 Client Secret 粘贴到此处，下方命令会自动填入。
                NZ_SERVER 默认取面板域名（gRPC 端口请按面板设置调整）。
              </Text>
            }
          >
            <TextField title={"Secret"} prompt={"粘贴 Client Secret"} value={secret} onChanged={setSecret} />
          </Section>
        )}

        {commands.length === 0 ? (
          <Section>
            <Text foregroundStyle={"secondaryLabel"} font={"footnote"}>
              {caps.canCreateNode ? "创建节点后在此显示接入命令" : "填写 Secret 后在此显示接入命令"}
            </Text>
          </Section>
        ) : (
          commands.map((c) => (
            <Section key={c.label} header={<Text>{c.label}</Text>}>
              <VStack alignment={"leading"} spacing={8} padding={{ vertical: 4 }}>
                <Text font={"caption"} fontDesign={"monospaced"} foregroundStyle={"label"}>
                  {c.command}
                </Text>
                <Button
                  action={() => {
                    Pasteboard.setString(c.command);
                  }}
                >
                  <HStack spacing={4}>
                    <Image systemName={"doc.on.doc"} />
                    <Text>复制命令</Text>
                  </HStack>
                </Button>
              </VStack>
            </Section>
          ))
        )}
      </List>
    </NavigationStack>
  );
}

function DeleteConfirm({ name, onConfirm }: { name: string; onConfirm: () => Promise<void> | void }) {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <ScrollView navigationTitle={"删除节点"} navigationBarTitleDisplayMode={"inline"}>
        <VStack spacing={16} padding={20}>
          <Image systemName={"exclamationmark.triangle.fill"} font={44} foregroundStyle={"systemRed"} />
          <Text font={"headline"} multilineTextAlignment={"center"}>
            确定要删除「{name}」？
          </Text>
          <Text font={"footnote"} foregroundStyle={"secondaryLabel"} multilineTextAlignment={"center"}>
            将从面板移除该服务器及其历史数据，此操作不可恢复。
          </Text>
          <HStack spacing={12}>
            <Button action={() => dismiss()}>
              <Text padding={8}>取消</Text>
            </Button>
            <Button
              role={"destructive"}
              action={async () => {
                dismiss();
                await onConfirm();
              }}
            >
              <HStack padding={8} spacing={4}>
                <Image systemName={"trash"} foregroundStyle={"white"} />
                <Text foregroundStyle={"white"}>删除</Text>
              </HStack>
            </Button>
          </HStack>
        </VStack>
      </ScrollView>
    </NavigationStack>
  );
}

/**
 * Node-edit form. Backend-aware via caps: Komari exposes name/group/tags/
 * weight/price/billing/expiry; Nezha exposes name/note/display_index only.
 * Submits a NodeEditPatch through the facade `editNode`. Writes are sent to the
 * live panel — there is no local-only preview.
 */
function EditNodeView({
  instance,
  node,
  onChanged,
}: {
  instance: Instance;
  node: NodeBasicInfo;
  onChanged: () => Promise<void> | void;
}) {
  const dismiss = Navigation.useDismiss();
  const caps = getBackend(instance.kind).caps;
  const [name, setName] = useState<string>(node.name || "");
  const [group, setGroup] = useState<string>(node.group || "");
  const [tags, setTags] = useState<string>(node.tags || "");
  const [note, setNote] = useState<string>(node.note || "");
  const [weight, setWeight] = useState<string>(String(node.weight ?? 0));
  const [price, setPrice] = useState<string>(String(node.price ?? 0));
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  async function save() {
    setBusy(true);
    setMsg("保存中…");
    const patch: NodeEditPatch = { name: name.trim() };
    if (caps.kind === "nezha") {
      patch.note = note.trim();
      const w = parseInt(weight, 10);
      if (!isNaN(w)) patch.weight = w;
    } else {
      patch.group = group.trim();
      if (caps.hasTags) patch.tags = tags.trim();
      patch.note = note.trim();
      const w = parseInt(weight, 10);
      if (!isNaN(w)) patch.weight = w;
      if (caps.hasBilling) {
        const p = parseFloat(price);
        if (!isNaN(p)) patch.price = p;
      }
    }
    try {
      await editNode(instance, node.uuid, patch);
      setBusy(false);
      dismiss();
      await onChanged();
    } catch (e: any) {
      setBusy(false);
      setMsg(`保存失败：${e?.message || String(e)}`);
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"编辑节点"}
        toolbar={{
          cancellationAction: <Button title={"取消"} action={dismiss} />,
          confirmationAction: (
            <Button title={"保存"} disabled={busy || !name.trim()} action={save} />
          ),
        }}
      >
        <Section header={<Text>基本信息</Text>}>
          <TextField title={"名称"} prompt={"节点名称"} value={name} onChanged={setName} />
          <TextField title={"备注"} prompt={"公开备注 / 备注"} value={note} onChanged={setNote} />
          <TextField
            title={caps.kind === "nezha" ? "排序值" : "权重"}
            prompt={"数字，越大越靠前"}
            value={weight}
            onChanged={setWeight}
          />
        </Section>

        {caps.kind === "komari" ? (
          <Section header={<Text>分类</Text>}>
            <TextField title={"分组"} prompt={"分组名"} value={group} onChanged={setGroup} />
            {caps.hasTags ? (
              <TextField
                title={"标签"}
                prompt={"用 ; 分隔多个标签"}
                value={tags}
                onChanged={setTags}
              />
            ) : null}
          </Section>
        ) : null}

        {caps.kind === "komari" && caps.hasBilling ? (
          <Section header={<Text>计费</Text>} footer={<Text>价格按节点的计费周期计算。</Text>}>
            <TextField title={"价格"} prompt={"0 表示免费"} value={price} onChanged={setPrice} />
          </Section>
        ) : null}

        {msg ? (
          <Section>
            <Text font={"footnote"} foregroundStyle={"secondaryLabel"}>
              {msg}
            </Text>
          </Section>
        ) : null}

        <Section
          footer={
            <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
              {caps.kind === "nezha"
                ? "哪吒的分组 / 标签在面板侧管理，此处不提供。"
                : "保存将直接写入面板，需要管理员凭证。"}
            </Text>
          }
        >
          <></>
        </Section>
      </List>
    </NavigationStack>
  );
}
