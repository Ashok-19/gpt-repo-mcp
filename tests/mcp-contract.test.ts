import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { SERVER_INSTRUCTIONS, createMcpServer } from "../src/register.js";
import { RootRegistry } from "../src/services/root-registry.js";
import { toolCatalog } from "../src/tools/catalog.js";
import { readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { isMutatingToolName } from "../src/tools/mutating-tools.js";

const execFileAsync = promisify(execFile);

describe("MCP contract", () => {
  test("initialize exposes server instructions and tool capability", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "gpt-repo-mcp", version: "0.1.1" });
      expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
      expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
      expect(SERVER_INSTRUCTIONS).not.toContain("read-only repository app");
      expect(SERVER_INSTRUCTIONS).toContain("Mutating tools are disabled by default and require repo-local config opt-in");
      expect(SERVER_INSTRUCTIONS).toContain("Public mutating tools are repo_write_file");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_stage_commit creates local commits only");
      expect(SERVER_INSTRUCTIONS).toContain("repo_git_review is the workflow hub");
      expect(SERVER_INSTRUCTIONS).toContain("prefer composite workflow tools");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_stage_commit for reviewed happy-path local commits");
      expect(SERVER_INSTRUCTIONS).toContain("repo_write_recover for reviewed recovery");
      expect(SERVER_INSTRUCTIONS).toContain("Dry-run is optional preview");
      expect(SERVER_INSTRUCTIONS).toContain("Omit optional reason by default");
      expect(SERVER_INSTRUCTIONS).toContain("repo_last_write");
      expect(SERVER_INSTRUCTIONS).not.toContain("dry-run first when possible");
      expect(SERVER_INSTRUCTIONS).toContain("does not push");
      expect(SERVER_INSTRUCTIONS).toContain("or run shell commands");
    } finally {
      await close();
    }
  });

  test("http server uses JSON transport responses for proxy reliability", async () => {
    const serverSource = await import("node:fs/promises").then((fs) => fs.readFile("src/server.ts", "utf8"));

    expect(serverSource).toContain("GPT_REPO_MCP_JSON_RESPONSE");
    expect(serverSource).toContain("enableJsonResponse: useJsonTransportResponses");
    expect(serverSource).toContain("Parse error: invalid JSON request body");
    expect(serverSource).toContain("unhandledRejection");
    expect(serverSource).toContain("rss_mb");
  });

  test("tools/list exposes schemas and appropriate annotations for every tool", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();
      expect(new Set(listed.tools.map((tool) => tool.name))).toEqual(new Set(toolCatalog.map((tool) => tool.name)));

      for (const tool of listed.tools) {
        expect(tool.title).toEqual(expect.any(String));
        expect(tool.description).toEqual(expect.stringMatching(/^Use this when/));
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
        if (isMutatingToolName(tool.name)) {
          expect(tool.annotations).toMatchObject(writeAnnotations);
        } else {
          expect(tool.annotations).toMatchObject(readOnlyAnnotations);
        }
      }
    } finally {
      await close();
    }
  });

  test("tools/list exposes one script runner instead of runtime aliases", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((tool) => tool.name));

      expect(names.has("workspace_create_file_artifact")).toBe(true);
      expect(names.has("workspace_cleanup_paths")).toBe(true);
      expect(names.has("workspace_run_script")).toBe(true);
      expect(names.has("workspace_run_python")).toBe(false);
      expect(names.has("workspace_run_bash")).toBe(false);
      expect(names.has("workspace_export_file")).toBe(false);
      expect(names.has("workspace_delete_paths")).toBe(false);
    } finally {
      await close();
    }
  });

  test("tools/list exposed surface stays stable", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const listed = await client.listTools();

      expect(listed.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputKeys: Object.keys(tool.inputSchema.properties ?? {}).sort(),
        outputKeys: Object.keys(tool.outputSchema?.properties ?? {}).sort()
      }))).toMatchInlineSnapshot(`
        [
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks which approved repositories are available. Does not read file contents.",
            "inputKeys": [],
            "name": "repo_list_roots",
            "outputKeys": [
              "repos",
            ],
            "title": "List approved repositories",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when a read, write, or cleanup policy question is blocked or the user asks what ChatGPT can access in a repo. Explains effective read/write/cleanup policy, local git operation toggles, matched globs, block reasons, and next steps without reading or mutating files.",
            "inputKeys": [
              "operation",
              "path",
              "repo_id",
            ],
            "name": "repo_policy_explain",
            "outputKeys": [
              "cleanup",
              "effective_policy",
              "guidance",
              "ok",
              "operations",
              "path",
              "read",
              "repo_id",
              "requested_operation",
              "summary",
              "write",
            ],
            "title": "Explain repository policy",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks what the last write operation changed or how to continue review/recovery after a previous write. Reads safe local receipt metadata only and never mutates files or git.",
            "inputKeys": [
              "repo_id",
            ],
            "name": "repo_last_write",
            "outputKeys": [
              "found",
              "next_tool_payloads",
              "ok",
              "receipt",
              "warnings",
            ],
            "title": "Read last write receipt",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks to inspect repository structure or locate likely files by directory. Do not use this when the user asks to read file contents.",
            "inputKeys": [
              "cursor",
              "exclude_globs",
              "include_dependencies",
              "include_files",
              "include_generated",
              "include_globs",
              "include_nested_repos",
              "max_depth",
              "page_size",
              "path",
              "repo_id",
              "respect_default_excludes",
            ],
            "name": "repo_tree",
            "outputKeys": [
              "entries",
              "excluded_summary",
              "next_cursor",
              "truncated",
            ],
            "title": "Inspect repository tree",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks to find code, inspect usages, perform a bughunt, or locate relevant files before reading them. Prefer this before repo_read_many.",
            "inputKeys": [
              "context_lines",
              "cursor",
              "exclude_globs",
              "include_globs",
              "max_results",
              "mode",
              "query",
              "repo_id",
            ],
            "name": "repo_search",
            "outputKeys": [
              "matched_count",
              "next_cursor",
              "results",
              "returned_count",
              "truncated",
              "warnings",
            ],
            "title": "Search repository text",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user names a specific file or after repo_tree/repo_search identifies a relevant file. Supports line ranges. Do not use for broad repository review.",
            "inputKeys": [
              "end_line",
              "max_bytes",
              "override_default_excludes",
              "path",
              "repo_id",
              "start_line",
            ],
            "name": "repo_fetch_file",
            "outputKeys": [
              "end_line",
              "language",
              "path",
              "sha256",
              "size_bytes",
              "start_line",
              "text",
              "total_lines",
              "truncated",
              "warnings",
            ],
            "title": "Fetch one file",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks to read a bounded set of explicit files or glob-matched files. Do not use this to read an entire repository.",
            "inputKeys": [
              "cursor",
              "exclude_globs",
              "include_globs",
              "max_bytes_per_file",
              "max_files",
              "max_total_bytes",
              "paths",
              "repo_id",
            ],
            "name": "repo_read_many",
            "outputKeys": [
              "files",
              "matched_count",
              "next_cursor",
              "returned_count",
              "skipped",
              "truncated",
            ],
            "title": "Read bounded files",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks for git status, branch, dirty files, or changed file counts. Do not use this to inspect file contents.",
            "inputKeys": [
              "repo_id",
            ],
            "name": "repo_git_status",
            "outputKeys": [
              "branch",
              "clean",
              "counts",
              "files",
              "head_sha",
            ],
            "title": "Read git status",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks to review changes or inspect a git diff. Default first call should pass only repo_id. Do not include staged, unstaged, paths, max_bytes, or context_lines on the first pass. Use optional filters only after the default diff is truncated, too broad, or the user asks for a specific comparison.",
            "inputKeys": [
              "base",
              "compare",
              "context_lines",
              "max_bytes",
              "paths",
              "repo_id",
              "staged",
              "unstaged",
            ],
            "name": "repo_git_diff",
            "outputKeys": [
              "base",
              "compare",
              "files",
              "staged",
              "truncated",
              "unstaged",
              "warnings",
            ],
            "title": "Read git diff",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks to review current git changes, recover bad write-tool edits, clean up generated artifacts, prepare staging, or plan a local commit without mutating anything. Workflow hub that returns status, diff summary, warnings, and ready-to-run composite payloads for repo_write_stage_commit and repo_write_recover.",
            "inputKeys": [
              "max_files",
              "mode",
              "repo_id",
            ],
            "name": "repo_git_review",
            "outputKeys": [
              "branch",
              "changed_paths",
              "clean",
              "diff_summary",
              "head_sha",
              "next_tool_payloads",
              "ok",
              "recommendation",
              "review_expires_at",
              "review_id",
            ],
            "title": "Plan git review",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user has reviewed repo_git_review output and explicitly approves its local-only commit. Prefer the opaque review_id payload; legacy exact paths and expected HEAD remain accepted. Reviewed hashes and HEAD are rechecked, it does not push, and never runs shell commands.",
            "inputKeys": [
              "dry_run",
              "expected_head_sha",
              "message",
              "paths",
              "reason",
              "repo_id",
              "review_id",
            ],
            "name": "repo_write_stage_commit",
            "outputKeys": [
              "clean_after",
              "commit_sha",
              "committed_paths",
              "dry_run",
              "head_after",
              "head_before",
              "ok",
              "remaining_changes",
              "staged_paths",
              "warnings",
            ],
            "title": "Stage and commit reviewed paths",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user has reviewed repo_git_review output and explicitly approves recovering exact repo-relative paths in one operation. Can unstage, restore tracked worktree paths, and clean configured generated artifacts; requires expected HEAD, explicit paths, does not reset, checkout, stash, clean, commit, push, or run shell commands.",
            "inputKeys": [
              "cleanup_paths",
              "dry_run",
              "expected_head_sha",
              "reason",
              "repo_id",
              "restore_paths",
              "unstage_paths",
            ],
            "name": "repo_write_recover",
            "outputKeys": [
              "clean_after",
              "deleted",
              "dry_run",
              "head_sha",
              "ok",
              "remaining_changes",
              "restored_paths",
              "skipped",
              "unstaged_paths",
              "warnings",
            ],
            "title": "Recover reviewed paths",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user explicitly asks to create, write, start, resume, or hand off a repo-local Codex prompt/task/run that Codex will execute from the repo. Prefer this by default for repo-local Codex delegation. Writes only .chatgpt/codex-runs/<run_id>/PROMPT.md and run.json through repo write policy; does not implement, stage, commit, push, or run Codex.",
            "inputKeys": [
              "acceptance_criteria",
              "allowed_paths",
              "context_summary",
              "dry_run",
              "forbidden_paths",
              "implementation_scope",
              "inspect_first",
              "objective",
              "reason",
              "repo_id",
              "run_id",
              "title",
              "verification_commands",
            ],
            "name": "repo_write_codex_task",
            "outputKeys": [
              "codex_user_prompt",
              "dry_run",
              "manifest_path",
              "next_steps",
              "ok",
              "prompt_markdown",
              "prompt_path",
              "repo_id",
              "result_path",
              "run_id",
              "warnings",
              "written_paths",
            ],
            "title": "Write Codex task prompt",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when Codex has finished or the user asks to review a repo-local Codex run. Reads .chatgpt/codex-runs/<run_id>/RESULT.md and git diff review state without mutating files or git.",
            "inputKeys": [
              "max_files",
              "repo_id",
              "run_id",
            ],
            "name": "repo_codex_review",
            "outputKeys": [
              "codex_result",
              "git_review",
              "next_steps",
              "next_tool_payloads",
              "ok",
              "repo_id",
              "result_found",
              "result_path",
              "run_id",
              "warnings",
            ],
            "title": "Review Codex result",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user explicitly asks to write or precisely edit one allowed repository file. Primary low-friction single-file writer/editor for docs, notes, prompts, and focused code edits; requires user approval, repo opt-in, and never runs shell, git, or Codex.",
            "inputKeys": [
              "action",
              "content",
              "create_dirs",
              "dry_run",
              "find",
              "path",
              "reason",
              "replace",
              "repo_id",
            ],
            "name": "repo_write_file",
            "outputKeys": [
              "action",
              "bytes_written",
              "changed",
              "created",
              "dry_run",
              "new_sha256",
              "ok",
              "old_sha256",
              "operation_receipt",
              "path",
              "summary",
              "warnings",
            ],
            "title": "Write one repository file",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user explicitly asks to apply a cohesive multi-file edit pack to allowed repository files. Primary low-friction multi-file writer/editor for full-file writes and exact-match edits; requires user approval, repo opt-in, and never runs shell, git, stage, commit, or restore.",
            "inputKeys": [
              "changes",
              "dry_run",
              "reason",
              "repo_id",
            ],
            "name": "repo_write_changes",
            "outputKeys": [
              "changed_paths",
              "counts",
              "dry_run",
              "files",
              "next_steps",
              "ok",
              "operation_receipt",
              "summary",
              "warnings",
            ],
            "title": "Apply repository edit pack",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks for a local-only ChatGPT handoff: skapa handoff, create handoff, skriv handoff, session handoff, resume note, fortsättningsanteckning, ny chatt context, or överlämning till nästa chatt. Creates .chatgpt/handoffs/*.local.md and updates current.local.md; never stages, commits, pushes, resets, checks out, or runs shell commands.",
            "inputKeys": [
              "completed_work",
              "constraints",
              "current_state",
              "current_track",
              "decisions",
              "dry_run",
              "important_files",
              "next_steps",
              "open_questions",
              "repo_id",
              "risks",
              "title",
              "update_current",
              "why",
              "workflow",
            ],
            "name": "repo_write_handoff",
            "outputKeys": [
              "branch",
              "clean",
              "current_next_step",
              "current_path",
              "dry_run",
              "handoff_path",
              "head_sha",
              "ok",
              "startup_prompt",
              "updated_current",
              "warnings",
            ],
            "title": "Create ChatGPT handoff",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks to run a local repository script or validation command, including uv run, npm, and npx. Runs a direct argv array deterministically inside the declared repo-relative cwd with bounded output; optional tracked-worktree preservation restores generated tracked changes after validation.",
            "inputKeys": [
              "agent_id",
              "cmd",
              "cwd",
              "dry_run",
              "env",
              "max_stderr_bytes",
              "max_stdout_bytes",
              "preserve_tracked_worktree",
              "reason",
              "repo_id",
              "timeout_seconds",
            ],
            "name": "workspace_exec",
            "outputKeys": [
              "agent_id",
              "cmd",
              "cwd",
              "dry_run",
              "duration_ms",
              "exit_code",
              "preservation_warnings",
              "resolved_cwd",
              "restored_tracked_paths",
              "stderr",
              "stderr_truncated",
              "stdout",
              "stdout_truncated",
              "timed_out",
            ],
            "title": "Run approved workspace command",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks to run repo-local Python, Node, or POSIX experiments. Successful inline wrappers are removed automatically; failed wrappers are retained for diagnosis.",
            "inputKeys": [
              "agent_id",
              "args",
              "cwd",
              "dry_run",
              "env",
              "max_stderr_bytes",
              "max_stdout_bytes",
              "preserve_tracked_worktree",
              "reason",
              "repo_id",
              "runtime",
              "script",
              "script_path",
              "timeout_seconds",
            ],
            "name": "workspace_run_script",
            "outputKeys": [
              "agent_id",
              "cmd",
              "cwd",
              "dry_run",
              "duration_ms",
              "exit_code",
              "generated_script_cleaned",
              "generated_script_path",
              "interpreter",
              "preservation_warnings",
              "resolved_cwd",
              "restored_tracked_paths",
              "script_path",
              "stderr",
              "stderr_truncated",
              "stdout",
              "stdout_truncated",
              "timed_out",
            ],
            "title": "Run workspace script",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks to save UTF-8, base64, or hex data to an approved repo-local path, including binary artifacts, without relying on a command runner.",
            "inputKeys": [
              "create_dirs",
              "data",
              "dry_run",
              "encoding",
              "overwrite",
              "path",
              "reason",
              "repo_id",
            ],
            "name": "workspace_save_file",
            "outputKeys": [
              "dry_run",
              "mime",
              "ok",
              "overwritten",
              "path",
              "sha256",
              "size_bytes",
            ],
            "title": "Save workspace file",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when an agent starts focused work on one task. Creates a lightweight per-task claim so parallel agents do not promote the same task concurrently.",
            "inputKeys": [
              "agent_id",
              "reason",
              "repo_id",
              "task_id",
              "ttl_seconds",
            ],
            "name": "workspace_claim_task",
            "outputKeys": [
              "acquired",
              "agent_id",
              "expires_at",
              "lock_id",
              "lock_path",
              "ok",
              "owner",
              "resource",
            ],
            "title": "Claim workspace task",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when an agent is done with a task claim. Releases only the matching agent claim or lock id.",
            "inputKeys": [
              "agent_id",
              "claim_id",
              "reason",
              "repo_id",
              "task_id",
            ],
            "name": "workspace_release_task",
            "outputKeys": [
              "agent_id",
              "lock_path",
              "ok",
              "owner",
              "released",
              "resource",
              "warnings",
            ],
            "title": "Release workspace task claim",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when an agent is ready for a serialized official-write or promotion step. Acquires one repository-wide lock scope without changing official files.",
            "inputKeys": [
              "agent_id",
              "reason",
              "repo_id",
              "scope",
              "ttl_seconds",
            ],
            "name": "workspace_acquire_official_lock",
            "outputKeys": [
              "acquired",
              "agent_id",
              "expires_at",
              "lock_id",
              "lock_path",
              "ok",
              "owner",
              "resource",
            ],
            "title": "Acquire official workspace lock",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when a serialized official-write or promotion step completes. Releases only the matching agent lock or lock id.",
            "inputKeys": [
              "agent_id",
              "lock_id",
              "reason",
              "repo_id",
              "scope",
            ],
            "name": "workspace_release_official_lock",
            "outputKeys": [
              "agent_id",
              "lock_path",
              "ok",
              "owner",
              "released",
              "resource",
              "warnings",
            ],
            "title": "Release official workspace lock",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when stale repo-local Python or validation worker processes need inspection or cleanup. Defaults to dry-run and only considers processes whose cwd is inside the approved repo.",
            "inputKeys": [
              "dry_run",
              "min_age_seconds",
              "reason",
              "repo_id",
            ],
            "name": "workspace_reap_processes",
            "outputKeys": [
              "candidates",
              "dry_run",
              "killed",
              "ok",
              "warnings",
            ],
            "title": "Reap stale workspace processes",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user needs a mounted reference for an approved repo-local file. Returns file metadata and a local artifact path without inlining contents.",
            "inputKeys": [
              "max_bytes",
              "path",
              "reason",
              "repo_id",
            ],
            "name": "workspace_create_file_artifact",
            "outputKeys": [
              "mime",
              "mounted_path",
              "path",
              "resource_uri",
              "sha256",
              "size_bytes",
              "warnings",
            ],
            "title": "Create workspace file artifact",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks to place a mounted artifact or local file into an approved workspace scratch location.",
            "inputKeys": [
              "agent_id",
              "dest_path",
              "overwrite",
              "reason",
              "repo_id",
              "source_file",
            ],
            "name": "workspace_import_file",
            "outputKeys": [
              "destination_path",
              "overwritten",
              "sha256",
              "size_bytes",
            ],
            "title": "Import artifact into workspace",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user asks to apply a unified text diff and every touched file is inside configured workspace scratch/write globs. Rejects binary patches and never stages or commits.",
            "inputKeys": [
              "dry_run",
              "patch",
              "reason",
              "repo_id",
            ],
            "name": "workspace_apply_patch",
            "outputKeys": [
              "changed_files",
              "dry_run",
              "ok",
              "summary",
              "warnings",
            ],
            "title": "Apply workspace patch",
          },
          {
            "annotations": {
              "destructiveHint": true,
              "idempotentHint": false,
              "openWorldHint": false,
              "readOnlyHint": false,
            },
            "description": "Use this when the user explicitly asks to remove approved scratch paths. Accepts explicit paths only, defaults to dry-run, and refuses tracked files.",
            "inputKeys": [
              "agent_id",
              "dry_run",
              "paths",
              "reason",
              "repo_id",
            ],
            "name": "workspace_cleanup_paths",
            "outputKeys": [
              "deleted",
              "deleted_bytes",
              "deleted_files",
              "dry_run",
              "ok",
              "selected_bytes",
              "selected_files",
              "skipped",
              "warnings",
            ],
            "title": "Clean workspace scratch paths",
          },
          {
            "annotations": {
              "destructiveHint": false,
              "idempotentHint": true,
              "openWorldHint": false,
              "readOnlyHint": true,
            },
            "description": "Use this when the user asks whether a workspace read, write, exec, export, or cleanup operation is allowed for a path and which policy matched.",
            "inputKeys": [
              "operation",
              "path",
              "repo_id",
            ],
            "name": "workspace_policy_explain",
            "outputKeys": [
              "allowed",
              "matched_allow_globs",
              "matched_deny_globs",
              "next_step",
              "reason",
              "suggested_tool",
            ],
            "title": "Explain workspace policy",
          },
        ]
      `);
    } finally {
      await close();
    }
  });

  test("tools/call returns structuredContent matching the advertised output", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_list_roots",
        arguments: {}
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        repos: [
          expect.objectContaining({
            repo_id: "fixture",
            display_name: "Fixture Repo",
            root: expect.any(String)
          })
        ]
      });
      expect(result.content).toEqual([{ type: "text", text: "1 approved repositories available." }]);
    } finally {
      await close();
    }
  });

  test("repo_write_changes partial failure exposes safe diagnostics in error envelope", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_write_changes",
        arguments: {
          repo_id: "fixture",
          changes: [
            { type: "write", path: "docs/applied-a.md", content: "A\n" },
            { type: "append", path: "docs/ARCHITECTURE.md", content: "Applied\n" },
            { type: "replace", path: "src/app.ts", find: "missingNeedle", replace: "safeFetch" }
          ]
        }
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: {
          code: "WRITE_FIND_NOT_FOUND",
          retryable: false,
          diagnostics: {
            applied_paths: ["docs/applied-a.md", "docs/ARCHITECTURE.md"],
            failed_path: "src/app.ts",
            recovery_hint: expect.stringContaining("repo_git_review")
          }
        }
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("/Users/");
      expect(serialized).not.toContain("A\\n");
      expect(serialized).not.toContain("Applied\\n");
    } finally {
      await close();
    }
  });

  test("repo_last_write returns missing receipt when no write receipt exists", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        ok: true,
        found: false,
        next_tool_payloads: {},
        warnings: ["NO_LAST_WRITE_RECEIPT"]
      });
    } finally {
      await close();
    }
  });

  test("actual repo_write_file creates last write receipt", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const write = await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/write-file-actual.md",
          content: "actual\n"
        }
      });
      expect(write.isError).toBeUndefined();
      expect(write.structuredContent).toMatchObject({
        operation_receipt: {
          operation_id: expect.stringMatching(/^write-/),
          path: ".chatgpt/operations/last-write.json"
        }
      });

      const result = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect(result.structuredContent).toMatchObject({
        ok: true,
        found: true,
        receipt: {
          tool: "repo_write_file",
          repo_id: "fixture",
          touched_paths: ["docs/write-file-actual.md"],
          changed_paths: ["docs/write-file-actual.md"],
          created_paths: ["docs/write-file-actual.md"],
          modified_paths: [],
          counts: { requested: 1, changed: 1, created: 1, unchanged: 0 },
          summary: "Created docs/write-file-actual.md."
        },
        next_tool_payloads: {
          repo_git_review: { repo_id: "fixture" }
        },
        warnings: []
      });
      const serialized = JSON.stringify(result.structuredContent);
      expect(serialized).not.toContain("actual\\n");
      expect(serialized).not.toContain("/tmp/");
    } finally {
      await close();
    }
  });

  test("repo_write_changes creates receipt and dry-run failed and no-op writes do not overwrite it", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const writeChanges = await client.callTool({
        name: "repo_write_changes",
        arguments: {
          repo_id: "fixture",
          changes: [
            { type: "write", path: "docs/new-receipt.md", content: "new\n" },
            { type: "append", path: "docs/ARCHITECTURE.md", content: "changed\n" }
          ]
        }
      });
      expect(writeChanges.isError).toBeUndefined();

      const firstReceipt = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });
      expect(firstReceipt.structuredContent).toMatchObject({
        found: true,
        receipt: {
          tool: "repo_write_changes",
          touched_paths: ["docs/new-receipt.md", "docs/ARCHITECTURE.md"],
          changed_paths: ["docs/new-receipt.md", "docs/ARCHITECTURE.md"],
          created_paths: ["docs/new-receipt.md"],
          modified_paths: ["docs/ARCHITECTURE.md"],
          counts: { requested: 2, changed: 2, created: 1, unchanged: 0 },
          summary: "Applied 2 changes across 2 files."
        }
      });
      const firstOperationId = (firstReceipt.structuredContent as {
        receipt?: { operation_id?: string };
      }).receipt?.operation_id;

      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/dry-run-no-receipt.md",
          content: "dry\n",
          dry_run: true
        }
      });
      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "secrets/blocked.md",
          content: "blocked\n"
        }
      });
      await client.callTool({
        name: "repo_write_file",
        arguments: {
          repo_id: "fixture",
          path: "docs/ARCHITECTURE.md",
          content: "# Architecture\nDecision: keep tools read-only.\nConvention: use contracts first.\nchanged\n"
        }
      });

      const finalReceipt = await client.callTool({
        name: "repo_last_write",
        arguments: { repo_id: "fixture" }
      });

      expect((finalReceipt.structuredContent as {
        receipt?: { operation_id?: string };
      }).receipt?.operation_id).toBe(firstOperationId);
    } finally {
      await close();
    }
  });

  test("repo_write_handoff returns success envelope from HandoffService", async () => {
    const { client, close } = await connectFixtureServer();
    try {
      const result = await client.callTool({
        name: "repo_write_handoff",
        arguments: {
          repo_id: "fixture",
          title: "MCP Handoff",
          current_state: "Tool wiring is under test.",
          why: "The next ChatGPT session needs local resume context.",
          next_steps: [{ title: "Continue Slice v2.2" }],
          dry_run: true
        }
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        dry_run: true,
        handoff_path: expect.stringMatching(/^\.chatgpt\/handoffs\/\d{4}-\d{2}-\d{2}-\d{4}-mcp-handoff\.local\.md$/),
        current_path: ".chatgpt/handoffs/current.local.md",
        updated_current: true,
        branch: expect.any(String),
        head_sha: expect.any(String),
        clean: false,
        startup_prompt: expect.stringContaining("repo_id `fixture`"),
        current_next_step: "Continue Slice v2.2",
        warnings: []
      });
      expect(result.content).toEqual([
        { type: "text", text: expect.stringContaining("Dry run checked handoff") }
      ]);
    } finally {
      await close();
    }
  });

  test("review token drives dry-run and actual stage-and-commit without repeated paths", async () => {
    const { client, close, root } = await connectFixtureServer();
    try {
      await execFileAsync("git", ["restore", "--staged", "--", "docs/staged.md"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
      await writeFile(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\nReviewed token change.\n");
      const review = await client.callTool({ name: "repo_git_review", arguments: { repo_id: "fixture" } });
      const reviewId = (review.structuredContent as { review_id?: string }).review_id;
      expect(reviewId).toEqual(expect.any(String));

      const args = { repo_id: "fixture", review_id: reviewId, message: "Update architecture" };
      const dryRun = await client.callTool({ name: "repo_write_stage_commit", arguments: { ...args, dry_run: true } });
      expect(dryRun.structuredContent).toMatchObject({ dry_run: true, committed_paths: ["docs/ARCHITECTURE.md"] });

      const committed = await client.callTool({ name: "repo_write_stage_commit", arguments: { ...args, dry_run: false } });
      expect(committed.structuredContent).toMatchObject({
        dry_run: false,
        commit_sha: expect.stringMatching(/^[a-f0-9]{40}$/),
        committed_paths: ["docs/ARCHITECTURE.md"]
      });
    } finally {
      await close();
    }
  });

  test("representative calls for every exposed tool match their output schema", async () => {
    const { client, close, head, root } = await connectFixtureServer();
    try {
      const calls = representativeCalls(head, root);
      expect(Object.keys(calls).sort()).toEqual(toolCatalog.map((tool) => tool.name).sort());

      for (const [name, args] of Object.entries(calls)) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, name).toBeUndefined();
        expect(result.structuredContent, name).toBeDefined();

        const definition = toolCatalog.find((tool) => tool.name === name);
        expect(definition, name).toBeDefined();
        const parsed = definition!.outputSchema.safeParse(result.structuredContent);
        expect(parsed.error?.issues, name).toBeUndefined();
        expect(result.content, name).toEqual([
          expect.objectContaining({ type: "text", text: expect.any(String) })
        ]);
      }
    } finally {
      await close();
    }
  });
});

