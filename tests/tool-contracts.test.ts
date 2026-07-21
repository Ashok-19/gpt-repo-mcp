import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  WriteChangesInputSchema,
  WriteChangesResultSchema,
  WriteFileInputSchema,
  WriteFileResultSchema
} from "../src/contracts/write.contract.js";
import {
  GitCommitInputSchema,
  GitCommitResultSchema,
  GitRecoverInputSchema,
  GitRecoverResultSchema,
  GitRestorePathsInputSchema,
  GitRestorePathsResultSchema,
  GitStageCommitInputSchema,
  GitStageCommitResultSchema,
  GitStageInputSchema,
  GitStageResultSchema,
  GitUnstageInputSchema,
  GitUnstageResultSchema
} from "../src/contracts/git-operations.contract.js";
import { CleanupPathsInputSchema, CleanupPathsResultSchema } from "../src/contracts/cleanup.contract.js";
import { CodexReviewInputSchema, CodexReviewResultSchema, CodexTaskWriteInputSchema, CodexTaskWriteResultSchema } from "../src/contracts/codex-task.contract.js";
import { GitReviewResultSchema } from "../src/contracts/git-review.contract.js";
import { HandoffInputSchema, HandoffResultSchema } from "../src/contracts/handoff.contract.js";
import { LastWriteInputSchema, LastWriteResultSchema } from "../src/contracts/operation-receipt.contract.js";
import { PolicyExplainInputSchema, PolicyExplainResultSchema } from "../src/contracts/policy.contract.js";
import { RepoReaderConfigSchema } from "../src/config/schema.js";
import { readOnlyAnnotations, writeAnnotations } from "../src/tools/annotations.js";
import { toolCatalog } from "../src/tools/catalog.js";
import { toolContracts } from "../src/tools/contracts.js";
import { MUTATING_TOOL_NAMES, isMutatingToolName } from "../src/tools/mutating-tools.js";
import { createAuditEvent } from "../src/runtime/telemetry.js";

function expectFieldDescriptions(fields: Array<[string, { description?: string }]>): void {
  for (const [field, schema] of fields) {
    expect(schema.description, `${field} should have a field description`).toBeTypeOf("string");
    expect(schema.description?.length, `${field} should have a non-empty field description`).toBeGreaterThan(10);
  }
}

function schemaDescription(schema: unknown): string | undefined {
  return (schema as { description?: string }).description;
}

