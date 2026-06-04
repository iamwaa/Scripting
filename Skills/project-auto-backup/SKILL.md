---
name: project-auto-backup
description: Back up the current project before an agent starts modifying it. Supports a description parameter for meaningful folder names like my-app_修改设置页_20260603_101441.
runtime: python
entry: scripts/backup.py
metadata:
  display_name: "Project Auto Backup"
  intent_patterns: "backup before agent execution, project backup, pre-edit backup, auto backup current project"
  required_tools: "run_shell_command"
---

# Purpose

Use this skill at the start of an agent task, before editing or generating files in the current project. It creates a backup folder named after the project, then stores a full copy in a timestamped subfolder.

# Backup Naming

The backup subfolder name format is:

- **With description:** `<project_name>_<description>_<YYYYMMDD_HHMMSS>`
- **Without description:** `<project_name>_<YYYYMMDD_HHMMSS>`

Examples:
```
my-app_修改设置页_20260603_101441
my-app_重构日历组件样式_20260603_142030
my-app_20260603_101441
```

The `description` parameter should be a brief summary of the changes about to be made, e.g. "修改设置页", "重构日历组件样式", "添加用户登录功能". The agent should infer it from the user's request when possible.

# Backup Layout

By default backups are written to:

```text
/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup/<project_name>/<project_name>_<description>_<YYYYMMDD_HHMMSS>/
```

# Instructions

1. Before making project changes, execute the script with `run_shell_command`.
2. Pass the current project path as JSON when available:

```bash
python3 "<skill_dir>/scripts/backup.py" '{"project_path":"/absolute/path/to/project","description":"修改设置页"}'
```

3. The `description` parameter is optional but recommended. It should briefly describe the changes about to be made (e.g. "修改设置页", "重构日历组件"). When provided, it becomes part of the backup folder name.
4. If no JSON argument is passed, the script backs up the current working directory.
5. The script returns JSON containing `projectName`, `description`, `source`, `destination`, `filesCopied`, and `bytesCopied`.
6. If the backup fails, stop and surface the error before continuing with project edits.

# Optional Parameters

- `project_path`: Absolute or relative path to the project. Defaults to current working directory.
- `project_name`: Override the folder/name prefix. Defaults to the project directory basename.
- `description`: Brief summary of the changes about to be made. Included in the backup folder name. Example: "修改设置页", "重构日历组件样式".
- `backup_root`: Override the root backup directory.
- `include_hidden`: Boolean. Defaults to `true`.
- `exclude`: Array of extra relative path names or glob patterns to skip.

# Default Exclusions

The script skips common generated or very large folders by default: `node_modules`, `.next`, `dist`, `build`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.turbo`, `.cache`, `.git`, and the destination backup directory itself when relevant.

# Related Skills

- **project-code-cleanup**: After completing code changes, use this skill to clean up formatting, remove unused code, and normalize comments to Chinese.
- **project-file-organization**: When creating new files or reorganizing project structure, follow the file organization conventions. Use its `check.py` script to verify the project structure.
