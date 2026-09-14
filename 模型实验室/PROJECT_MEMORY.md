# PROJECT_MEMORY.md

模型实验室（OpenAI 兼容接口测活工具）的长期约定，改这个项目前先读。

## 结构

- `index.tsx` → `loadConfig()` → `AppTabs`（测试 / 设置两个 Tab），配置改动经 `AppTabs.updateConfig` 同时 `setState` + `saveConfig`。
- `pages/`：`HomePage`（连接区 + 测试 + 模型列表）、`ModelDetailPage`、`SettingsPage`、`ApiManagerPage`（接口列表）、`ApiEditorPage`（单接口编辑）。
- `api/openaiCompatible.ts`：`fetchModels` / `executeTest`，含思考等级降级链与 token 预算适配；`utils/`：`storage`（配置持久化 + 迁移）、`apiProfiles`（接口增删改查）、`candyTest`、`htmlTest`。
- 页面全部靠 props 单向传递配置，子页面不持有自己的配置副本；推入页面会随父级重渲染拿到新 props。

## 配置模型

- `AppConfig` 里没有 `baseURL` / `apiKey`，接口一律走 `apis: ApiProfile[]` + `activeApiID`，请求端用 `activeApi(config)` 解析当前接口，别再往 AppConfig 上加顶层接口字段。
- 全部配置存在 Storage 单键 `model-lab-config`（脚本私有域），`saveConfig` 整体覆盖写。
- `utils/storage.ts` 的 `resolveApis` 负责三条兼容路径：已有 `apis` 数组原样保留（空数组也保留，不补默认接口）、旧版 `baseURL`/`apiKey` 迁移成第一条接口、无配置时用 `defaultConfig`；接口缺字段或缺 id 会补齐，`activeApiID` 失效时回落到第一条。改这里要保持这三条路径。
- 接口列表可以为空，此时 `activeApi()` 返回空接口，`requireApi()` 抛「请先在「接口管理」中填写接口地址」，界面上不要再假设一定有接口。

## 交互约定

- 切换当前接口或改动当前接口地址后，`HomePage` 的 useEffect 会清空模型列表、勾选和测试结果（旧结果不属于新接口）；测试进行中禁用接口切换 Picker。
- 接口删除只在 `ApiManagerPage` 左滑触发（带 `Dialog.confirm`）。编辑页里不放删除入口——删掉后所在列表行消失会导致已推入页面的返回按钮失效。
- 接口名称留空时界面显示地址主机名；列表里密钥只显示首尾（`maskApiKey`），完整密钥只在编辑页可见。

## 验证方式

- 需要读真实 Storage 配置时，用项目内临时 `intent.tsx` + `scripting-ts run_intent "模型实验室"`，跑完删掉；探针若改写 `model-lab-config`，必须先备份原值并在 `finally` 里还原。
- 页面渲染用项目内临时 `preview.tsx`（default export 视图）+ `scripting-ts preview_ui ... --props`，验证完删除。