describe("tool catalog contracts", () => {
  test("all tools have required metadata and appropriate annotations", () => {
    expect(toolCatalog.map((tool) => tool.name)).toEqual([
      "repo_list_roots",
      "repo_policy_explain",
      "repo_last_write",
      "repo_tree",
      "repo_search",
      "repo_fetch_file",
      "repo_read_many",
      "repo_git_status",
      "repo_git_diff",
      "repo_git_review",
      "repo_write_stage_commit",
      "repo_write_recover",
      "repo_write_codex_task",
      "repo_codex_review",
      "repo_write_file",
      "repo_write_changes",
      "repo_write_handoff",
      "workspace_exec",
      "workspace_run_script",
      "workspace_save_file",
      "workspace_claim_task",
      "workspace_release_task",
      "workspace_acquire_official_lock",
      "workspace_release_official_lock",
      "workspace_reap_processes",
      "workspace_create_file_artifact",
      "workspace_import_file",
      "workspace_apply_patch",
      "workspace_cleanup_paths",
      "workspace_policy_explain"
    ]);

    for (const tool of toolCatalog) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.startsWith("Use this when")).toBe(true);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      if (isMutatingToolName(tool.name)) {
        expect(tool.annotations).toEqual(writeAnnotations);
      } else {
        expect(tool.annotations).toEqual(readOnlyAnnotations);
      }
      expect(tool.handler).toBeTypeOf("function");
    }
  });

  test("mutating tools use central contracts and annotations", () => {
    expect(MUTATING_TOOL_NAMES).toEqual([
      "repo_write_file",
      "repo_write_changes",
      "repo_write_handoff",
      "repo_write_codex_task",
      "repo_write_stage_commit",
      "repo_write_recover",
      "workspace_exec",
      "workspace_run_script",
      "workspace_save_file",
      "workspace_claim_task",
      "workspace_release_task",
      "workspace_acquire_official_lock",
      "workspace_release_official_lock",
      "workspace_reap_processes",
      "workspace_import_file",
      "workspace_apply_patch",
      "workspace_cleanup_paths"
    ]);
    const writeFile = toolCatalog.find((tool) => tool.name === "repo_write_file");
    const policyExplain = toolCatalog.find((tool) => tool.name === "repo_policy_explain");
    const writeCodexTask = toolCatalog.find((tool) => tool.name === "repo_write_codex_task");
    const codexReview = toolCatalog.find((tool) => tool.name === "repo_codex_review");
    const writeChanges = toolCatalog.find((tool) => tool.name === "repo_write_changes");
    const writeHandoff = toolCatalog.find((tool) => tool.name === "repo_write_handoff");
    const stageCommit = toolCatalog.find((tool) => tool.name === "repo_write_stage_commit");
    const recover = toolCatalog.find((tool) => tool.name === "repo_write_recover");
    const lastWrite = toolCatalog.find((tool) => tool.name === "repo_last_write");

    expect(policyExplain).toBeDefined();
    expect(policyExplain?.inputSchema).toBe(PolicyExplainInputSchema);
    expect(policyExplain?.outputSchema).toBe(PolicyExplainResultSchema);
    expect(policyExplain?.annotations).toEqual(readOnlyAnnotations);
    expect(writeCodexTask).toBeDefined();
    expect(writeCodexTask?.inputSchema).toBe(CodexTaskWriteInputSchema);
    expect(writeCodexTask?.outputSchema).toBe(CodexTaskWriteResultSchema);
    expect(writeCodexTask?.annotations).toEqual(writeAnnotations);
    expect(codexReview).toBeDefined();
    expect(codexReview?.inputSchema).toBe(CodexReviewInputSchema);
    expect(codexReview?.outputSchema).toBe(CodexReviewResultSchema);
    expect(codexReview?.annotations).toEqual(readOnlyAnnotations);
    expect(lastWrite).toBeDefined();
    expect(lastWrite?.inputSchema).toBe(LastWriteInputSchema);
    expect(lastWrite?.outputSchema).toBe(LastWriteResultSchema);
    expect(lastWrite?.annotations).toEqual(readOnlyAnnotations);
    expect(toolCatalog.some((tool) => (tool.name as string) === "repo_decision_log")).toBe(false);
    expect((toolContracts as Record<string, unknown>).repo_decision_log).toBeUndefined();
    expect(writeFile).toBeDefined();
    expect(writeFile?.inputSchema).toBe(WriteFileInputSchema);
    expect(writeFile?.outputSchema).toBe(WriteFileResultSchema);
    expect(writeFile?.annotations).toEqual(writeAnnotations);
    expect(writeChanges).toBeDefined();
    expect(writeChanges?.inputSchema).toBe(WriteChangesInputSchema);
    expect(writeChanges?.outputSchema).toBe(WriteChangesResultSchema);
    expect(writeChanges?.annotations).toEqual(writeAnnotations);
    expect(writeHandoff).toBeDefined();
    expect(writeHandoff?.inputSchema).toBe(HandoffInputSchema);
    expect(writeHandoff?.outputSchema).toBe(HandoffResultSchema);
    expect(writeHandoff?.annotations).toEqual(writeAnnotations);
    expect(stageCommit).toBeDefined();
    expect(stageCommit?.inputSchema).toBe(GitStageCommitInputSchema);
    expect(stageCommit?.outputSchema).toBe(GitStageCommitResultSchema);
    expect(stageCommit?.annotations).toEqual(writeAnnotations);
    expect(recover).toBeDefined();
    expect(recover?.inputSchema).toBe(GitRecoverInputSchema);
    expect(recover?.outputSchema).toBe(GitRecoverResultSchema);
    expect(recover?.annotations).toEqual(writeAnnotations);
    expect(toolContracts.repo_write_stage.input).toBe(toolContracts.repo_git_stage.input);
    expect(toolContracts.repo_write_stage.output).toBe(toolContracts.repo_git_stage.output);
    expect(toolContracts.repo_write_unstage.input).toBe(toolContracts.repo_git_unstage.input);
    expect(toolContracts.repo_write_unstage.output).toBe(toolContracts.repo_git_unstage.output);
    expect(toolContracts.repo_write_commit.input).toBe(toolContracts.repo_git_commit.input);
    expect(toolContracts.repo_write_commit.output).toBe(toolContracts.repo_git_commit.output);
    expect(isMutatingToolName("repo_git_review")).toBe(false);
    expect(isMutatingToolName("repo_last_write")).toBe(false);
  });

  test("handoff intent is routed to repo_write_handoff description only", () => {
    const writeFile = toolCatalog.find((tool) => tool.name === "repo_write_file");
    const writeChanges = toolCatalog.find((tool) => tool.name === "repo_write_changes");
    const writeHandoff = toolCatalog.find((tool) => tool.name === "repo_write_handoff");
    const handoffTerms = /handoff|handoffs|resume note|session handoff/i;

    expect(writeFile?.description).not.toMatch(handoffTerms);
    expect(writeChanges?.description).not.toMatch(handoffTerms);

    expect(writeHandoff?.description).toContain("skapa handoff");
    expect(writeHandoff?.description).toContain("create handoff");
    expect(writeHandoff?.description).toContain("skriv handoff");
    expect(writeHandoff?.description).toContain("session handoff");
    expect(writeHandoff?.description).toContain("resume note");
    expect(writeHandoff?.description).toContain("local-only ChatGPT handoff");
    expect(writeHandoff?.description).toContain("current.local.md");
    expect(writeHandoff?.description).toContain(".chatgpt/handoffs/*.local.md");
  });

  test("receipt files are ignored by git", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain(".chatgpt/operations/*.json");
  });

  test("repo_git_review is read-only and does not expose no-op diff hunk input", () => {
    const reviewTool = toolCatalog.find((tool) => tool.name === "repo_git_review");

    expect(reviewTool?.annotations).toEqual(readOnlyAnnotations);
    expect(Object.keys(reviewTool?.inputSchema.shape ?? {}).sort()).toEqual([
      "max_files",
      "mode",
      "repo_id"
    ]);
  });

  test("repo_git_review audit metadata omits changed path lists", () => {
    const event = createAuditEvent({
      tool: "repo_git_review",
      repo_id: "fixture",
      counts: { changed: 2, recommended: 1 },
      truncated: false,
      warnings: []
    });

    expect(event).toEqual({
      tool: "repo_git_review",
      repo_id: "fixture",
      counts: { changed: 2, recommended: 1 },
      truncated: false,
      warnings: []
    });
    expect("paths" in event).toBe(false);
  });

  test("mutating tool schemas describe every input and output field", () => {
    expectFieldDescriptions([
      ["repo_last_write.repo_id", LastWriteInputSchema.shape.repo_id],
      ["repo_last_write.ok", LastWriteResultSchema.shape.ok],
      ["repo_last_write.found", LastWriteResultSchema.shape.found],
      ["repo_last_write.receipt", LastWriteResultSchema.shape.receipt],
      ["repo_last_write.next_tool_payloads", LastWriteResultSchema.shape.next_tool_payloads],
      ["repo_last_write.warnings", LastWriteResultSchema.shape.warnings],
      ["repo_write_file.repo_id", WriteFileInputSchema.shape.repo_id],
      ["repo_write_file.path", WriteFileInputSchema.shape.path],
      ["repo_write_file.action", WriteFileInputSchema.shape.action],
      ["repo_write_file.content", WriteFileInputSchema.shape.content],
      ["repo_write_file.find", WriteFileInputSchema.shape.find],
      ["repo_write_file.replace", WriteFileInputSchema.shape.replace],
      ["repo_write_file.create_dirs", WriteFileInputSchema.shape.create_dirs],
      ["repo_write_file.dry_run", WriteFileInputSchema.shape.dry_run],
      ["repo_write_file.reason", WriteFileInputSchema.shape.reason],
      ["repo_write_file.ok", WriteFileResultSchema.shape.ok],
      ["repo_write_file.path", WriteFileResultSchema.shape.path],
      ["repo_write_file.action", WriteFileResultSchema.shape.action],
      ["repo_write_file.dry_run", WriteFileResultSchema.shape.dry_run],
      ["repo_write_file.changed", WriteFileResultSchema.shape.changed],
      ["repo_write_file.created", WriteFileResultSchema.shape.created],
      ["repo_write_file.bytes_written", WriteFileResultSchema.shape.bytes_written],
      ["repo_write_file.old_sha256", WriteFileResultSchema.shape.old_sha256],
      ["repo_write_file.new_sha256", WriteFileResultSchema.shape.new_sha256],
      ["repo_write_file.summary", WriteFileResultSchema.shape.summary],
      ["repo_write_file.warnings", WriteFileResultSchema.shape.warnings],
      ["repo_write_file.operation_receipt", WriteFileResultSchema.shape.operation_receipt]
    ]);

    expectFieldDescriptions([
      ["repo_write_changes.repo_id", WriteChangesInputSchema.shape.repo_id],
      ["repo_write_changes.changes", WriteChangesInputSchema.shape.changes],
      ["repo_write_changes.dry_run", WriteChangesInputSchema.shape.dry_run],
      ["repo_write_changes.reason", WriteChangesInputSchema.shape.reason],
      ["repo_write_changes.ok", WriteChangesResultSchema.shape.ok],
      ["repo_write_changes.dry_run", WriteChangesResultSchema.shape.dry_run],
      ["repo_write_changes.changed_paths", WriteChangesResultSchema.shape.changed_paths],
      ["repo_write_changes.files", WriteChangesResultSchema.shape.files],
      ["repo_write_changes.files.path", WriteChangesResultSchema.shape.files.element.shape.path],
      ["repo_write_changes.files.type", WriteChangesResultSchema.shape.files.element.shape.type],
      ["repo_write_changes.files.changed", WriteChangesResultSchema.shape.files.element.shape.changed],
      ["repo_write_changes.files.created", WriteChangesResultSchema.shape.files.element.shape.created],
      ["repo_write_changes.files.bytes_written", WriteChangesResultSchema.shape.files.element.shape.bytes_written],
      ["repo_write_changes.files.old_sha256", WriteChangesResultSchema.shape.files.element.shape.old_sha256],
      ["repo_write_changes.files.new_sha256", WriteChangesResultSchema.shape.files.element.shape.new_sha256],
      ["repo_write_changes.files.summary", WriteChangesResultSchema.shape.files.element.shape.summary],
      ["repo_write_changes.counts", WriteChangesResultSchema.shape.counts],
      ["repo_write_changes.counts.requested", WriteChangesResultSchema.shape.counts.shape.requested],
      ["repo_write_changes.counts.changed", WriteChangesResultSchema.shape.counts.shape.changed],
      ["repo_write_changes.counts.created", WriteChangesResultSchema.shape.counts.shape.created],
      ["repo_write_changes.counts.unchanged", WriteChangesResultSchema.shape.counts.shape.unchanged],
      ["repo_write_changes.summary", WriteChangesResultSchema.shape.summary],
      ["repo_write_changes.warnings", WriteChangesResultSchema.shape.warnings],
      ["repo_write_changes.next_steps", WriteChangesResultSchema.shape.next_steps],
      ["repo_write_changes.operation_receipt", WriteChangesResultSchema.shape.operation_receipt]
    ]);

    expectFieldDescriptions([
      ["repo_write_handoff.repo_id", HandoffInputSchema.shape.repo_id],
      ["repo_write_handoff.title", HandoffInputSchema.shape.title],
      ["repo_write_handoff.current_track", HandoffInputSchema.shape.current_track],
      ["repo_write_handoff.current_state", HandoffInputSchema.shape.current_state],
      ["repo_write_handoff.why", HandoffInputSchema.shape.why],
      ["repo_write_handoff.completed_work", HandoffInputSchema.shape.completed_work],
      ["repo_write_handoff.decisions", HandoffInputSchema.shape.decisions],
      ["repo_write_handoff.workflow", HandoffInputSchema.shape.workflow],
      ["repo_write_handoff.constraints", HandoffInputSchema.shape.constraints],
      ["repo_write_handoff.next_steps", HandoffInputSchema.shape.next_steps],
      ["repo_write_handoff.important_files", HandoffInputSchema.shape.important_files],
      ["repo_write_handoff.risks", HandoffInputSchema.shape.risks],
      ["repo_write_handoff.open_questions", HandoffInputSchema.shape.open_questions],
      ["repo_write_handoff.update_current", HandoffInputSchema.shape.update_current],
      ["repo_write_handoff.dry_run", HandoffInputSchema.shape.dry_run],
      ["repo_write_handoff.ok", HandoffResultSchema.shape.ok],
      ["repo_write_handoff.dry_run", HandoffResultSchema.shape.dry_run],
      ["repo_write_handoff.handoff_path", HandoffResultSchema.shape.handoff_path],
      ["repo_write_handoff.current_path", HandoffResultSchema.shape.current_path],
      ["repo_write_handoff.updated_current", HandoffResultSchema.shape.updated_current],
      ["repo_write_handoff.branch", HandoffResultSchema.shape.branch],
      ["repo_write_handoff.head_sha", HandoffResultSchema.shape.head_sha],
      ["repo_write_handoff.clean", HandoffResultSchema.shape.clean],
      ["repo_write_handoff.startup_prompt", HandoffResultSchema.shape.startup_prompt],
      ["repo_write_handoff.current_next_step", HandoffResultSchema.shape.current_next_step],
      ["repo_write_handoff.warnings", HandoffResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_stage.repo_id", GitStageInputSchema.shape.repo_id],
      ["repo_git_stage.paths", GitStageInputSchema.shape.paths],
      ["repo_git_stage.expected_head_sha", GitStageInputSchema.shape.expected_head_sha],
      ["repo_git_stage.dry_run", GitStageInputSchema.shape.dry_run],
      ["repo_git_stage.reason", GitStageInputSchema.shape.reason],
      ["repo_git_stage.ok", GitStageResultSchema.shape.ok],
      ["repo_git_stage.dry_run", GitStageResultSchema.shape.dry_run],
      ["repo_git_stage.head_sha", GitStageResultSchema.shape.head_sha],
      ["repo_git_stage.staged_paths", GitStageResultSchema.shape.staged_paths],
      ["repo_git_stage.skipped", GitStageResultSchema.shape.skipped],
      ["repo_git_stage.skipped.path", GitStageResultSchema.shape.skipped.element.shape.path],
      ["repo_git_stage.skipped.reason", GitStageResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_stage.warnings", GitStageResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_unstage.repo_id", GitUnstageInputSchema.shape.repo_id],
      ["repo_git_unstage.paths", GitUnstageInputSchema.shape.paths],
      ["repo_git_unstage.expected_head_sha", GitUnstageInputSchema.shape.expected_head_sha],
      ["repo_git_unstage.dry_run", GitUnstageInputSchema.shape.dry_run],
      ["repo_git_unstage.reason", GitUnstageInputSchema.shape.reason],
      ["repo_git_unstage.ok", GitUnstageResultSchema.shape.ok],
      ["repo_git_unstage.dry_run", GitUnstageResultSchema.shape.dry_run],
      ["repo_git_unstage.head_sha", GitUnstageResultSchema.shape.head_sha],
      ["repo_git_unstage.unstaged_paths", GitUnstageResultSchema.shape.unstaged_paths],
      ["repo_git_unstage.skipped", GitUnstageResultSchema.shape.skipped],
      ["repo_git_unstage.skipped.path", GitUnstageResultSchema.shape.skipped.element.shape.path],
      ["repo_git_unstage.skipped.reason", GitUnstageResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_unstage.warnings", GitUnstageResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_restore_paths.repo_id", GitRestorePathsInputSchema.shape.repo_id],
      ["repo_git_restore_paths.paths", GitRestorePathsInputSchema.shape.paths],
      ["repo_git_restore_paths.expected_head_sha", GitRestorePathsInputSchema.shape.expected_head_sha],
      ["repo_git_restore_paths.dry_run", GitRestorePathsInputSchema.shape.dry_run],
      ["repo_git_restore_paths.reason", GitRestorePathsInputSchema.shape.reason],
      ["repo_git_restore_paths.ok", GitRestorePathsResultSchema.shape.ok],
      ["repo_git_restore_paths.dry_run", GitRestorePathsResultSchema.shape.dry_run],
      ["repo_git_restore_paths.head_sha", GitRestorePathsResultSchema.shape.head_sha],
      ["repo_git_restore_paths.restored_paths", GitRestorePathsResultSchema.shape.restored_paths],
      ["repo_git_restore_paths.skipped", GitRestorePathsResultSchema.shape.skipped],
      ["repo_git_restore_paths.skipped.path", GitRestorePathsResultSchema.shape.skipped.element.shape.path],
      ["repo_git_restore_paths.skipped.reason", GitRestorePathsResultSchema.shape.skipped.element.shape.reason],
      ["repo_git_restore_paths.warnings", GitRestorePathsResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_git_commit.repo_id", GitCommitInputSchema.shape.repo_id],
      ["repo_git_commit.message", GitCommitInputSchema.shape.message],
      ["repo_git_commit.expected_head_sha", GitCommitInputSchema.shape.expected_head_sha],
      ["repo_git_commit.expected_staged_paths", GitCommitInputSchema.shape.expected_staged_paths],
      ["repo_git_commit.dry_run", GitCommitInputSchema.shape.dry_run],
      ["repo_git_commit.reason", GitCommitInputSchema.shape.reason],
      ["repo_git_commit.ok", GitCommitResultSchema.shape.ok],
      ["repo_git_commit.dry_run", GitCommitResultSchema.shape.dry_run],
      ["repo_git_commit.head_before", GitCommitResultSchema.shape.head_before],
      ["repo_git_commit.head_after", GitCommitResultSchema.shape.head_after],
      ["repo_git_commit.commit_sha", GitCommitResultSchema.shape.commit_sha],
      ["repo_git_commit.committed_paths", GitCommitResultSchema.shape.committed_paths],
      ["repo_git_commit.warnings", GitCommitResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_write_stage_commit.repo_id", GitStageCommitInputSchema.shape.repo_id],
      ["repo_write_stage_commit.paths", GitStageCommitInputSchema.shape.paths],
      ["repo_write_stage_commit.message", GitStageCommitInputSchema.shape.message],
      ["repo_write_stage_commit.expected_head_sha", GitStageCommitInputSchema.shape.expected_head_sha],
      ["repo_write_stage_commit.dry_run", GitStageCommitInputSchema.shape.dry_run],
      ["repo_write_stage_commit.reason", GitStageCommitInputSchema.shape.reason],
      ["repo_write_stage_commit.ok", GitStageCommitResultSchema.shape.ok],
      ["repo_write_stage_commit.dry_run", GitStageCommitResultSchema.shape.dry_run],
      ["repo_write_stage_commit.head_before", GitStageCommitResultSchema.shape.head_before],
      ["repo_write_stage_commit.head_after", GitStageCommitResultSchema.shape.head_after],
      ["repo_write_stage_commit.commit_sha", GitStageCommitResultSchema.shape.commit_sha],
      ["repo_write_stage_commit.staged_paths", GitStageCommitResultSchema.shape.staged_paths],
      ["repo_write_stage_commit.committed_paths", GitStageCommitResultSchema.shape.committed_paths],
      ["repo_write_stage_commit.remaining_changes", GitStageCommitResultSchema.shape.remaining_changes],
      ["repo_write_stage_commit.clean_after", GitStageCommitResultSchema.shape.clean_after],
      ["repo_write_stage_commit.warnings", GitStageCommitResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_write_recover.repo_id", GitRecoverInputSchema.shape.repo_id],
      ["repo_write_recover.expected_head_sha", GitRecoverInputSchema.shape.expected_head_sha],
      ["repo_write_recover.unstage_paths", GitRecoverInputSchema.shape.unstage_paths],
      ["repo_write_recover.restore_paths", GitRecoverInputSchema.shape.restore_paths],
      ["repo_write_recover.cleanup_paths", GitRecoverInputSchema.shape.cleanup_paths],
      ["repo_write_recover.dry_run", GitRecoverInputSchema.shape.dry_run],
      ["repo_write_recover.reason", GitRecoverInputSchema.shape.reason],
      ["repo_write_recover.ok", GitRecoverResultSchema.shape.ok],
      ["repo_write_recover.dry_run", GitRecoverResultSchema.shape.dry_run],
      ["repo_write_recover.head_sha", GitRecoverResultSchema.shape.head_sha],
      ["repo_write_recover.unstaged_paths", GitRecoverResultSchema.shape.unstaged_paths],
      ["repo_write_recover.restored_paths", GitRecoverResultSchema.shape.restored_paths],
      ["repo_write_recover.deleted", GitRecoverResultSchema.shape.deleted],
      ["repo_write_recover.deleted.path", GitRecoverResultSchema.shape.deleted.element.shape.path],
      ["repo_write_recover.deleted.type", GitRecoverResultSchema.shape.deleted.element.shape.type],
      ["repo_write_recover.skipped", GitRecoverResultSchema.shape.skipped],
      ["repo_write_recover.skipped.path", GitRecoverResultSchema.shape.skipped.element.shape.path],
      ["repo_write_recover.skipped.reason", GitRecoverResultSchema.shape.skipped.element.shape.reason],
      ["repo_write_recover.remaining_changes", GitRecoverResultSchema.shape.remaining_changes],
      ["repo_write_recover.clean_after", GitRecoverResultSchema.shape.clean_after],
      ["repo_write_recover.warnings", GitRecoverResultSchema.shape.warnings]
    ]);

    expectFieldDescriptions([
      ["repo_cleanup_paths.repo_id", CleanupPathsInputSchema.shape.repo_id],
      ["repo_cleanup_paths.paths", CleanupPathsInputSchema.shape.paths],
      ["repo_cleanup_paths.dry_run", CleanupPathsInputSchema.shape.dry_run],
      ["repo_cleanup_paths.reason", CleanupPathsInputSchema.shape.reason],
      ["repo_cleanup_paths.ok", CleanupPathsResultSchema.shape.ok],
      ["repo_cleanup_paths.dry_run", CleanupPathsResultSchema.shape.dry_run],
      ["repo_cleanup_paths.deleted", CleanupPathsResultSchema.shape.deleted],
      ["repo_cleanup_paths.deleted.path", CleanupPathsResultSchema.shape.deleted.element.shape.path],
      ["repo_cleanup_paths.deleted.type", CleanupPathsResultSchema.shape.deleted.element.shape.type],
      ["repo_cleanup_paths.skipped", CleanupPathsResultSchema.shape.skipped],
      ["repo_cleanup_paths.skipped.path", CleanupPathsResultSchema.shape.skipped.element.shape.path],
      ["repo_cleanup_paths.skipped.reason", CleanupPathsResultSchema.shape.skipped.element.shape.reason],
      ["repo_cleanup_paths.warnings", CleanupPathsResultSchema.shape.warnings]
    ]);
  });

  test("repo_write_changes schema accepts grouped same-file exact-match edits", () => {
    const parsed = WriteChangesInputSchema.safeParse({
      repo_id: "fixture",
      changes: [
        {
          type: "edit",
          path: "src/app.ts",
          edits: [
            { type: "replace", find: "const enabled = false;", replace: "const enabled = true;" },
            { type: "insert_before", find: "export function run() {", content: "const started = true;\n" },
            { type: "insert_after", find: "export function run() {", content: "\n  console.log('running');" }
          ]
        }
      ]
    });

    expect(parsed.error?.issues).toBeUndefined();
  });

  test("repo_write_changes schema rejects unsupported grouped edit operations", () => {
    const parsed = WriteChangesInputSchema.safeParse({
      repo_id: "fixture",
      changes: [
        {
          type: "edit",
          path: "src/app.ts",
          edits: [
            { type: "append", find: "export function run() {", content: "unsupported\n" }
          ]
        }
      ]
    });

    expect(parsed.success).toBe(false);
  });

  test("repo_git_review schema accepts composite recover payloads", () => {
    const parsed = GitReviewResultSchema.safeParse({
      ok: true,
      branch: "main",
      head_sha: "0".repeat(40),
      clean: false,
      changed_paths: [],
      diff_summary: {
        file_count: 0,
        truncated: false,
        files: []
      },
      recommendation: {
        ready_to_stage: false,
        recommended_stage_paths: [],
        excluded_paths: [],
        suggested_commit_message: "No changes to commit",
        risk_level: "low",
        warnings: []
      },
      next_tool_payloads: {
        repo_write_recover_dry_run: {
          repo_id: "fixture",
          expected_head_sha: "0".repeat(40),
          unstage_paths: ["docs/a.md"],
          restore_paths: ["docs/a.md"],
          cleanup_paths: [".chatgpt/tool-tests/generated.md"],
          dry_run: true
        },
        repo_write_recover_actual: {
          repo_id: "fixture",
          expected_head_sha: "0".repeat(40),
          unstage_paths: ["docs/a.md"],
          restore_paths: ["docs/a.md"],
          cleanup_paths: [".chatgpt/tool-tests/generated.md"],
          dry_run: false
        }
      }
    });

    expect(parsed.error?.issues).toBeUndefined();
  });

  test("operations policy schema includes safe git operation defaults", () => {
    const parsed = RepoReaderConfigSchema.safeParse({
      repos: [{
        repo_id: "fixture",
        display_name: "Fixture",
        root: "/tmp/fixture",
        operations: {
          enabled: true,
          git_stage_enabled: true,
          git_commit_enabled: true,
          max_paths_per_operation: 25
        }
      }],
      limits: {}
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.repos[0]?.operations).toMatchObject({
      enabled: true,
      git_stage_enabled: true,
      git_commit_enabled: true,
      max_paths_per_operation: 25
    });

    expect(parsed.data?.repos[0]?.operations).toMatchObject({
      cleanup_enabled: false,
      cleanup_allowed_globs: [
        ".chatgpt/tool-tests/**",
        ".chatgpt/backups/**",
        ".chatgpt/audits/**",
        ".chatgpt/backlog/**",
        ".chatgpt/codex-runs/**",
        "scratch/**",
        "**/.pytest_cache/**",
        "**/.ruff_cache/**",
        "**/__pycache__/**",
        "**/coverage/**",
        "**/dist/**",
        "**/test-results/**",
        "**/playwright-report/**"
      ]
    });
    expect(RepoReaderConfigSchema.parse({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root: "/tmp/fixture" }],
      limits: {}
    }).repos[0]?.operations).toEqual({
      enabled: false,
      git_stage_enabled: false,
      git_commit_enabled: false,
      max_paths_per_operation: 50,
      cleanup_enabled: false,
      cleanup_allowed_globs: [
        ".chatgpt/tool-tests/**",
        ".chatgpt/backups/**",
        ".chatgpt/audits/**",
        ".chatgpt/backlog/**",
        ".chatgpt/codex-runs/**",
        "scratch/**",
        "**/.pytest_cache/**",
        "**/.ruff_cache/**",
        "**/__pycache__/**",
        "**/coverage/**",
        "**/dist/**",
        "**/test-results/**",
        "**/playwright-report/**"
      ]
    });
  });

  test("write policy schema exposes current defaults without legacy backup config", () => {
    const parsed = RepoReaderConfigSchema.safeParse({
      repos: [{
        repo_id: "fixture",
        display_name: "Fixture",
        root: "/tmp/fixture",
        writes: {
          enabled: true
        }
      }],
      limits: {}
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.repos[0]?.writes.max_bytes_per_write).toBe(1048576);

    const defaultWrites = RepoReaderConfigSchema.parse({
      repos: [{ repo_id: "fixture", display_name: "Fixture", root: "/tmp/fixture" }],
      limits: {}
    }).repos[0]?.writes;
    expect(defaultWrites?.max_bytes_per_write).toBe(1048576);
    expect(defaultWrites?.allowed_globs).toEqual([
      ".chatgpt/**",
      ".codex/**",
      "docs/**",
      "README.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "CODE_OF_CONDUCT.md",
      "SUPPORT.md",
      "LICENSE",
      ".gitignore"
    ]);
    expect(defaultWrites?.allowed_globs).toContain(".gitignore");
    expect(defaultWrites).not.toHaveProperty("require_expected_sha256_for_overwrite");
    expect(defaultWrites).not.toHaveProperty("create_backup_on_overwrite");
    expect(defaultWrites).not.toHaveProperty("backup_dir");
    expect(defaultWrites?.denied_globs).toContain("**/node_modules/**");
    expect(defaultWrites?.denied_globs).toContain("**/dist/**");
    expect(defaultWrites?.denied_globs).toContain("**/.next/**");
    expect(defaultWrites?.denied_globs).toContain("**/coverage/**");
    expect(defaultWrites?.denied_globs).not.toContain("**/*secret*");
    expect(defaultWrites?.denied_globs).not.toContain("**/*credential*");
  });

  test("config example is a valid empty starter config", () => {
    const raw = readFileSync("config.example.json", "utf8");
    const example = JSON.parse(raw) as { repos?: unknown[]; limits?: Record<string, unknown> };
    const parsed = RepoReaderConfigSchema.safeParse(example);

    expect(parsed.success).toBe(true);
    expect(example.repos).toEqual([]);
    expect(example.limits).toEqual({
      max_files: 50,
      max_bytes_per_file: 128000,
      max_total_bytes: 750000
    });
    expect(raw).not.toContain("/absolute/path/to/repo");
  });

  test("repo_read_many advertises exclude globs and file content output", () => {
    const readMany = toolCatalog.find((tool) => tool.name === "repo_read_many");
    expect(readMany?.inputSchema.shape.exclude_globs).toBeDefined();
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture" }).success).toBe(false);
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture", paths: ["README.md"] }).success).toBe(true);
    expect(readMany?.inputSchema.safeParse({ repo_id: "fixture", include_globs: ["src/**/*.ts"] }).success).toBe(true);

    const outputSchema = readMany!.outputSchema;
    const parsed = outputSchema.safeParse({
      files: [{
        path: "README.md",
        size_bytes: 10,
        sha256: "abc",
        total_lines: 1,
        start_line: 1,
        end_line: 1,
        truncated: false,
        text: "hello",
        warnings: []
      }],
      skipped: [],
      matched_count: 1,
      returned_count: 1,
      truncated: false
    });
    expect(parsed.success).toBe(true);

    const missingFileFields = outputSchema.safeParse({
      files: [{ path: "README.md" }],
      skipped: [],
      matched_count: 1,
      returned_count: 1,
      truncated: false
    });
    expect(missingFileFields.success).toBe(false);
  });

  test("repo_git_diff advertises minimal first-call guidance", () => {
    const gitDiff = toolCatalog.find((tool) => tool.name === "repo_git_diff");

    expect(gitDiff?.description).toContain("Default first call should pass only repo_id");
    expect(gitDiff?.description).toContain("Do not include staged, unstaged, paths, max_bytes, or context_lines on the first pass");
    expect(schemaDescription(gitDiff!.inputSchema.shape.max_bytes)).toContain("Second-pass refinement");
    expect(schemaDescription(gitDiff!.inputSchema.shape.context_lines)).toContain("Omit on the first diff call");
  });

  test("every tool uses the central contract objects", () => {
    const exposedNames = toolCatalog.map((tool) => tool.name);
    expect(exposedNames).not.toContain("repo_git_stage");
    expect(exposedNames).not.toContain("repo_git_unstage");
    expect(exposedNames).not.toContain("repo_git_restore_paths");
    expect(exposedNames).not.toContain("repo_git_commit");
    expect(exposedNames).not.toContain("repo_write_stage");
    expect(exposedNames).not.toContain("repo_write_unstage");
    expect(exposedNames).not.toContain("repo_write_commit");
    expect(exposedNames).not.toContain("repo_cleanup_paths");
    expect(exposedNames).not.toContain("repo_project_brief");
    expect(exposedNames).not.toContain("repo_task_inventory");
    expect(exposedNames).not.toContain("repo_decision_memory");
    expect(exposedNames).not.toContain("repo_change_plan");
    expect(exposedNames).not.toContain("repo_next_action");
    expect(exposedNames).not.toContain("repo_plan_review");
    expect(exposedNames).not.toContain("repo_prepare_codex_task");
    expect(exposedNames).not.toContain("workspace_export_file");
    expect(exposedNames).not.toContain("workspace_tree");
    expect(exposedNames).not.toContain("workspace_read_file");
    expect(exposedNames).not.toContain("workspace_read_many");
    expect(exposedNames).not.toContain("workspace_search");
    expect(exposedNames).not.toContain("workspace_delete_paths");
    expect(exposedNames).not.toContain("workspace_git_status");
    expect(exposedNames).not.toContain("workspace_git_diff");
    expect(exposedNames).not.toContain("workspace_run_python");
    expect(exposedNames).not.toContain("workspace_run_bash");
    expect(exposedNames).not.toContain("workspace_agent_session");
    expect(exposedNames).not.toContain("workspace_file_info");
    expect(exposedNames).not.toContain("workspace_write_file");
    expect(exposedNames).not.toContain("workspace_make_dir");

    for (const tool of toolCatalog) {
      const contract = toolContracts[tool.name];
      expect(tool.inputSchema).toBe(contract.input);
      expect(tool.outputSchema).toBe(contract.output);
    }
  });

  test("exposed tool surface shape stays stable", () => {
    expect(toolCatalog.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputKeys: Object.keys(tool.inputSchema.shape).sort(),
      outputKeys: Object.keys(tool.outputSchema.shape).sort()
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
          "description": "Use this when the user has reviewed repo_git_review output and explicitly approves staging and committing exact repo-relative paths in one local-only operation. Requires expected HEAD, explicit paths, exact staged path verification, does not push, and never runs shell commands.",
          "inputKeys": [
            "dry_run",
            "expected_head_sha",
            "message",
            "paths",
            "reason",
            "repo_id",
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
          "description": "Use this when the user asks to run a local repository script or validation command, including uv run, npm, and npx. Runs a direct argv array deterministically inside the declared repo-relative cwd with policy checks and bounded output; policy rejections include the exact stage, reason, and trigger.",
          "inputKeys": [
            "agent_id",
            "cmd",
            "cwd",
            "dry_run",
            "env",
            "max_stderr_bytes",
            "max_stdout_bytes",
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
  });

  test("catalog does not define inline zod schemas", () => {
    const source = readFileSync("src/tools/catalog.ts", "utf8");

    expect(source).not.toMatch(/\binputSchema:\s*{/);
    expect(source).not.toMatch(/\boutputSchema:\s*{/);
    expect(source).not.toMatch(/\bz\.(object|string|number|boolean|array|enum|record|union|literal)\s*\(/);
    expect(source).not.toMatch(/\.shape\b/);
  });
});
