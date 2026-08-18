# gitgit 代码审查、修复与优化进度

> 记录时间：2026-08-18（进度同步至 P2.63）  
> 项目：`scripts/gitgit`  
> 当前阶段：第三阶段主线与 M7-1、结构债拆分已完成；Widget 状态面板（P2.36）、Issues/PR（P2.38）、回滚强推（P2.44）、列表排序（P2.45）、大仓库读取与状态优化（P2.46–P2.49）、GitHub Actions CI/CD 浏览与重跑闭环（P2.52–P2.63）已完成；下一步可选 Tag 管理或仓库健康检查

## 一、项目概况

`gitgit` 是运行于 Scripting 的移动端 Git GUI，基于 `isomorphic-git 1.38.1`，使用分离式 Git 数据目录：

- 工作区：用户通过安全范围书签授权的真实目录。
- gitdir：App Group 下的 `git-repos/<repoId>/`。
- 仓库元数据、身份和 Widget 快照：使用 Storage private 域。
- GitHub Token：使用 Keychain 保存。
- UI：使用 `TabView`，仓库和设置分别位于独立 `NavigationStack`。

## 二、本轮代码审查结论

### 已确认正确或基本合理的功能

- 本地目录添加与仓库初始化已接线。
- 默认分支为 `main`，支持 unborn HEAD。
- 空仓库能够读取当前分支，并支持新建/切换空分支。
- 单文件暂存和删除暂存已接线。
- Commit、历史记录、Diff、分支操作已接线。
- Push、Pull、Fetch、Clone 和 GitHub 上传流程已接线。
- Pull、Commit、Revert 使用统一作者解析逻辑，缺省身份为 `gitgit / gitgit@local`。
- Soft Reset 只移动分支引用，不修改工作区和 index。
- Revert 使用新的反向提交，不直接改写已发布历史。
- `writeSymbolicHead()` 直接写入 `ref: refs/heads/<branch>\n`，避免 isomorphic-git 自动补前缀造成损坏 HEAD。
- 页面主要使用系统语义色，支持明暗模式。
- 全项目 TypeScript 诊断通过。

### 审查期间发现的主要风险

#### 高风险数据安全问题

1. 文件系统适配器将所有读取、统计异常都伪装成 `ENOENT`。
2. `unlink()` 和 `rmdir()` 吞掉所有删除异常，可能导致磁盘内容与 index 不一致。
3. Revert 的 `statusMatrix()` 异常路径原先 fail-open，可能继续执行强制 checkout 并丢失未提交修改。
4. Amend 的远端判断原先会吞掉分叉、I/O 和 ref 读取异常，可能错误允许历史改写。
5. 仓库级写操作缺少真正的服务层互斥，多个操作可能同时修改工作区、index 或 refs。

#### 中低风险可靠性问题

1. Clone 失败后可能留下工作目录、gitdir 或书签，阻塞原路径重试。
2. GitHub 建仓成功但 Push 失败后，重复重试可能再次创建同名远端仓库。
3. `addFiles(".")` 不能完整覆盖工作区删除暂存语义。
4. 父目录书签移动后，克隆仓库的相对子路径可能被错误回退为父目录根。
5. Diff 对 HEAD/blob 的任意读取异常都可能被当成新增文件。
6. Diff 使用简单 `split("\\n")`，末尾换行可能产生虚假的空行差异。
7. ahead/behind 计算曾依赖固定深度日志，无法可靠处理深历史、分叉和远端领先。
8. 快照刷新不统一，部分路径的 ahead/behind 仍可能使用硬编码或过期值。
9. Keychain 写入/删除结果没有明确校验。
10. 通知内容缺少统一的 URL、Token 和认证信息脱敏策略。
11. 已建立并扩展自动化测试入口；历史拓扑、上传失败恢复、并发写操作、分支、Stash、历史搜索、分支对比和状态性能辅助逻辑均已有覆盖。

以上高风险数据安全问题和中低风险可靠性问题均已在第一、第二阶段及后续 P2.19–P2.46 修复或纳入明确约束；仍保留的可选测试债为 iCloud 协调失败与 index 一致性故障注入。

## 三、第一阶段：数据安全修复（已完成）

### 1. 文件系统错误映射

修改文件：

- `services/gitCore.ts`

完成内容：

- 只将明确的文件不存在错误转换为 `ENOENT`。
- 保留权限、iCloud 访问和其它 I/O 错误，不再伪装成文件不存在。
- 补充识别 `ENOENT`、`ENOTDIR` 以及 iOS 常见的无文件错误码。
- `exists()` 只在确认路径不存在时返回 `false`，其它异常继续抛出。

### 2. 删除错误传播

修改文件：

- `services/gitCore.ts`

完成内容：

- `unlink()` 仅忽略真实的路径不存在错误。
- `rmdir()` 仅忽略真实的路径不存在错误。
- 删除权限不足、目录非空和 I/O 错误均会向上层传播。

### 3. Revert 失败关闭

修改文件：

- `services/gitService.ts`

完成内容：

- Revert 在执行强制 checkout 前必须成功完成 `statusMatrix()` 检查。
- 检查异常直接终止操作。
- 只有工作区和 index 均为干净状态时才允许继续。

### 4. Amend 与 Soft Reset 失败关闭

修改文件：

- `services/gitService.ts`

完成内容：

- 仅当远端跟踪 ref 明确以 `NotFoundError` 表示不存在时，才认为本地提交尚未发布。
- 分叉、远端领先、对象读取失败、ref 读取失败等情况均禁止历史改写。
- 使用提交祖先关系判断，而不是依赖固定深度日志或模糊错误文本。

### 5. 服务层仓库级写操作互斥

修改文件：

- `services/gitService.ts`

新增：

- `runRepoMutation()` 仓库级互斥执行器。

覆盖操作：

- 初始化
- 暂存
- Commit
- 创建/切换分支
- Restore
- 添加远端
- Push/Pull/Fetch
- Clone
- Revert
- Soft Reset
- Amend
- 设置 origin 并 Push

策略：

- 同一仓库正在执行写操作时，新的写操作立即失败并提示稍后重试。
- 操作完成或失败后通过 `finally` 释放锁。
- 不同仓库之间仍可并行。

