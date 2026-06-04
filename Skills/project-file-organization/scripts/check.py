#!/usr/bin/env python3
"""Check a Scripting project's file organization against conventions."""

import json
import os
import sys
from pathlib import Path

# 标准目录及其用途描述
STANDARD_DIRS = {
    "components": "可复用 UI 组件",
    "pages": "页面/屏幕级组件",
    "utils": "工具函数",
    "hooks": "自定义 Hooks",
    "constants": "常量定义",
    "types": "类型定义",
    "api": "接口请求/数据获取",
    "services": "业务逻辑服务",
    "contexts": "React Context 状态管理",
    "modules": "功能模块（按业务划分）",
    "assets": "静态资源",
    "polyfill": "兼容性补丁",
    "screens": "页面/屏幕级组件（别名）",
    "page": "页面/屏幕级组件（别名）",
    "util": "工具函数（别名）",
    "lib": "第三方库封装",
    "helpers": "辅助函数（别名）",
    "models": "数据模型",
    "store": "状态管理",
}

# 必需入口文件
REQUIRED_ENTRIES = ["index.tsx"]

# 可选入口文件
OPTIONAL_ENTRIES = ["intent.tsx", "widget.tsx", "ui.tsx"]

# 可接受的入口文件扩展名（不检查命名规范）
ENTRY_FILENAMES = {
    "index.tsx", "index.ts", "index.js",
    "intent.tsx", "intent.ts", "intent.js",
    "widget.tsx", "widget.ts", "widget.js",
    "ui.tsx", "ui.ts", "ui.js",
    "script.json", "package.json", "tsconfig.json",
    ".DS_Store",
}


def is_pascal_case(name: str) -> bool:
    """检查文件名是否为 PascalCase（首字母大写）。"""
    if not name or not name[0].isupper():
        return False
    # 允许 MyComponent、MyComponent.test 等
    stem = name.split(".")[0]
    return len(stem) > 0 and stem[0].isupper()


def is_camel_case(name: str) -> bool:
    """检查文件名是否为 camelCase（首字母小写）。"""
    if not name or not name[0].islower():
        return False
    stem = name.split(".")[0]
    return len(stem) > 0 and stem[0].islower()


def is_snake_case(name: str) -> bool:
    """检查文件名是否为 snake_case。"""
    stem = name.split(".")[0]
    return "_" in stem and stem == stem.lower()


