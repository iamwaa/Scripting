// ============================================================================
// Custom groups manager — create / rename / delete local groups and assign
// nodes to them. S: Single Purpose — group CRUD UI; persistence in groups.ts.
// ============================================================================
import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  ZStack,
  useObservable,
  useState,
} from "scripting";
import { useMonitor } from "../context/Monitor";
import {
  loadGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  toggleMember,
  moveGroup,
} from "../class/groups";
import type { CustomGroup } from "../class/filter";

export function View() {
  const dismiss = Navigation.useDismiss();
  const version = useObservable<number>(0);
  const [newName, setNewName] = useState<string>("");

  const groups = loadGroups();

  function refresh() {
    version.setValue(version.value + 1);
  }

  async function openAssign(group: CustomGroup) {
    await Navigation.present({
      element: <AssignView groupId={group.id} onChanged={refresh} />,
    });
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"自定义分组"}
        navigationBarTitleDisplayMode={"inline"}
        listStyle={"insetGrouped"}
        toolbar={{ cancellationAction: [<Button title={"完成"} action={dismiss} />] }}
      >
        <Section
          header={<Text>新建分组</Text>}
          footer={
            <Text>
              分组保存在本机，可在节点列表的分类条切换。也可长按节点快速加入分组。左滑分组可删除，用 ↑↓ 调整顺序。
            </Text>
          }
        >
          <HStack spacing={10}>
            <Image
              systemName={"folder.badge.plus"}
              foregroundStyle={"systemIndigo"}
              font={"title3"}
            />
            <TextField
              title={"分组名"}
              prompt={"例如：生产环境"}
              value={newName}
              onChanged={setNewName}
            />
            <Button
              action={() => {
                if (!newName.trim()) return;
                createGroup(newName);
                setNewName("");
                refresh();
              }}
            >
              <Image
                systemName={"plus.circle.fill"}
                font={"title2"}
                foregroundStyle={newName.trim() ? "systemBlue" : "systemGray"}
              />
            </Button>
          </HStack>
        </Section>

        <Section header={<Text>我的分组（{groups.length}）</Text>}>
          {groups.length === 0 ? (
            <HStack spacing={10} padding={{ vertical: 8 }}>
              <Image systemName={"tray"} foregroundStyle={"tertiaryLabel"} font={"title3"} />
              <Text foregroundStyle={"secondaryLabel"}>还没有分组，在上方新建一个</Text>
              <Spacer />
            </HStack>
          ) : (
            groups.map((g, idx) => (
              <Button
                key={g.id}
                action={() => openAssign(g)}
                trailingSwipeActions={{
                  allowsFullSwipe: true,
                  actions: [
                    <Button
                      title={"删除"}
                      role={"destructive"}
                      action={() => {
                        deleteGroup(g.id);
                        refresh();
                      }}
                    />,
                  ],
                }}
              >
                <HStack spacing={12} padding={{ vertical: 4 }}>
                  <ZStack>
                    <VStack
                      frame={{ width: 38, height: 38 }}
                      background={"systemIndigo"}
                      opacity={0.15}
                      clipShape={{ type: "rect", cornerRadius: 11 }}
                    />
                    <Image systemName={"folder.fill"} foregroundStyle={"systemIndigo"} />
                  </ZStack>
                  <VStack alignment={"leading"} spacing={2}>
                    <Text font={"headline"} lineLimit={1}>
                      {g.name}
                    </Text>
                    <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
                      {g.uuids.length} 个节点
                    </Text>
                  </VStack>
                  <Spacer />
                  <Button
                    action={() => {
                      moveGroup(g.id, -1);
                      refresh();
                    }}
                  >
                    <Image
                      systemName={"chevron.up"}
                      font={"footnote"}
                      foregroundStyle={idx === 0 ? "quaternaryLabel" : "systemBlue"}
                    />
                  </Button>
                  <Button
                    action={() => {
                      moveGroup(g.id, 1);
                      refresh();
                    }}
                  >
                    <Image
                      systemName={"chevron.down"}
                      font={"footnote"}
                      foregroundStyle={idx === groups.length - 1 ? "quaternaryLabel" : "systemBlue"}
                    />
                  </Button>
                  <Image systemName={"chevron.right"} font={"caption"} foregroundStyle={"tertiaryLabel"} />
                </HStack>
              </Button>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}

function AssignView({
  groupId,
  onChanged,
}: {
  groupId: string;
  onChanged: () => void;
}) {
  const dismiss = Navigation.useDismiss();
  const monitor = useMonitor();
  const version = useObservable<number>(0);

  const group = loadGroups().find((g) => g.id === groupId);
  const [name, setName] = useState<string>(group?.name ?? "");
  const nodes = monitor.nodes.value;

  if (!group) {
    return (
      <NavigationStack>
        <List navigationTitle={"分组"}>
          <Text foregroundStyle={"secondaryLabel"}>分组已删除</Text>
        </List>
      </NavigationStack>
    );
  }

  const member = new Set(group.uuids);

  return (
    <NavigationStack>
      <List
        navigationTitle={"编辑分组"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{ cancellationAction: [<Button title={"完成"} action={dismiss} />] }}
      >
        <Section header={<Text>分组名</Text>}>
          <HStack>
            <TextField title={"名称"} value={name} onChanged={setName} />
            <Button
              action={() => {
                renameGroup(groupId, name);
                onChanged();
              }}
            >
              <Text foregroundStyle={"systemBlue"}>保存</Text>
            </Button>
          </HStack>
        </Section>

        <Section header={<Text>选择节点（已选 {member.size}）</Text>}>
          {nodes.length === 0 ? (
            <Text foregroundStyle={"secondaryLabel"}>暂无节点</Text>
          ) : (
            nodes.map((n) => {
              const checked = member.has(n.uuid);
              return (
                <Button
                  key={n.uuid}
                  action={() => {
                    toggleMember(groupId, n.uuid);
                    version.setValue(version.value + 1);
                    onChanged();
                  }}
                >
                  <HStack>
                    <Image
                      systemName={checked ? "checkmark.circle.fill" : "circle"}
                      foregroundStyle={checked ? "systemBlue" : "systemGray"}
                    />
                    <Text foregroundStyle={"label"} lineLimit={1}>
                      {n.name}
                    </Text>
                    <Spacer />
                    {n.group ? (
                      <Text font={"caption2"} foregroundStyle={"tertiaryLabel"}>
                        {n.group}
                      </Text>
                    ) : null}
                  </HStack>
                </Button>
              );
            })
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}