## 四、验证结果

已执行：

- `gitCore.ts` TypeScript 诊断：通过，0 个错误。
- `gitService.ts` TypeScript 诊断：通过，0 个错误。
- 全项目 TypeScript 诊断：通过，0 个错误。
- `scripting-ts project "gitgit"`：运行成功。
- 服务层危险的“吞掉所有删除异常”模式检查：未发现。

修改前备份：

- `backup/gitgit/gitgit_第一阶段数据安全修复_20260718_025159`

说明：项目结构检查脚本本次因参数解析问题返回 JSON 解析错误；本轮没有新增源代码目录，也没有进行结构重组，因此未据此修改项目结构。

## 五、第二阶段：可靠性与失败恢复（已完成）

### P1：已完成

- [x] Clone 失败时清理 gitdir、工作目录临时内容及孤儿书签。
- [x] Clone 失败后允许同一路径安全重试；原先存在的空目录会恢复为空目录。
- [x] GitHub 上传改为可恢复状态机：远端已创建但 Push 失败时复用已有远端。
- [x] `setOriginAndPush()` 为原 origin 配置提供失败回滚。
- [x] 父目录书签保存克隆仓库的相对子路径，移动父目录后正确恢复 workdir。
- [x] 增加文件系统故障注入测试，验证明确缺失错误与权限/删除错误传播。

### P2：已完成

- [x] 修复 `addFiles(".")` 对删除文件的全量暂存支持。
- [x] Diff 区分文件不存在、权限错误、对象损坏和其它读取异常。
- [x] 修复 Diff 末尾换行与虚假空行统计；`textLines()` 去掉文件末尾换行产生的虚假空行，并统一用于新增/删除/修改路径。
- [x] 使用完整提交图计算 ahead、behind、diverged 和 unknown。
- [x] 统一所有 Git 写操作的成功/失败刷新、快照写入和 Widget reload。
- [x] 匿名 Clone 后支持匿名 Pull。
- [x] 校验 Keychain `set/remove` 返回结果，并处理部分写入回滚和 UI 错误提示。
- [x] 通知中的 URL userinfo、认证查询参数和 GitHub PAT 统一脱敏。
- [x] 建立最小自动化测试入口，当前已覆盖：
  - fs 明确缺失与权限错误传播
  - 删除错误传播
  - Clone 失败清理与空目录恢复
- [ ] 后续扩展自动化覆盖：已并入第三阶段 3.1

### 第二阶段验证结果

已执行：

- 全项目 TypeScript 诊断：通过，0 个错误。
- `tests/reliability.test.ts`：通过，输出 `✅ reliability tests passed`。
- `scripting-ts project "gitgit"`：运行成功。
- 项目结构检查：通过；仅提示用途明确的非标准目录 `tests/` 与第三方 `vendor/`。
- 关键路径人工复核：Clone 清理、上传 pending 状态复用、origin 回滚、统一快照刷新、匿名 Pull、Keychain 返回值校验和通知脱敏均已接线。
- 验证中额外修复：`diffService.textLines()` 曾自递归，已改为 `split("\\n")` 并让 `buildModified` 复用。

修改前备份：

- `backup/gitgit/gitgit_第二阶段可靠性与失败恢复修复_20260718_063958`

历史结构说明（第二阶段结束时）：`services/gitService.ts` 当时约 1378 行，曾作为强内聚例外暂缓拆分。拓扑、上传和并发测试补齐后已继续演进，并于 2026-08-04 完成 facade 与职责模块拆分，现状见 3.4。

## 六、第三阶段：扩展测试 + 本地 Git 能力（主线已完成）

目标：在第二阶段可靠性底座上补齐高价值自动化测试，完成第一梯队本地日常 Git 能力、M7-1 分支管理与核心结构拆分；Tag 与仓库健康检查保留为可选后续项。

### 实施原则（沿用）

1. 先测试债，再功能增量；主线已按 3.1 → 3.2 → M7-1 → 3.4 推进完成。
2. 每项 Git 写操作必须接入 `runRepoMutation()`，具备明确错误传播与统一快照刷新。
3. 新增服务逻辑优先配套最小可验证测试；不把 TypeScript 通过当作运行时正确性证明。
4. Git 服务和详情页拆分已完成；后续新增职责继续遵守 facade、职责模块、组件与 hooks 边界。
5. 必要注释使用中文；UI 保持系统语义色与明暗模式可读性。

### 3.1 扩展自动化测试（优先，P0）— 已完成

- [x] 历史拓扑：ahead / behind / diverged / unknown 与深历史、分叉场景。
- [x] 上传失败恢复：pending 状态复用远端、禁止重复建仓、`setOriginAndPush` origin 回滚。
- [x] 并发写操作：同一仓库互斥立即失败、不同仓库可并行、`finally` 释放锁。
- [ ] （可选）iCloud 协调失败与 index 一致性相关故障注入。

实现要点：

- 新增 `utils/gitSync.ts`：提取 `computeSyncTopology`、`resolveUploadRemoteTarget`、`buildUploadPendingPatch` / `buildUploadSuccessPatch`、`desiredOriginAfterFailedPush`、`acquireRepoMutationLock` / `releaseRepoMutationLock`。
- `gitService.ts` 的拓扑计算与仓库写锁、origin 回滚接入上述纯函数。
- `UploadGitHubPage.tsx` 上传建仓/重试/成功补丁接入上述纯函数，行为与原先一致。
- `tests/reliability.test.ts` 增补 `testSyncTopology`、`testUploadFailureRecovery`、`testRepoMutationLock`。

验收：

- [x] 相关用例并入 `tests/reliability.test.ts`。
- [x] `scripting-ts run tests/reliability.test.ts` 通过（`✅ reliability tests passed`）。
- [x] 全项目 TypeScript 诊断 0 错误。
- [x] `scripting-ts project "gitgit"` 入口运行成功。

修改前备份：

- `backup/gitgit/gitgit_第三阶段M1扩展自动化测试_20260719_092833`

### 3.2 第一梯队功能（P1）

按推荐实施顺序：

