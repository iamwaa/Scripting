#!/usr/bin/env python3
import fnmatch
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path


DEFAULT_BACKUP_ROOT = Path(
    "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/backup"
)

DEFAULT_EXCLUDES = {
    "node_modules",
    ".next",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".turbo",
    ".cache",
    ".git",
}


def load_params() -> dict:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        return {}
    try:
        return json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"First argument must be JSON: {exc}") from exc


def safe_name(name: str) -> str:
    """Sanitize a name for use as a folder name.

    Keeps Unicode letters/digits (including CJK), hyphens, underscores,
    and dots. Everything else becomes underscore. Strips leading/trailing
    dots and underscores to avoid hidden or empty names.
    """
    cleaned = []
    for char in name.strip():
        if char.isalnum() or char in ("-", "_", ".") or ("\u4e00" <= char <= "\u9fff"):
            cleaned.append(char)
        else:
            cleaned.append("_")
    result = "".join(cleaned).strip("._")
    return result


def should_skip(path: Path, rel_path: str, excludes: set[str], patterns: list[str], include_hidden: bool, destination: Path) -> bool:
    if path == destination or destination in path.parents:
        return True

    parts = path.parts
    if any(part in excludes for part in parts):
        return True

    if not include_hidden and any(part.startswith(".") for part in rel_path.split(os.sep) if part):
        return True

    return any(fnmatch.fnmatch(rel_path, pattern) or fnmatch.fnmatch(path.name, pattern) for pattern in patterns)


def copy_project(source: Path, destination: Path, excludes: set[str], patterns: list[str], include_hidden: bool) -> tuple[int, int]:
    files_copied = 0
    bytes_copied = 0

    destination.mkdir(parents=True, exist_ok=False)

    for root, dirs, files in os.walk(source):
        root_path = Path(root)
        rel_root = os.path.relpath(root_path, source)
        if rel_root == ".":
            rel_root = ""

        kept_dirs = []
        for dirname in dirs:
            dir_path = root_path / dirname
            rel_dir = os.path.normpath(os.path.join(rel_root, dirname))
            if not should_skip(dir_path, rel_dir, excludes, patterns, include_hidden, destination):
                kept_dirs.append(dirname)
        dirs[:] = kept_dirs

        target_root = destination / rel_root if rel_root else destination
        target_root.mkdir(parents=True, exist_ok=True)

        for filename in files:
            file_path = root_path / filename
            rel_file = os.path.normpath(os.path.join(rel_root, filename))
            if should_skip(file_path, rel_file, excludes, patterns, include_hidden, destination):
                continue

            target_file = destination / rel_file
            target_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file_path, target_file)
            files_copied += 1
            bytes_copied += target_file.stat().st_size

    return files_copied, bytes_copied


def main() -> int:
    try:
        params = load_params()
        source = Path(params.get("project_path") or os.getcwd()).expanduser().resolve()
        if not source.exists() or not source.is_dir():
            raise FileNotFoundError(f"Project path is not a directory: {source}")

        project_name = safe_name(params.get("project_name") or source.name) or "project"
        description = safe_name(params.get("description", "") or "")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_root = Path(params.get("backup_root") or DEFAULT_BACKUP_ROOT).expanduser().resolve()

        if description:
            folder_name = f"{project_name}_{description}_{timestamp}"
        else:
            folder_name = f"{project_name}_{timestamp}"
        destination = backup_root / project_name / folder_name

        include_hidden = bool(params.get("include_hidden", True))
        extra_excludes = params.get("exclude") or []
        if not isinstance(extra_excludes, list):
            raise ValueError("exclude must be an array of names or glob patterns")

        excludes = set(DEFAULT_EXCLUDES)
        patterns = []
        for item in extra_excludes:
            text = str(item)
            if any(marker in text for marker in ("*", "?", "[")):
                patterns.append(text)
            else:
                excludes.add(text)

        files_copied, bytes_copied = copy_project(source, destination, excludes, patterns, include_hidden)
        print(json.dumps({
            "ok": True,
            "projectName": project_name,
            "description": description or None,
            "source": str(source),
            "destination": str(destination),
            "filesCopied": files_copied,
            "bytesCopied": bytes_copied,
            "timestamp": timestamp,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
