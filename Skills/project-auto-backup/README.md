# Project Auto Backup 使用说明

`project-auto-backup` 是一个给 Scripting Agent 使用的项目自动备份 skill。它的用途是在 agent 修改、生成或重构项目文件**之前**，把当前项目完整复制一份，作为这次改动的回滚点。

## 为什么是「改动前」而不是「改动后」

备份的价值只有一个：**能在改坏时回滚**。而回滚点只能在改动前取：

- 改完再备份，备份里装的就是刚改完、可能已经坏掉的那份，正好在最需要它的场景下失效；如果项目第一次改动就改坏，会一个可用版本都没有。
- 「最新的版本」永远在项目目录自己身上。备份存在的意义是保存旧状态，所以「让备份保持最新」不是目标。
- 只要每轮改动前都备份，链式备份天然给出了「最近一次已知良好状态」：改 N 之前的那份备份，就是改完 N-1 之后的状态。

真正会丢版本的漏洞是**一次任务里连改多轮却只在开头备份一次**——中间的成功状态会被跳过。所以要记住：**每一批改动前各备份一次**，而不是一次任务只备份一次。

`phase=after` 只用于有意的里程碑存档（比如把已验证可用的状态单独存一份），它不是默认值，也不能替代改动前的备份。

## 备份位置

默认备份到 iCloud 云盘：

```text
iCloud云盘/Scripting/backup/<项目名>/<项目名>_<修改内容>_前_<日期时间>/
```

在系统中的实际路径是：

```text
/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup/<项目名>/
```

文件夹命名规则：

- **有描述、改动前（默认）**：`项目名_描述_前_日期_时间`
- **有描述、改动后**：`项目名_描述_后_日期_时间`
- **无描述、改动前**：`项目名_改动前_日期_时间`
- **无描述、改动后**：`项目名_改动后_日期_时间`

示例：

```text
iCloud云盘/Scripting/backup/my-app/my-app_修改设置页_前_20260603_101441
iCloud云盘/Scripting/backup/my-app/my-app_重构日历组件样式_后_20260603_142030
iCloud云盘/Scripting/backup/my-app/my-app_改动前_20260603_101441
```

描述应简要说明本次修改内容，由 agent 根据用户请求自动生成。`前` / `后` 标记这份快照是那次改动的**之前**还是**之后**的状态，不能省略——从 `_前_` 的文件夹恢复，就是把那次改坏的操作撤销掉。

## 什么时候使用

在以下操作**之前**使用（同一任务里每批改动各做一次）：

- 让 agent 修改项目代码
- 让 agent 生成新文件
- 让 agent 重构目录或批量替换内容
- 让 agent 调整配置、脚本、依赖文件
- 任何你希望保留修改前版本的场景

## 基本使用方法

通过 `run_shell_command` 执行：

```bash
python3 "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/project-auto-backup/scripts/backup.py" '{"project_path":"/你的项目绝对路径","description":"修改设置页"}'
```

如果当前工作目录就是项目目录，也可以不传参数：

```bash
python3 "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/project-auto-backup/scripts/backup.py"
```

### 最简用法（无描述）

```bash
python3 ".../backup.py" '{"project_path":"/path/to/project"}'
```

结果文件夹：`my-app_改动前_20260603_101441`

### 带描述用法（推荐）

```bash
python3 ".../backup.py" '{"project_path":"/path/to/project","description":"修改设置页"}'
```

结果文件夹：`my-app_修改设置页_前_20260603_101441`

### 里程碑存档（可选）

改动完成、确认可用、想单独留一份存档时：

```bash
python3 ".../backup.py" '{"project_path":"/path/to/project","description":"修改设置页","phase":"after"}'
```

结果文件夹：`my-app_修改设置页_后_20260603_101441`

日常使用不要传 `phase`，默认的 `before` 才是回滚点；`phase` 传其他字符串会报错并以退出码 1 结束。

## 返回结果

执行成功后会返回 JSON，例如：

```json
{
  "ok": true,
  "projectName": "my-app",
  "description": "修改设置页",
  "phase": "before",
  "source": "/path/to/my-app",
  "destination": "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup/my-app/my-app_修改设置页_前_20260603_101441",
  "filesCopied": 42,
  "bytesCopied": 128000,
  "timestamp": "20260603_101441"
}
```

字段说明：

- `ok`: 是否成功
- `projectName`: 项目名称
- `description`: 修改内容描述（无描述时为 null）
- `phase`: `before` 或 `after`，这份快照是改动前还是改动后
- `source`: 原项目路径
- `destination`: 本次备份保存位置
- `filesCopied`: 复制的文件数量
- `bytesCopied`: 复制的总字节数
- `timestamp`: 本次备份使用的时间戳

## 可选参数

可以通过 JSON 参数控制备份行为：

```bash
python3 ".../backup.py" '{
  "project_path":"/path/to/project",
  "description":"修改设置页",
  "phase":"before",
  "project_name":"custom-name",
  "backup_root":"/path/to/backup-root",
  "include_hidden":true,
  "exclude":["*.log","tmp","large-folder"]
}'
```

参数说明：

- `project_path`: 要备份的项目路径。默认是当前工作目录。
- `description`: 本次修改内容的简要描述，会包含在备份文件夹名中。例如 "修改设置页"、"重构日历组件样式"、"添加用户登录功能"。支持中文。
- `phase`: `"before"`（默认）或 `"after"`，表示这份快照是这次改动的之前还是之后。日常保持默认。
- `project_name`: 自定义项目名。默认使用项目文件夹名称。
- `backup_root`: 自定义备份根目录。默认是 iCloud 云盘的 `Scripting/backup`。
- `include_hidden`: 是否包含隐藏文件。默认 `true`。
- `exclude`: 额外排除的文件夹名、文件名或 glob 模式。

## 默认会跳过的内容

为了避免备份太大，脚本默认跳过这些常见生成目录：

```text
node_modules
.next
dist
build
.venv
venv
__pycache__
.pytest_cache
.turbo
.cache
.git
```

如果备份目标目录刚好位于项目内部，脚本也会自动跳过备份目录本身，避免递归复制。

## 恢复备份

需要恢复时，打开：

```text
iCloud云盘/Scripting/backup/<项目名>/
```

按时间找到对应备份文件夹。恢复「回到某次改动之前」用 `_前_` 的那份，例如：

```text
my-app_修改设置页_前_20260603_101441
```

然后把里面的文件复制回原项目目录即可。

## Agent 使用约定

agent 在每一批项目改动之前，都应先调用这个 skill：

1. 先备份当前项目（每批改动前各一次，不能整轮任务只在开头备份一次）。
2. 确认备份成功，记下返回的 `destination`。
3. 再开始编辑、生成或重构文件。
4. 如果备份失败，应先告诉用户错误原因，不继续修改项目。
5. 除用户明确要求里程碑存档外，不要传 `phase`。

## 与其他 Skill 的关系

- **project-code-cleanup**：代码修改完成后，使用清理 skill 做收尾工作——格式化代码、删除未使用代码、将注释统一改为中文。
- **project-file-organization**：创建新文件或整理项目结构时，应遵循文件摆放规范 skill 定义的目录结构和命名约定。