1. [x] **全部暂存 / 全部取消暂存**（M2 已完成）
   - 服务层：`stageAll` / `unstageAll`（全量 stage 含删除语义；unstage 有 HEAD 用 `resetIndex`，空仓用 `remove` 清索引）。
   - 纯函数：`utils/stageSelection.ts` 从 statusMatrix 挑选路径与 add/remove 动作。
   - UI：改动 Tab「全部暂存 / 全部取消暂存」；`stagingBusy` 禁用并发操作并展示错误 alert。
   - 测试：`testStageSelection` 覆盖需暂存/取消暂存路径与动作。
   - 备份：`backup/gitgit/gitgit_第三阶段M2全部暂存取消暂存_20260719_100252`
2. [x] **Stash：创建、查看、应用、删除**（M3 已完成）
   - 服务层：`createStash` / `listStashes` / `applyStash` / `dropStash`，写操作接入仓库级互斥。
   - 安全语义：首次提交前拒绝创建；应用前要求 HEAD / 工作区 / 索引一致；Apply 保留 Stash，删除单独确认。
   - 纯函数：`utils/stash.ts` 解析 `stash@{N}` 列表并判断 statusMatrix 是否干净。
   - UI：改动 Tab 展示 Stash 列表，支持备注创建、左滑应用/删除、busy 与错误提示。
   - 测试：`testStashHelpers` 覆盖列表解析、异常过滤与应用前干净状态判断。
   - 备份：`backup/gitgit/gitgit_第三阶段M3_Stash闭环_20260719_104513`
3. [x] **Remote / upstream 管理**（M4 已完成）
   - 纯函数：`utils/remote.ts` 校验名称/URL、添加/改 URL/删除规划与回滚、upstream 规范化与展示。
   - 服务层：`addRemote` 增强校验；新增 `setRemoteUrl` / `deleteRemote` / `getBranchUpstream` / `setBranchUpstream`，写操作接入 `runRepoMutation`；改 URL/删除失败回滚；origin 变更同步 `RepoMeta.remoteUrl`。
   - UI：`pages/RemotesPage.tsx` 列表/添加/左滑改 URL 与删除/设置当前分支 upstream；详情页同步/上传/无远端区均可进入「远端管理」。
   - 测试：`testRemoteHelpers` 覆盖校验、规划、upstream 与 meta 辅助。
   - 备份：`backup/gitgit/gitgit_第三阶段M4_Remote_upstream管理_20260720_221217`
4. [x] **冲突文件展示、冲突解决与 Abort Merge**（M5 已完成）
   - 纯函数：`utils/mergeConflict.ts` 冲突分类、状态序列化、解决策略与合并双亲。
   - 服务层：`pull` 改为 fetch + `merge({ abortOnConflict: false })`；冲突写入 `gitgit-merge-state.json`；`getMergeConflictState` / `resolveConflictFile` / `completeMerge` / `abortMerge`。
   - UI：`pages/ConflictsPage.tsx`；详情页冲突横幅与 Pull/Push 冲突自动进入；进行中合并禁用再次 Pull/Push。
   - 测试：`testMergeConflictHelpers`。
   - 备份：`backup/gitgit/gitgit_第三阶段M5_冲突展示解决Abort_20260720_223554`
5. [x] **合并到当前分支 + Pull 语义文案**（侧线已完成，2026-07-20）
   - 纯函数：`utils/branchMerge.ts` — `planMergeIntoCurrent`、`formatPullSuccessAlert`、`formatMergeSuccessAlert`、`pullActionFooterHint`。
   - 服务层：`pull` 返回 `PullResult`（upToDate|updated）；`mergeBranchIntoCurrent` 合并本地/`origin/xxx` 进当前分支，冲突复用 merge-state + ConflictsPage。
   - UI：同步区 footer 写明跟踪目标；Pull 成功区分「已是最新 / 拉取成功」；分支区 Menu「合并到当前」。
   - 测试：`testBranchMergeHelpers`。
   - 备份：`backup/gitgit/gitgit_合并到当前分支与Pull文案_20260720_233647`
5b. [x] **Pull 读取 Upstream**（2026-07-21）
   - 纯函数：`resolvePullTarget`（有 upstream 用 remote/merge；无则 origin/同名；explicit ref 忽略 upstream）。
   - 服务层：`pullInternal` fetch+merge 按解析目标；Push 仍固定 origin/同名。
   - UI：详情 footer 展示实际跟踪；RemotesPage 说明 Pull 跟 Upstream、Push 仍 origin/同名。
   - 测试：`testBranchMergeHelpers` 增补 resolvePullTarget 用例。
   - 备份：`backup/gitgit/gitgit_Pull读取upstream_20260721_074956`
6. [x] **Clone / Push / Pull 进度显示与取消**（M6，2026-07-21）
   - 纯函数：`utils/remoteProgress.ts`（phase 中文、百分比、`RemoteCancelToken`、取消错误 code）。
   - 服务层：`push`/`pull`/`clone` 接受 `RemoteOpOptions`；`onProgress` 接到 isomorphic-git；协作式取消在进度回调与步骤检查点抛出；`runRepoMutation` finally 释放写锁。
   - UI：ClonePage / 详情同步区展示进度文案 + 取消按钮；克隆取消走既有 `cleanupCloneAttempt`。
   - 测试：`testRemoteProgressHelpers`；TS 诊断 0；reliability 全通过。
   - 备份：`backup/gitgit/gitgit_第三阶段M6远程进度与取消_20260721_084317`

### 3.3 第二梯队（本阶段可选，3.2 完成后）

