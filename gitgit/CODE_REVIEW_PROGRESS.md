# gitgit 代码审查、修复与优化进度

> 记录时间：2026-07-18（第三阶段清单更新：2026-07-19）  
> 项目：`scripts/gitgit`  
> 当前阶段：第三阶段进行中 — M1–M6 已完成；下一步可选 M7（3.3/3.4）

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
11. 已建立最小自动化测试入口；历史拓扑、上传失败恢复和并发写操作仍需扩展测试覆盖。

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

结构说明：`services/gitService.ts` 当前约 1378 行，超过结构审查阈值。该文件集中承载分离式 gitdir、仓库级互斥、Git 引擎调用和失败恢复事务；本阶段继续拆分会扩大高风险 Git 路径的回归面，因此暂作为强内聚例外保留。后续应在补齐拓扑、上传和并发测试后渐进拆分。

## 六、第三阶段：扩展测试 + 第一梯队本地 Git 能力（进行中）

目标：在第二阶段可靠性底座上，先补齐高价值自动化测试，再落地本地日常 Git 能力；完成后再考虑 `gitService` 渐进拆分与更后梯队功能。

### 实施原则（沿用）

1. 先测试债，再功能增量；功能按 3.2 → 3.3 顺序推进。
2. 每项 Git 写操作必须接入 `runRepoMutation()`，具备明确错误传播与统一快照刷新。
3. 新增服务逻辑优先配套最小可验证测试；不把 TypeScript 通过当作运行时正确性证明。
4. `gitService.ts` / 详情页在 3.1 与核心写路径稳定前不大拆；3.4 再渐进拆分。
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

- [ ] 分支删除、重命名和远端分支管理。
- [ ] Tag 创建、查看和删除。
- [x] 提交详情页，包括文件级变更列表和相对第一父提交的单文件 Diff。（已完成，见第九节）
- [x] 历史搜索与分页加载。
  - `utils/history.ts` 提供大小写不敏感的标题、描述、作者、邮箱和 OID 匹配，以及分页边界处理。
  - `getLogPage()` 保持 `getLog()` 兼容，历史页支持搜索、结果计数和加载更多。
  - 测试：`tests/history.test.ts`，并纳入 `tests/reliability.test.ts`。
- [ ] 仓库健康检查，包括 HEAD、index、objects、config 和工作区访问性。

### 3.4 结构债（测试与写路径稳定后）

- [ ] 在拓扑 / 上传 / 并发测试补齐后，渐进拆分 `services/gitService.ts`（约 1378 行）。
- [ ] 视功能增量评估拆分 `RepoDetailPage` 及相关 Tab，避免一次大重构。

### 明确不纳入第三阶段主线（第四阶段及以后）

- [ ] GitHub Issues 和 Pull Requests。
- [ ] GitHub 仓库列表、创建、删除和远端绑定管理（超出当前上传闭环的管理面）。
- [ ] Widget 交互操作。
- [ ] 富通知和同步进度通知（`notification.tsx` 等）。
- [ ] 多仓库批量同步。

### 第三阶段建议里程碑

| 里程碑 | 内容 | 退出条件 |
|---|---|---|
| M1 | 3.1 拓扑 + 上传恢复 + 并发测试 | 已完成：自动化用例通过 |
| M2 | 全部暂存/取消暂存 | 已完成：服务 + UI + 测试/诊断/冒烟通过 |
| M3 | Stash 闭环 | 已完成：创建/查看/应用/删除可用，测试/诊断/冒烟通过 |
| M4 | Remote/upstream 管理 | 已完成：服务 + UI + 测试/诊断通过 |
| M5 | 冲突展示/解决/Abort | 已完成：服务 + UI + 测试/诊断通过 |
| M6 | 远程操作进度与取消 | 已完成：进度可见、取消可重试（测试/诊断通过） |
| M7（可选） | 3.3 子集或 3.4 拆分 | 按需，不阻塞 M1–M6 |

## 七、后续实施原则

1. 先处理数据安全和失败恢复，再扩展功能。
2. 每项 Git 写操作都必须具备明确的互斥、错误传播和状态刷新语义。
3. 不把 TypeScript 通过当作运行时正确性的证明。
4. 新增功能优先配套最小可验证测试。
5. `gitService.ts` 和 `RepoDetailPage.tsx` 已较大，完成安全修复和测试后再渐进拆分，避免在高风险路径未稳定前进行大规模重构。
6. 所有必要代码注释使用中文，并保持 UI 的明暗模式可读性。

## 八、当前状态摘要

| 类别 | 状态 |
|---|---|
| 全量代码审查 | 已完成 |
| 第一阶段数据安全修复 | 已完成 |
| 第二阶段可靠性与失败恢复 | 已完成 |
| TypeScript 诊断 | 已通过，0 个错误 |
| 项目入口运行验证 | 已通过 |
| 最小自动化测试 | 已建立并通过 |
| Clone 失败恢复 | 已完成 |
| GitHub 上传失败恢复 | 已完成 |
| Diff 与历史拓扑优化 | 已完成 |
| 扩展自动化覆盖 | 第三阶段 3.1 已完成（拓扑/上传恢复/并发）；iCloud 故障注入仍可选 |
| M2 全部暂存/取消暂存 | 已完成 |
| M3 Stash 闭环 | 已完成 |
| M4 Remote/upstream 管理 | 已完成 |
| M5 冲突展示/解决/Abort | 已完成 |
| 第三阶段主线 | M1–M6 完成；Pull 读 Upstream + 合并到当前已完成；历史搜索与分页已完成；下一步可选 M7 |
| 新增功能 | 文件列表与提交详情、合并到当前、远程进度与取消已完成 |
| 后阶段功能 | Issues/PR、交互 Widget、富通知、批量同步等不纳入第三阶段 |

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