function representativeCalls(head: string, root: string): Record<string, Record<string, unknown>> {
  return {
  repo_list_roots: {},
  repo_policy_explain: { repo_id: "fixture", path: "README.md", operation: "read" },
  repo_last_write: { repo_id: "fixture" },
  repo_tree: { repo_id: "fixture", path: ".", max_depth: 2, page_size: 10 },
  repo_search: { repo_id: "fixture", query: "Fixture", max_results: 5 },
  repo_fetch_file: { repo_id: "fixture", path: "README.md", start_line: 1, end_line: 5 },
  repo_read_many: { repo_id: "fixture", paths: ["README.md", "src/app.ts"], max_files: 2 },
  repo_git_status: { repo_id: "fixture" },
  repo_git_diff: { repo_id: "fixture" },
  repo_git_review: { repo_id: "fixture" },
  repo_write_stage_commit: { repo_id: "fixture", paths: ["docs/staged.md"], message: "Update staged docs", expected_head_sha: head, dry_run: true },
  repo_write_recover: { repo_id: "fixture", restore_paths: ["docs/write-dry-run.md"], cleanup_paths: [".chatgpt/tool-tests/cleanup.txt"], expected_head_sha: head, dry_run: true },
  repo_write_codex_task: {
    repo_id: "fixture",
    title: "Fix fixture docs",
    objective: "Read docs/ARCHITECTURE.md and propose a focused Codex implementation.",
    inspect_first: ["docs/ARCHITECTURE.md"],
    allowed_paths: ["docs/ARCHITECTURE.md"],
    dry_run: true
  },
  repo_codex_review: {
    repo_id: "fixture",
    run_id: "2026-06-04T081500Z-fix-fixture-docs"
  },
  repo_write_file: { repo_id: "fixture", path: "docs/write-file-dry-run.md", content: "planned\n", dry_run: true },
  repo_write_changes: {
    repo_id: "fixture",
    changes: [
      { type: "write", path: "docs/write-changes-dry-run.md", content: "planned\n" },
      {
        type: "edit",
        path: "docs/ARCHITECTURE.md",
        edits: [
          { type: "replace", find: "Decision: keep tools read-only.", replace: "Decision: keep tools safe by default." },
          { type: "insert_after", find: "Convention: use contracts first.", content: "\nConvention: review grouped edits through git." }
        ]
      }
    ],
    dry_run: true
  },
  repo_write_handoff: {
    repo_id: "fixture",
    title: "Representative Handoff",
    current_state: "Representative MCP contract call is running.",
    why: "Output schema should validate for the handoff tool.",
    next_steps: [{ title: "Review handoff output" }],
    dry_run: true
  },
  workspace_exec: { repo_id: "fixture", cwd: ".", cmd: ["python3", "--version"], timeout_seconds: 30, reason: "Smoke test" },
  workspace_run_script: { repo_id: "fixture", agent_id: "smoke-agent", cwd: ".", runtime: "py", script: "print('script-smoke')\n", timeout_seconds: 30, reason: "Smoke script runner" },
  workspace_save_file: { repo_id: "fixture", path: "scratch/tool-tests/saved.bin", data: "T05OWA==", encoding: "base64", overwrite: true, reason: "Smoke file save" },
  workspace_claim_task: { repo_id: "fixture", agent_id: "smoke-agent", task_id: "task001", reason: "Smoke claim" },
  workspace_release_task: { repo_id: "fixture", agent_id: "smoke-agent", task_id: "task001", reason: "Smoke release" },
  workspace_acquire_official_lock: { repo_id: "fixture", agent_id: "smoke-agent", scope: "smoke", reason: "Smoke lock" },
  workspace_release_official_lock: { repo_id: "fixture", agent_id: "smoke-agent", scope: "smoke", reason: "Smoke unlock" },
  workspace_reap_processes: { repo_id: "fixture", dry_run: true, min_age_seconds: 0, reason: "Smoke reap" },
  workspace_create_file_artifact: { repo_id: "fixture", path: "README.md", max_bytes: 10000, reason: "Smoke artifact" },
  workspace_import_file: { repo_id: "fixture", source_file: join(root, "README.md"), dest_path: "scratch/tool-tests/imported-readme.md", overwrite: true, reason: "Smoke import" },
  workspace_apply_patch: {
    repo_id: "fixture",
    patch: "diff --git a/scratch/tool-tests/patch.txt b/scratch/tool-tests/patch.txt\nnew file mode 100644\nindex 0000000..257cc56\n--- /dev/null\n+++ b/scratch/tool-tests/patch.txt\n@@ -0,0 +1 @@\n+planned\n",
    dry_run: true,
    reason: "Smoke workspace patch"
  },
  workspace_cleanup_paths: { repo_id: "fixture", paths: ["scratch/tool-tests/imported-readme.md"], dry_run: true, reason: "Smoke workspace cleanup" },
  workspace_policy_explain: { repo_id: "fixture", path: "scratch/tool-tests/imported-readme.md", operation: "delete" }
  };
}