- [x] 分支删除、重命名和远端分支管理。（M7-1 已完成，2026-07-27）
  - 纯函数：`utils/branch.ts` 校验分支名（check-ref-format 子集）与删除/重命名/删远端分支规划。
  - 服务层：`getManagedBranches`（区分本地/仅远端）、`deleteBranch`、`renameBranch`、`deleteRemoteBranch`（push --delete），写操作接入 `runRepoMutation`；删本地分支同步清理 upstream 配置、删远端分支同步清理 remote-tracking ref；重命名旧分支若发布过则自动同步远端（`branch.<to>.merge` 改写为 `refs/heads/<to>` + `pushInternal(..., remoteRef)` 推新分支 + 删远端旧分支；曾因保留旧 merge 导致推到旧远端名再被删除，现已修复；远端失败不回滚本地，`RenameBranchResult` 回传 UI）。
  - UI（内联详情页，无独立管理页）：分支区 Picker 显示当前分支并切换，每项带「· 本地 / · 远端」标签；header 平铺四个操作（从左到右：删除、合并、重命名、新建），删除为 Menu 列所有非当前分支（远端项标注、走 push --delete），重命名作用于当前分支，删除复用详情页声明式确认 alert。
  - 测试：`tests/reliability.test.ts` 的 `testBranchHelpers` 覆盖名称校验、删除/重命名/删远端规划。
  - 备份：`backup/gitgit/gitgit_分支管理删除重命名_20260727_125255`
- [ ] Tag 创建、查看和删除。
- [x] 提交详情页，包括文件级变更列表和相对第一父提交的单文件 Diff。（已完成，见第九节）
- [x] 历史搜索与分页加载。
  - `utils/history.ts` 提供大小写不敏感的标题、描述、作者、邮箱和 OID 匹配，以及分页边界处理。
  - `getLogPage()` 保持 `getLog()` 兼容，历史页支持搜索、结果计数和加载更多。
  - 测试：`tests/history.test.ts`，并纳入 `tests/reliability.test.ts`。
- [ ] 仓库健康检查，包括 HEAD、index、objects、config 和工作区访问性。

### 3.4 结构债（已完成，2026-08-04）

- [x] `services/gitService.ts` 已从约 3960 行收缩为 facade（拆分时 515 行，随后新增公开签名后现为 590 行），仅保留仓库 mutation 锁、快照刷新、后台保活与公开 API 包装。
- [x] Git 职责已拆入 `services/git/`：`runtime`、`worktreeService`、`branchQueryService`、`branchService`、`remoteConfigService`、`remoteService`、`mergeService`、`mergeConflictService`、`statusQueryService`、`repoStatusService`、`commitService`、`compareService`、`stashService`、`historyMutationService`。
- [x] `RepoDetailPage.tsx` 已从约 1534 行降至 971 行；分支/远端视图、导航目标、Tab 内容拆入 `components/`，分支与同步动作编排拆入 `hooks/`。（2026-08-18 复核：因 Actions 与 GitHub 功能接入，该页已回升至 1174 行，需再次拆分。）
- [x] 公开页面继续只从 `services/gitService.ts` 导入 Git API；子服务不得反向导入 facade，页面不得绕过 facade 直接调用 internal mutation。

后续结构约束：新增 Git 行为优先落入对应 `services/git/*Service.ts`，facade 只维持公开签名、mutation 锁、快照刷新与后台保活。

### 明确不纳入第三阶段主线（第四阶段及以后）

- [x] GitHub Issues 和 Pull Requests（P2.38：浏览 + 创建 Issue；PR 只读）。
- [ ] GitHub 仓库列表、创建、删除和远端绑定管理（超出当前上传闭环的管理面）。
- [x] Widget（P2.36：多尺寸状态面板 + 锁屏 accessory + 参数筛选；不做交互式写操作）。
- [x] GitHub Actions CI/CD 浏览（P2.52–P2.62：运行列表、注解、Jobs、步骤分段日志、工件下载、手动触发、删除运行）。
- [x] 失败通知（P2.54：设置页开关控制的 push/pull/clone/upload 失败本地通知）；富通知自定义 UI（`notification.tsx`）仍未做。
- [ ] 多仓库批量同步。

### 第三阶段里程碑

| 里程碑 | 内容 | 退出条件 |
|---|---|---|
| M1 | 3.1 拓扑 + 上传恢复 + 并发测试 | 已完成：自动化用例通过 |
| M2 | 全部暂存/取消暂存 | 已完成：服务 + UI + 测试/诊断/冒烟通过 |
| M3 | Stash 闭环 | 已完成：创建/查看/应用/删除可用，测试/诊断/冒烟通过 |
| M4 | Remote/upstream 管理 | 已完成：服务 + UI + 测试/诊断通过 |
| M5 | 冲突展示/解决/Abort | 已完成：服务 + UI + 测试/诊断通过 |
| M6 | 远程操作进度与取消 | 已完成：进度可见、取消可重试（测试/诊断通过） |
| M7-1 | 分支删除、重命名和远端分支管理 | 已完成：服务 + UI + 测试通过 |
| M7-2（可选） | Tag 管理或仓库健康检查 | 待选，不阻塞第三阶段既有主线 |
| 结构债 | Git 服务 facade 与详情页职责拆分 | 已完成：服务模块化、页面组件与 hooks 拆分 |

## 七、后续实施原则

1. 先处理数据安全和失败恢复，再扩展功能。
2. 每项 Git 写操作都必须具备明确的互斥、错误传播和状态刷新语义。
3. 不把 TypeScript 通过当作运行时正确性的证明。
4. 新增功能优先配套最小可验证测试。
5. `services/gitService.ts` 已完成 facade 化；新增 Git 行为优先落入 `services/git/*Service.ts`，详情页新增职责优先放入既有组件或 hooks 边界。
6. 所有必要代码注释使用中文，并保持 UI 的明暗模式可读性。

## 八、当前状态摘要

