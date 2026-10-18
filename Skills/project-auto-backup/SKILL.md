---
name: project-auto-backup
description: Back up the current project right before each batch of edits — the backup is the rollback point for that change. Supports a description for folder names like my-app_修改设置页_前_20260603_101441, plus an optional post-edit milestone snapshot via phase=after.
runtime: python
entry: scripts/backup.py
metadata:
  display_name: "Project Auto Backup"
  intent_patterns: "backup before agent execution, project backup, pre-edit backup, backup before each batch of edits, auto backup current project, post-change snapshot"
  required_tools: "run_shell_command"
---

# Purpose

Create a full copy of the current project **immediately before each batch of edits**, so a bad change can always be rolled back. Call it at the start of every editing batch — not once per task.

# Why before the edit, not after

A backup earns its keep only as a **rollback point**, and that can only be captured before the change:

- A backup taken after the edit holds the new, possibly already broken state — useless for the very failure it is meant to undo. If the first change of a project breaks it, an after-only scheme leaves nothing usable behind.
- The newest version always exists at the project path itself, so "keeping the backup up to date" is not a goal — backups exist to preserve older states.
- Chained pre-edit backups already give "latest known-good state" for free: the backup taken before change N equals the project state right after change N-1.

The one real way to lose a version is backing up **only once at the start of a task** while making several rounds of edits, because the intermediate good states get skipped. Hence: one backup before *every* editing batch.

`phase=after` exists only for deliberate milestone snapshots (e.g. archiving a verified working state). It is never the default and never a substitute for the pre-edit backup.

# Backup Naming

The subfolder name embeds which side of the change the snapshot belongs to:

- **With description, pre-edit (default):** `<project_name>_<description>_前_<YYYYMMDD_HHMMSS>`
- **With description, post-edit:** `<project_name>_<description>_后_<YYYYMMDD_HHMMSS>`
- **Without description, pre-edit:** `<project_name>_改动前_<YYYYMMDD_HHMMSS>`
- **Without description, post-edit:** `<project_name>_改动后_<YYYYMMDD_HHMMSS>`

Examples:
```
my-app_修改设置页_前_20260603_101441
my-app_重构日历组件样式_后_20260603_142030
my-app_改动前_20260603_101441
```

The `description` parameter is a brief summary of the change about to be made, e.g. "修改设置页", "重构日历组件样式", "添加用户登录功能"; infer it from the user's request when possible. The `前` / `后` segment states whether the folder holds the state **before** or **after** that change — never drop it, and remember that restoring from a `_前_` folder is how a bad change gets undone.

# Backup Layout

By default backups are written to:

```text
/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup/<project_name>/<project_name>_<description>_前_<YYYYMMDD_HHMMSS>/
```

# Instructions

1. Before each batch of project changes, execute the script with `run_shell_command`.
2. Pass the current project path as JSON when available:

```bash
python3 "<skill_dir>/scripts/backup.py" '{"project_path":"/absolute/path/to/project","description":"修改设置页"}'
```

3. The `description` parameter is optional but recommended. It should briefly describe the changes about to be made (e.g. "修改设置页", "重构日历组件"). When provided, it becomes part of the backup folder name.
4. Do not pass `phase` for normal use — the default `before` is the correct one. Use `"phase":"after"` only when a snapshot of a completed, verified state is explicitly wanted.
5. If no JSON argument is passed, the script backs up the current working directory.
6. The script returns JSON containing `projectName`, `description`, `phase`, `source`, `destination`, `filesCopied`, and `bytesCopied`.
7. If the backup fails, stop and surface the error before continuing with project edits. An invalid `phase` exits with code 1.

# Optional Parameters

- `project_path`: Absolute or relative path to the project. Defaults to current working directory.
- `project_name`: Override the folder/name prefix. Defaults to the project directory basename.
- `description`: Brief summary of the changes about to be made. Included in the backup folder name. Example: "修改设置页", "重构日历组件样式".
- `phase`: `"before"` (default) or `"after"`. Which side of the change this snapshot belongs to. Keep the default for the rollback point; `"after"` is only for milestone archiving.
- `backup_root`: Override the root backup directory.
- `include_hidden`: Boolean. Defaults to `true`.
- `exclude`: Array of extra relative path names or glob patterns to skip.

# Default Exclusions

The script skips common generated or very large folders by default: `node_modules`, `.next`, `dist`, `build`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.turbo`, `.cache`, `.git`, and the destination backup directory itself when relevant.

# Related Skills

- **project-code-cleanup**: After completing code changes, use this skill to clean up formatting, remove unused code, and normalize comments to Chinese.
- **project-file-organization**: When creating new files or reorganizing project structure, follow the file organization conventions. Use its `check.py` script to verify the project structure.
