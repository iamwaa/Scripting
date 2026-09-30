# PROJECT_MEMORY — TG广告正则生成器

从多条 Telegram 广告推文提取关键文字，生成用于过滤广告的正则。

## 架构

- `index.tsx`：入口，present `RootView` 后 `Script.exit()`。
- `src/types.ts`：`AdGroup` / `AdItem` / `GenOptions` / `GenResult`；`defaultOptions()`；`normalizeGroup()` 兼容旧存档补齐新字段。
- `src/store.ts`：持久化到 `Path.join(Path.dirname(Path.dirname(Script.directory)), 'configs')/tg-ad-regex.json`（实际 = Documents/configs/）。`Path`/`Script` 从 `"scripting"` import；`FileManager`/`Clipboard`/`Dialog`/`Pasteboard` 是全局命名空间，不能 import（import 会报 no exported member）。
- `src/regex.ts`：核心算法 `generateRegex(ads, opt, customKeywords, excludeKeywords)` + `testRegex(regexStr, message)`。
- `src/pages/`：`RootView`（库列表，含关闭按钮）、`GroupDetailPage`（广告管理+选项+关键词精修+生成+测试）、`AdEditorPage`（多行编辑，`presentAdEditor` 以独立页返回文本）。
- `src/components/FormRow.tsx`：表单输入行（全局记忆的标准实现）。

## 算法要点与已踩的坑

- **n-gram 合并 bug（已修）**：`extractCandidates` 对连续汉字段生成 n-gram，早期把上限写死 `MAX_CJK_LEN=12`，长于 12 字的重复整句（如「网站购买证书签名安装使用教程视频」16 字）生成不出来，只剩一堆彼此错位的 12 字滑窗，且互不为子串，去重（`includes`）删不掉 → 正则里塞满近重复碎片。修法两步：① 上限取 `min(run.length, 40)`（连续汉字段本就短，emoji/标点会断段）；② 去重改为纯子串包含（按长度降序，被已保留的更长词包含就丢），不再要求 df 相等。这样最长整句会被生成并吸收掉所有子片段。
- **误伤根因**：`minDocFreq` 越大，只有各广告都共有的**最通用词**存活（如 netflix/chatgpt/的网络），恰恰最易误伤正常消息。解法不是硬编码停用词（那些词也常是广告信号），而是给用户**排除关键词**（`excludeKeywords`，含子串即剔除，不区分大小写）。
- **漏匹配根因**：同组广告差异大时共有词很少；且严格匹配遇到「三💗角❤️洲」这种字间插 emoji/空格的会漏。解法：**自定义关键词**（`customKeywords`，始终纳入）+ **宽松匹配**（`looseMatch`，字符间插 `LOOSE_SEP*`，含空格/零宽/emoji 代理区 `\ud800-\udfff`/箭头符号区/常见标点；默认关。
- **忽略大小写**：`caseInsensitive` 默认 true，输出正则前缀 `(?i)`（JS RegExp 不认 `(?i)`，`testRegex` 会剥掉前缀并改用 `i` flag 近似）。目标过滤引擎需支持 `(?i)` 内联标志。
- 单条广告时 `minDocFreq` 自动按 1 处理，否则永远取不到词。
- 英文 token 已小写化并过滤 `LATIN_STOP`（https/http/www/com/cn/net/org），域名/@用户名单独提取。

## 命令

- 类型检查：`get_typescript_diagnostics script_name="TG广告正则生成器"`。
- 用真实存档验证算法：写项目内临时 `__test.tsx`（`import "./src/regex"` + `FileManager.readAsStringSync(configs 路径)`），`scripting-ts run <绝对路径>`，测完删除。注意 `scripting-ts run` 读不到项目 Storage 域，但能用绝对路径读 configs JSON。