| 类别 | 状态 |
|---|---|
| 全量代码审查 | 已完成 |
| 第一阶段数据安全修复 | 已完成 |
| 第二阶段可靠性与失败恢复 | 已完成 |
| TypeScript 诊断 | 2026-08-18 全项目通过，0 个错误 |
| 项目入口运行验证 | 2026-08-05 `scripting-ts project "gitgit"` 运行成功；之后未重跑 |
| 自动化测试 | 15 个文件：`reliability`、`history`、`compare`、`inlineDiff`、`status-perf-helpers`、`widget`、`github`、`mergeCompletion`、`repoSort`、`performance`、`statusFreshness`、`singleFlight`、`commitTreeDiff`、`actionsLog`、`logLevel` |
| Clone 失败恢复 | 已完成 |
| GitHub 上传失败恢复 | 已完成 |
| Diff 与历史拓扑优化 | 已完成 |
| 扩展自动化覆盖 | 第三阶段 3.1 已完成（拓扑/上传恢复/并发）；iCloud 故障注入仍可选 |
| M2 全部暂存/取消暂存 | 已完成 |
| M3 Stash 闭环与可靠性修复 | 已完成 |
| M4 Remote/upstream 管理 | 已完成 |
| M5 冲突展示/解决/Abort | 已完成 |
| M6 远程操作进度与取消 | 已完成 |
| M7-1 分支管理 | 已完成 |
| 结构债拆分 | 2026-08-04 已完成：Git facade + 14 个职责模块；详情页组件/hooks 拆分。**详情页已回升至 1174 行，需再次拆分** |
| 第三阶段主线 | M1–M7-1 与结构拆分完成；下一步可选 Tag 管理或仓库健康检查 |
| 近期新增功能 | 分支/远端差异对比、远端分支自动获取、统一表单 Sheet、自动提交标题、小组件状态面板（P2.36）、Issues/PR（P2.38）、头像显示（P2.39、P2.51）、冲突清单与批量标记（P2.40–P2.41）、合并提交完整性（P2.43）、回滚并强推（P2.44）、仓库列表排序（P2.45、P2.48）、大仓库读取与状态调度优化（P2.46–P2.49）、Toast 与失败通知（P2.54）、GitHub Actions CI/CD 浏览闭环（P2.52–P2.62）均已完成 |
| GitHub Actions | 已完成（P2.52–P2.63：运行列表、注解、Jobs、步骤分段日志、工件下载、手动触发、删除运行、重新运行） |
| Widget | 已完成（P2.36 状态面板；不另做交互式写操作） |
| 后阶段功能 | 富通知（自定义 UI）、多仓库批量同步、更完整 GitHub 仓库管理面等不纳入第三阶段 |

## 九、详情页文件列表与历史详情（已完成）

完成内容：

- 仓库详情新增“文件”视图，读取当前 `HEAD` 的已跟踪文件，不混入未跟踪工作区内容。
- 历史提交行支持点击进入详情，展示完整 OID、作者、时间、父提交和文件变更数量。
- 比较当前提交树与第一父提交树，区分新增、修改、删除文件；根提交按空树处理。
- 文件变更支持点击查看该提交相对父提交的行级 Diff，并兼容删除文件与二进制文件。
- 当前文件列表仅在明确没有 `HEAD` 时返回空数组；权限、对象损坏和其它读取错误继续抛出，由页面显示加载失败。
- 提交树比较已提取为纯函数，并覆盖新增、修改、删除、未变化文件及根提交场景。
- 当前分支文件列表和历史提交文件变更均使用可展开目录树：根级显示一级文件/文件夹，目录可继续展开到任意深度；同层目录优先、名称排序，历史叶子文件保留 A/M/D 与 Diff 跳转。
- 修复历史列表偶发空白行：所有提交统一使用同一种外层 `HStack`，复制按钮与 `NavigationLink` 改为同级，避免导航标签内嵌按钮及 HEAD 特殊行结构触发原生 List 复用异常。
- 二次修复：移除历史列表中的 `NavigationLink`，提交详情由父页受控 `navigationDestination` 打开。
- 最终修复：移除列表中的 `CommitRow` 子组件和根视图点击手势，短 OID、标题、作者、状态直接在 `HistoryTab` 的固定行内渲染，避免复杂子组件在原生 List 刷新/复用时丢失内容；复制按钮位于短 OID 右侧且与详情按钮同级，不产生按钮嵌套。

验证结果：

- 全项目 TypeScript 诊断：通过，0 个错误。
- `scripting-ts project "gitgit"`：运行成功。
- `scripting-ts run tests/reliability.test.ts`：通过，包含提交树 A/M/D、根提交和多级文件树排序用例。
- 项目结构检查：通过；仅提示用途明确的 `tests/` 与第三方 `vendor/`。

修改前备份：

- `backup/gitgit/gitgit_详情页增加文件列表和历史详情_20260718_173802`
- `backup/gitgit/gitgit_补充文件历史详情测试与错误处理_20260718_182316`
- `backup/gitgit/gitgit_文件列表分级目录树显示_20260718_201223`
- `backup/gitgit/gitgit_历史文件列表分级目录树_20260718_202256`
- `backup/gitgit/gitgit_修复历史列表偶发空白行_20260718_205238`
- `backup/gitgit/gitgit_改用受控导航修复历史空白行_20260718_211156`
- `backup/gitgit/gitgit_展开历史行修复空白内容_20260718_222339`
- `backup/gitgit/gitgit_复制按钮移到提交编号右侧_20260718_232218`

## 十、P2.19–P2.62 后续修复与增强（已完成）

### 10.1 Git 正确性与可靠性

- [x] **P2.19 Stash 可靠性**：过滤并修复幽灵 reflog 项，备注强制单行，自实现安全 drop/repair；创建前全量暂存未暂存、未跟踪与删除文件；Stash 可进入提交详情查看改动。
- [x] **P2.20 分支切换假改动**：切换前要求工作区干净，所有生产 checkout 使用 `force`，远端跟踪分支先创建再强制 checkout；测试覆盖分支独占文件切换后状态干净。
- [x] **P2.25 Pull 删除文件收尾**：工作区文件删除期间延迟记录空目录候选，Git 操作完整成功后才清理空父目录，避免提前删目录造成 index 假删除。
- [x] **P2.26 最近拉取时间按分支保存**：使用 `lastPulledAtByBranch` 隔离各本地分支时间，Pull 和 Push 前自动 Pull 均按实际分支更新。

### 10.2 性能、状态与交互修复

- [x] **P2.21 大仓库状态优化**：FS `stat` 并行读取；ahead/behind 改用 merge-base 与第一父计数；列表状态单仓串行刷新；详情首屏缩减，Stash 与文件 Tab 懒加载。
- [x] **P2.22–P2.24 Diff/历史修复**：Diff 省略区使用独立 `skip` 样式；提交详情随 OID 重载并防止导航复用串页；历史搜索支持回车提交、清空与实际字段提示。
- [x] **P2.27–P2.29 进度与列表状态**：分支等本地操作补全屏 `BusyOverlay`；首页状态改行内加载；列表停止读取快照，快照仅供 Widget 使用。
- [x] **P2.30 Token 验证持久化**：已验证 GitHub 用户名保存至 Storage；Token 更换或清除时同步作废验证缓存，Token 本身仍只存 Keychain。

