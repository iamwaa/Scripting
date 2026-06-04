---
name: project-code-cleanup
description: After an agent modifies code, clean up formatting, comments, unused code, imports, and obvious lint issues while preserving behavior. All necessary comments must use Chinese (// 中文注释).
metadata:
  display_name: "Project Code Cleanup"
  intent_patterns: "after code changes, cleanup code, format code, remove unused code, tidy comments, lint cleanup, refactor comments, project cleanup"
  required_tools: "file_tool, run_shell_command, get_typescript_diagnostics, get_python_diagnostics"
---

# Purpose

Use this skill after making code changes and before giving the final answer. It guides the agent through a focused cleanup pass: formatting code, normalizing necessary comments, removing unnecessary comments, deleting unused code, and checking for obvious diagnostics without changing intended behavior.

# When To Use

Use this skill when:

- The agent has created, edited, or refactored source code.
- The user asks to format code, clean code, remove unused code, or simplify comments.
- A previous change likely left stale imports, dead variables, redundant helpers, outdated comments, or inconsistent formatting.

Skip this skill when:

- The task was read-only, such as explaining code or reviewing a diff.
- The user explicitly asks not to change code.
- The repository has generated, vendored, minified, or lock files only, unless the user specifically asks to touch them.

# Cleanup Rules

1. Preserve behavior first.
   - Do not redesign architecture during cleanup.
   - Do not rename public APIs, files, exported symbols, database fields, routes, or user-facing strings unless the user requested it.
   - Keep edits scoped to files touched by the current task, plus directly related files needed to fix diagnostics.

2. Use the project's existing tools.
   - Prefer package scripts such as `format`, `lint`, `typecheck`, `check`, or language-specific formatter commands already configured in the project.
   - Read nearby config before choosing tools: `package.json`, `.prettierrc`, `eslint.config.*`, `.eslintrc*`, `biome.json`, `ruff.toml`, `pyproject.toml`, `black` config, `go.mod`, `Cargo.toml`, or equivalent.
   - If no formatter is configured, make small manual formatting edits that match surrounding code.

3. Remove unused code carefully.
   - Remove unused imports, variables, functions, types, constants, components, CSS classes, and dead branches only when clearly unused.
   - Check whether exported symbols are part of a public API before deleting them.
   - For dynamic usage, framework conventions, reflection, dependency injection, serialization, route discovery, or test fixtures, be conservative.
   - Do not delete code merely because it is unfamiliar.

4. Normalize comments.  **所有必要注释必须使用中文。**
   - Remove comments that merely repeat what the code says.
   - Remove stale comments, commented-out code, TODOs that no longer apply, and debugging notes left by the current change.
   - Keep comments that explain non-obvious intent, constraints, tradeoffs, domain rules, edge cases, compatibility concerns, or external API behavior.
   - Necessary comments MUST use Chinese line comments: `// 中文内容注释`.
   - Rewrite any existing English necessary comments into concise Chinese.
   - Avoid block comments unless required by the language, license header, documentation generator, or project convention.

5. Keep formatting mechanical.
   - Apply formatting only where it is expected by the project or where touched code is visibly inconsistent.
   - Avoid large whitespace-only rewrites across unrelated files.
   - Preserve intentional formatting in snapshots, golden files, Markdown tables, SQL strings, generated files, and embedded examples.

6. Verify after cleanup.
   - Run the narrowest useful checks available: diagnostics for edited files, formatter check, linter, type checker, or targeted tests.
   - If checks cannot run because dependencies or tools are missing, report that clearly in the final answer.
   - Inspect command output for warnings and errors even when exit code is zero.

# Suggested Workflow

1. Identify edited files and surrounding project conventions.
   - Use `git diff --name-only` when available.
   - Read formatting/lint configuration and nearby code style before editing.

2. Run or apply formatting.
   - Prefer the existing project command.
   - If formatting changes too much unrelated code, stop and make focused manual edits instead.

3. Remove unused code.
   - Use diagnostics, linter output, compiler errors, and direct search.
   - Confirm deletion candidates are not referenced elsewhere.

4. Clean comments.
   - Delete redundant and stale comments.
   - Rewrite necessary comments as short `// 中文内容注释` line comments. **所有必要注释必须使用中文。**
   - Keep license headers and generated-file notices intact.

5. Re-run checks.
   - Run the most relevant check after edits.
   - Review the final diff to ensure only intended cleanup occurred.

# Final Response Guidance

When reporting back to the user, mention:

- What formatting or cleanup was applied.
- Whether unused code/imports were removed.
- What checks were run and their result.
- Any checks that could not be run.

Keep the final answer concise. Do not list every tiny formatting change unless the user asked for that level of detail.

# Related Skills

- **project-auto-backup**: Before making any code changes, use this skill to back up the project first. Especially important for large refactors.
- **project-file-organization**: When creating new files or reorganizing project structure, follow the file organization conventions defined by this skill. Use its `check.py` script to verify the project structure after reorganization.