async function connectFixtureServer() {
  const root = await createRepoRoot();
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, env: { PATH: process.env.PATH ?? "" } })).stdout.trim();
  const registry = await RootRegistry.fromConfig({
    repos: [{
      repo_id: "fixture",
      display_name: "Fixture Repo",
      root,
      writes: { enabled: true, allowed_globs: ["docs/**", "src/**", ".chatgpt/**"] },
      operations: {
        enabled: true,
        git_stage_enabled: true,
        git_commit_enabled: true,
        cleanup_enabled: true
      }
    }],
    limits: {}
  });
  const server = createMcpServer({ registry });
  const client = new Client({ name: "contract-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  return {
    client,
    head,
    root,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function createRepoRoot() {
  const root = await mkdtemp(join(tmpdir(), "gpt-repo-mcp-contract-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, ".chatgpt", "tool-tests"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\nDecision: keep tools read-only.\nConvention: use contracts first.\n");
  await writeFile(join(root, "TODO.md"), "- [ ] Wire repo_task_inventory\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: {
      build: "tsc",
      test: "vitest"
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.0.0"
    }
  }, null, 2));
  await writeFile(join(root, "src", "app.ts"), "export const fixture = true;\n");
  await execFileAsync("git", ["init"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["add", "--", "README.md", "docs/ARCHITECTURE.md", "TODO.md", "package.json", "src/app.ts"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  await writeFile(join(root, "src-placeholder.txt"), "changed\n");
  await writeFile(join(root, "docs", "staged.md"), "staged\n");
  await writeFile(join(root, "docs", "write-dry-run.md"), "planned\n");
  await writeFile(join(root, ".chatgpt", "tool-tests", "cleanup.txt"), "temporary\n");
  await execFileAsync("git", ["add", "--", "docs/staged.md"], { cwd: root, env: { PATH: process.env.PATH ?? "" } });
  return root;
}