### 10.3 功能与 UI 完善

- [x] **P2.31 分支/远端差异对比**：按当前 upstream 计算领先、落后、分叉提交与 merge-base 三点文件差异；纯读本地 refs，支持取消与全屏进度。
- [x] **P2.32–P2.33 远端分支管理精简**：远端管理页自动 fetch/prune 当前 remote，Picker 展示远端分支；移除 upstream 与合并来源的手动分支输入。
- [x] **P2.34 半屏表单统一**：新增 `FormSheet`、`AddRemoteSheet`，表单草稿改由 Sheet 内 Observable 持有；支持双 detent、材质背景与交互式收键盘。
- [x] **P2.35 自动提交标题**：普通提交按已暂存改动生成可编辑标题，单文件区分新增/更新/删除，多文件显示数量；重编提交继续沿用原标题与描述。
- [x] **P2.36 小组件与锁屏组件状态面板**：适配主屏小/中/大/超大与三种 accessory 尺寸，展示未提交、待推送、待拉取、分支和更新时间；支持按仓库名参数筛选。小号四区块用三个等权重 `Spacer` 平分剩余高度，上下使用 `12pt` 固定边缘带；中号展示优先级最高的两个仓库；中/大号更新时间位于右上角，仓库行状态统一为“1 改动 / 2 待推送 / 1 待拉取”文字。锁屏 accessory 与系统组件同步：矩形同中号头行+文字状态，圆形用 `AccessoryWidgetBackground`+主指标，单行为统一文案。`getRepoListStatus()` 实时查询成功后写快照并 `Widget.reloadAll()`，列表与详情刷新均可同步外部文件改动。
- [x] **P2.37 Stash 页眉整理**：Section header 改为“Stash（数量）”，保存按钮从首行移到标题右侧（紧凑按钮，无改动时禁用但仍显示）。

### 10.4 GitHub 协作、头像与合并正确性（P2.38–P2.43）

- [x] **P2.38 GitHub Issues / Pull Requests**：`origin` 可解析为 GitHub 仓库时详情页显示协作入口；Issue/PR 列表支持类型与状态筛选、分页、创建 Issue；详情页渲染正文、标签与评论，Markdown 图片单独抽出限宽渲染，图片放大器用 WebView 实现。
- [x] **P2.39 用户头像**：新增 `AvatarView`；设置页、Issue/PR 列表与详情、提交历史均显示头像；已验证用户缓存扩展为 `{login, avatarUrl}`，本地 Git 身份经 noreply / Gravatar 推导头像。
- [x] **P2.40–P2.41 冲突处理闭环**：冲突页可复制面向 Agent 的 Markdown 冲突清单（含执行约束），并可一键检测冲突状态批量标记已解决（严格行首标记正则，已删/无标记/含标记分三类处理）。
- [x] **P2.42 完成合并后避免重复全树扇描**：`runRepoMutation` 增 `refreshSnapshot` 参数，`completeMerge` 不刷快照；冲突页完成后只后台刷新必要数据并跳过返回详情页的全量 `loadAll`。
- [x] **P2.43 合并提交包含完整合并结果**：完成合并前按 base/ours/theirs 三方语义补齐自动合并的修改、新增与删除，不再遗漏到二次提交；`tests/mergeCompletion.test.ts` 走真实合并链路。

### 10.5 回滚与列表排序（P2.44–P2.45）

- [x] **P2.44 回滚并强推**（`pages/RollbackPage.tsx`）
  - 入口：详情页「同步」Section 页眉「回滚」按钮（`arrow.uturn.backward`，橙色），仅在有远端且非 mutating / 非合并中 / 有提交时可用。
  - 选择页只负责展示当前分支历史（`getLogPage`，页大小 50，支持加载更多与去重）并回传选中提交；确认与执行统一由详情页 `PendingAction` / `runPending` 处理。
  - 服务层：`resetToCommitAndForcePush()`（facade）= `runWithBackgroundKeepAlive` + `runRepoMutation`，内部先 `resetToCommitInternal`（校验目标提交存在、必须在命名分支、**工作区必须干净**，然后 force checkout + `writeRef` + `writeSymbolicHead`），再 `pushInternal(..., force=true)` 强推 origin 同名分支。
  - 安全语义：确认弹窗明写“重置 + 强制覆盖远端、不可撤销”；全屏 `BusyOverlay` 展示进度并支持 `RemoteCancelToken` 取消；强推被取消时单独提示“本地可能已重置、远端仍为原历史”，不伪装成成功。
- [x] **P2.45 仓库列表按名称排序**（`utils/repoSort.ts`）
  - 纯函数 `sortReposByName()` 返回新数组，不修改入参也不改动持久化的仓库数组。
  - 比较规则：忽略大小写与首尾空格，数字按自然序（`numeric: true`）；ASCII 首字符名称在前、中文名按拼音在后（与系统文件 App 一致）——直接用 `zh-Hans` `localeCompare` 会把中文排到最前。
  - `RepoListPage` 在渲染与串行刷新状态时均使用排序后的顺序，保证列表与刷新顺序一致。
  - 测试：`tests/repoSort.test.ts` 轻量探针，覆盖升序与中英分组、返回新数组不污染入参、数字自然序、空名称不抛错。

### 10.6 历史首屏解耦提交同步标记（P2.46，2026-08-07）

- [x] `getLog()` 不再做 `findMergeBase`、父链遍历或全量可达提交差集，避免 fork 与 upstream 分叉的大仓库在历史已可读时仍被拓扑计算阻塞。
- [x] `syncStatus` 改用当前页深度内的 `origin/<当前分支>` 日志集合恢复“待推送/远端”标签；空仓判定改由 `hasHeadCommit()` 单独解析 `HEAD`，历史分页失败或搜索无结果不再误报空仓库。