def check_project(project_path: str) -> dict:
    """扫描项目目录并返回检查结果。"""
    root = Path(project_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        return {"ok": False, "error": f"路径不存在或不是目录: {root}"}

    result = {
        "ok": True,
        "project": str(root),
        "projectName": root.name,
        "required": {},       # 必需文件检查
        "optional": {},       # 可选文件检查
        "directories": {},    # 已存在的标准目录
        "topLevelFiles": [],  # 顶层文件
        "warnings": [],       # 警告
        "suggestions": [],    # 建议
    }

    # 检查必需入口文件
    for name in REQUIRED_ENTRIES:
        exists = (root / name).exists()
        result["required"][name] = exists
        if not exists:
            result["warnings"].append(f"缺少必需文件: {name}")

    # 检查可选入口文件
    for name in OPTIONAL_ENTRIES:
        result["optional"][name] = (root / name).exists()

    # 扫描顶层内容
    has_tsx_files = False
    top_files = []
    top_dirs = []
    file_line_counts = {}  # 文件名 -> 行数

    for item in sorted(root.iterdir()):
        if item.name.startswith(".") and item.name != ".DS_Store":
            continue
        if item.is_file():
            top_files.append(item.name)
            if item.suffix in (".tsx", ".ts"):
                has_tsx_files = True
                try:
                    with open(item, "r", encoding="utf-8") as f:
                        file_line_counts[item.name] = sum(1 for _ in f)
                except Exception:
                    pass
        elif item.is_dir():
            top_dirs.append(item.name)

    result["topLevelFiles"] = top_files
    result["topLevelDirs"] = top_dirs

    # 检查目录结构
    for dirname in top_dirs:
        if dirname in STANDARD_DIRS:
            dir_path = root / dirname
            file_count = sum(1 for _ in dir_path.rglob("*") if _.is_file())
            result["directories"][dirname] = {
                "description": STANDARD_DIRS[dirname],
                "fileCount": file_count,
            }
        else:
            result["warnings"].append(f"非标准目录: {dirname}/")

    # 检查顶层文件命名
    for fname in top_files:
        if fname in ENTRY_FILENAMES:
            continue
        if fname.endswith(".tsx") or fname.endswith(".ts"):
            stem = fname.rsplit(".", 1)[0]
            if fname.endswith(".tsx"):
                # TSX 文件通常是组件，应用 PascalCase
                if not is_pascal_case(stem) and not is_snake_case(stem):
                    result["suggestions"].append(
                        f"顶层 TSX 文件 '{fname}' 建议使用 PascalCase 命名（如 {stem[0].upper()}{stem[1:]}.tsx）"
                    )
            elif fname.endswith(".ts"):
                # TS 文件通常是工具/常量，应用 camelCase 或 snake_case
                if not is_camel_case(stem) and not is_snake_case(stem) and not is_pascal_case(stem):
                    result["suggestions"].append(
                        f"顶层 TS 文件 '{fname}' 建议使用 camelCase 命名"
                    )

    # 项目规模建议
    total_files = sum(1 for _ in root.rglob("*") if _.is_file() and not any(
        p.startswith(".") for p in _.relative_to(root).parts
    ))

    if total_files >= 10 and "components" not in top_dirs and has_tsx_files:
        result["suggestions"].append(
            "项目已有较多文件，建议将可复用组件拆分到 components/ 目录"
        )
    if total_files >= 10 and "utils" not in top_dirs:
        result["suggestions"].append(
            "项目已有较多文件，建议将工具函数拆分到 utils/ 目录"
        )
    if total_files >= 15 and "pages" not in top_dirs and "screens" not in top_dirs:
        result["suggestions"].append(
            "项目已有较多文件，建议将页面组件拆分到 pages/ 目录"
        )

    # 检查单文件行数：超过阈值触发结构审查
    LINE_THRESHOLD = 200
    oversized_files = []
    for fname, lines in sorted(file_line_counts.items(), key=lambda x: -x[1]):
        if lines >= LINE_THRESHOLD:
            oversized_files.append({"file": fname, "lines": lines})
            if lines >= 800:
                result["suggestions"].append(
                    f"文件 '{fname}' 有 {lines} 行，已超过 800 行：几乎肯定需要按 types/utils/services/components/pages 等职责拆分；仅生成式数据、config 或极少数强内聚声明文件可例外并说明原因"
                )
            elif lines >= 500:
                result["suggestions"].append(
                    f"文件 '{fname}' 有 {lines} 行，已超过 500 行：除非有强内聚或行为风险理由，否则基本应拆分"
                )
            elif lines >= 300:
                result["suggestions"].append(
                    f"文件 '{fname}' 有 {lines} 行，已达到结构审查线：若混合 types/utils/services/components/pages 等职责，请按边界拆分；若仍是内聚页面、配置、schema 或声明式 UI，可保留并说明原因"
                )
            elif lines >= LINE_THRESHOLD:
                result["suggestions"].append(
                    f"文件 '{fname}' 有 {lines} 行，可考虑按职责拆分（types/utils/components/pages）"
                )

    result["totalFiles"] = total_files
    result["totalDirs"] = len(top_dirs)
    result["fileLineCounts"] = file_line_counts
    if oversized_files:
        result["oversizedFiles"] = oversized_files

    return result


def main() -> int:
    try:
        params = {}
        if len(sys.argv) >= 2 and sys.argv[1].strip():
            params = json.loads(sys.argv[1])

        project_path = params.get("project_path") or os.getcwd()
        result = check_project(project_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok") else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