### 10.7 大仓库读取、缓存与状态调度（P2.47–P2.49，2026-08-07）

- [x] **P2.47 历史懒加载、缓存限额与性能诊断**：历史缓存改由 `utils/lru.ts::setLruEntry` 管理，最多保留最近 4 个仓库、每仓 5,000 条；达到条目上限返回 `HistoryPage.limited=true`，历史页明示“仅扫描最近 5,000 条提交”，不伪报精确匹配总数。详情首屏只用 `hasHeadCommit()` 判断提交存在性，历史与 Stash/文件同为首次切 Tab 才加载。`utils/performance.ts` 仅保留超过 2 秒的慢操作（环形上限 30 条），路径只留末级目录，不记录 Token、远端 URL 或文件内容；设置页「性能诊断」可复制 Markdown 报告或清除记录。测试：`tests/performance.test.ts`。
- [x] **P2.48 仓库列表待处理优先与状态扫描去重**：`utils/repoSort.ts::sortReposForList()` 把未提交、ahead、behind、合并中、冲突、工作区失效或状态错误的仓库置顶，组内继续沿用 P2.45 的中英文与自然数字排序；列表行同步展示待拉取数量，behind 仓库不再误显示“无改动”。`RepoListPage.refreshAll()` 与 `getRepoListStatus()` 分别按整轮、同仓库 single-flight 合并并发请求，新增仓库只扫描新增项。测试：`tests/repoSort.test.ts`、`tests/singleFlight.test.ts`。
- [x] **P2.49 仓库状态 30 秒新鲜期**：最近完成时间、仓库集合签名、整轮 Promise 与实时 `statusMap` 提升为模块级缓存，页面实例重建仍复用同一轮扫描。默认 `onAppear` 在最近成功扫描后 30 秒内只重读元数据与快照，不执行 `statusMatrix`；仓库集合变化、详情页写入更新快照、30 秒到期会自动失效，`List.refreshable` 下拉始终强制实时扫描。纯判断位于 `utils/statusFreshness.ts`，测试 `tests/statusFreshness.test.ts`。

### 10.8 删除类冲突核验与真实头像（P2.50–P2.51，2026-08-07）

- [x] **P2.50 删除类合并冲突误判修复**：isomorphic-git 1.38.1 在删除场景会把“未删除侧与 base 相同”也报成 `deleteByUs` 或 `deleteByTheirs`。`mergeService.filterUnmodifiedDeleteConflicts()` 读取 merge-base、ours、theirs 三棵树，未修改侧按普通删除收口工作区与 index，不持久化为冲突；`mergeConflictService.autoMarkResolvedConflictsInternal()` 对删除类冲突比较工作区与初始保留侧 blob，仍原样时回报 `unchangedDeleteFiles` 并保留冲突状态，避免「检测冲突状态」清空未处理项。`ConflictsPage` 状态行统一 SF Symbols（加载中、无冲突绿、待解决橙）。测试：`tests/mergeCompletion.test.ts`、`tests/reliability.test.ts`。
- [x] **P2.51 普通邮箱作者优先显示 GitHub 真实头像**：`api/githubApi.ts::getCommitAvatarUrls()` 用一次 GraphQL 批量查询当前列表最多 100 个提交 OID 的 `Commit.author.user.avatarUrl`，提交详情复用同一查询与最多 500 条内存 LRU。真实头像仅在 GitHub 已关联提交账号时覆盖，未关联、未推送、无 Token、网络失败与非 GitHub 仓库继续走 noreply、Gravatar、占位回退，失败不阻塞页面；空结果不缓存。测试：`tests/github.test.ts`。

### 10.9 GitHub Actions CI/CD 浏览闭环（P2.52–P2.62，2026-08-14–08-16）

功能范围：运行列表 → 运行详情（注解 / Jobs / 工件）→ 步骤分段日志，另含手动触发、工作流筛选与删除运行。

- [x] **P2.52 Actions 浏览基础**：`pages/ActionsPage.tsx` 展示工作流运行列表（`listWorkflowRuns`，`/repos/{o}/{r}/actions/runs`），行内含状态图标、displayTitle、工作流名、分支、事件、触发者头像、短 SHA 与相对时间，支持分页与请求竞态保护。`pages/ActionRunDetailPage.tsx`（受控 `navigationDestination` + `key={runId}`）展示运行概要与 Job 列表（`listWorkflowJobs`），Job 可展开查看步骤与日志（`getJobLog`，410 表示日志已过期）。类型位于 `types/github.ts`。
- [x] **P2.53 入口菜单化 + 手动触发 + 筛选**：`GitHubWorkPage` 类型切换从 segmented Picker 改为 toolbar `Menu`（Issues / Pull Requests / Actions 各带图标）。新增 `listWorkflows`、`dispatchWorkflow`（workflow_dispatch，POST `ref` + `inputs`）；`listWorkflowRuns` 支持按工作流筛选。`ActionsPage` 增加工作流筛选 Picker 与手动触发 Menu（`Dialog.prompt` 输入分支，触发后延迟 2 秒刷新，非 active 工作流禁用）。
- [x] **P2.54 Toast 顶部提示 + 失败通知**：`hooks/useToast.ts` 与 `components/Toast.tsx` 用内置 `List.toast` 替代阻塞 alert，九个页面接入；`List.alert` 仅保留确认对话框与关键警告，详情页加载失败保留 inline 重试。`notifyService.notifyError(kind, repoName, message)` 受设置页「失败通知」开关控制，默认关闭。
- [x] **P2.55–P2.56 步骤分段日志**：`utils/actionsLog.ts::parseStepSegments()` 以 `##[group]Run xxx`（`RUN_GROUP_RE`）为唯一步骤锚点切分日志——首个锚点前整段归 Set up job，出现用户步骤后才用 `POST_ANCHOR_RE` 判定后置段（**绝不前缀匹配 `complete job`**，否则 Set up job 内的 `Complete job name:` 会提前切换 phase），相邻锚点间的块按顺序映射到 `conclusion !== "skipped"` 的用户步骤，块多于步骤时余块归最后一个已匹配步骤。`buildStepOptions` 与 `formatStepDuration` 提供行数、错误警告统计与耗时。`components/ActionLogViewer.tsx` 上方步骤筛选、下方日志内容；`ActionRunDetailPage` 的步骤行本身即日志入口，未加载时先自动加载再预选。测试：`tests/actionsLog.test.ts`。
- [x] **P2.57–P2.60 日志呈现与级别判定**：日志行只渲染行号与内容两列，级别完全用颜色表达（error 红、warning 橙、success 绿、info 三级灰），空行过滤后重新连续编号。级别判定收归 `utils/actionsLog.ts::detectLogLevel(raw, content?)`，优先级为 Runner 标记 > ANSI 颜色（`stripAnsi` + `detectAnsiLevel`，不剥离时彩色输出会显示成 `[36;1m` 乱码）> 退出码 > 关键字 > info；关键字匹配前先 `stripNoiseTokens`（URL、`-Werror`、路径、文件名）与 `stripZeroCounts`（`0 errors`）并走词边界，避免 token、look、unsuccessful 等误判。回归：`tests/logLevel.test.ts`（38 例，含假阳性用例），改判定规则前先跑它。
- [x] **P2.61 页面下拉刷新统一**：仓库详情移除右上角刷新按钮改用 `List.refreshable`；GitHub Issue/PR 列表与详情、Actions 列表与运行详情、远端管理、冲突状态、工作区 Diff、与远端差异、回滚历史均补齐下拉刷新。固定 OID 的提交详情与 Diff，以及设置、克隆、上传表单不增加。
- [x] **P2.62 历史行 Checks 徽标**：`HistoryRow` 在 GitHub 仓库且 commit 为 40 hex 时，于短 OID 左侧显示合并后的 Actions / Checks 状态图标，数据来自 `getCommitCheckStatuses()`（GraphQL `object(oid)→Commit.statusCheckRollup{state}`，最多 100 个提交，LRU 500 条，无 rollup 不缓存）；无 Token 或网络失败返回空映射，不阻断页面。
- [x] **注解（Annotations）展示**：`getJobAnnotations(fullName, checkRunId)`（`/repos/{o}/{r}/check-runs/{id}/annotations`）；`ActionJob.checkRunId` 由 `mapJob` 解析，运行详情页把全部 Job 的注解合并为独立「注解」Section 并置于 Jobs 之上，按 failure / warning / notice 三级着色并显示 `path:line`。注解在 `load()` 之后**后台获取，不阻塞首屏**，失败静默降级为空列表。
- [x] **工件（Artifacts）下载**：`listArtifacts`（`/actions/runs/{id}/artifacts`）与 `getArtifactDownloadInfo`（`/actions/artifacts/{id}/zip` 的 URL 与认证头）。运行详情页「工件」Section 显示名称、大小、有效期与创建时间，过期项禁用下载。下载走 `BackgroundURLSession.startDownload` 到 `FileManager.temporaryDirectory`（文件名非法字符替换为 `_`），`onProgress` 驱动百分比与 `ProgressView`，完成后 `ShareSheet.present` 交由用户保存，`finally` 中无条件清理临时文件。
- [x] **删除工作流运行**：`deleteWorkflowRun`（DELETE `/actions/runs/{id}`）；`ActionsPage` 行左滑删除，`Dialog.actionSheet`（`cancelButton: false`，索引 0 为取消、1 为删除，严格判 `result !== 1` 直接返回）确认后本地过滤该行并 toast。

### 10.10 最新验证（2026-08-18 复核）

- 全项目 TypeScript 诊断：通过，0 个错误（2026-08-18 复测）。
- 源文件规模：110 个（不含 `vendor/`）；`pages` 20、`components` 20、`services/git` 14、`tests` 15。
- 下列测试为对应变更轮次的记录，尚未在 2026-08-18 统一重跑：
  - `tests/reliability.test.ts`、`history`、`compare`、`inlineDiff`、`status-perf-helpers`、`widget`、`github`、`mergeCompletion`、`repoSort`：通过。
  - `tests/performance.test.ts`、`statusFreshness`、`singleFlight`、`commitTreeDiff`：通过（P2.46–P2.49 各轮）。
  - `tests/actionsLog.test.ts`、`logLevel.test.ts`：通过（P2.55–P2.60 各轮）。
- `scripting-ts project "gitgit"`：2026-08-05 运行成功，之后未重新执行入口冒烟。
- 已知结构债：`pages/RepoDetailPage.tsx` 现为 1174 行（08-04 拆分后曾降至 971），已超过 800 行拆分阈值，建议下一轮把 Actions 与 GitHub 相关的导航与状态编排继续外移。`pages/ActionRunDetailPage.tsx` 550 行、`api/githubApi.ts` 711 行、`components/ActionLogViewer.tsx` 330 行，均在审查区间内。

### 10.11 当前剩余项

- [ ] Tag 创建、查看和删除。
- [ ] 仓库健康检查：HEAD、index、objects、config 与工作区访问性。
- [ ] 结构债：`pages/RepoDetailPage.tsx` 已回升至 1174 行，需再次拆分（详见 10.10）。
- [x] Actions 重新运行：rerun workflow 与 rerun failed jobs（P2.63）。
- [ ] （可选）回滚强推的服务层集成测试：当前仅有工作区干净校验与取消路径的人工验证，未覆盖 reset+force push 的自动化用例。
- [ ] （可选）iCloud 协调失败与 index 一致性故障注入。
- [ ] 第四阶段以后：富通知（自定义 UI 通知，区别于 P2.54 已完成的失败通知）、多仓库批量同步、更完整 GitHub 仓库管理面。

已从剩余项移出（已完成）：

- [x] Widget 状态面板（P2.36）。
- [x] GitHub Issues / Pull Requests（P2.38）。
- [x] 回滚到指定提交并强制推送（P2.44）。
- [x] 仓库列表排序（P2.45 按名称、P2.48 待处理优先）。
- [x] GitHub Actions CI/CD 浏览：运行列表、Job 与步骤分段日志、注解、工件下载、手动触发与删除运行（P2.52–P2.62）。
- [x] 失败通知与 Toast 轻量反馈（P2.54）。
