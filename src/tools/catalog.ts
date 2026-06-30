import { descriptions } from "./descriptions.js";
import { readOnlyAnnotations, writeAnnotations } from "./annotations.js";
import { toolContracts, type ToolContract, type ToolName } from "./contracts.js";
import {
  changePlanHandler,
  cleanupPathsHandler,
  codexReviewHandler,
  decisionMemoryHandler,
  fetchFileHandler,
  gitCommitHandler,
  gitDiffHandler,
  gitReviewHandler,
  gitRestorePathsHandler,
  gitStageHandler,
  gitStatusHandler,
  gitUnstageHandler,
  lastWriteHandler,
  listRootsHandler,
  nextActionHandler,
  planReviewHandler,
  prepareCodexTaskHandler,
  projectBriefHandler,
  readManyHandler,
  searchHandler,
  taskInventoryHandler,
  treeHandler,
  writeCommitHandler,
  writeRecoverHandler,
  writeStageCommitHandler,
  writeChangesHandler,
  writeCodexTaskHandler,
  writeFileHandler,
  writeHandoffHandler,
  policyExplainHandler,
  workspaceApplyPatchHandler,
  workspaceCleanupPathsHandler,
  workspaceCreateFileArtifactHandler,
  workspaceAcquireOfficialLockHandler,
  workspaceAgentSessionHandler,
  workspaceClaimTaskHandler,
  workspaceDeletePathsHandler,
  workspaceExecHandler,
  workspaceExportFileHandler,
  workspaceFileInfoHandler,
  workspaceGitDiffHandler,
  workspaceGitStatusHandler,
  workspaceImportFileHandler,
  workspaceMakeDirHandler,
  workspacePolicyExplainHandler,
  workspaceReapProcessesHandler,
  workspaceReleaseOfficialLockHandler,
  workspaceReleaseTaskHandler,
  workspaceReadFileHandler,
  workspaceReadManyHandler,
  workspaceSearchHandler,
  workspaceTreeHandler,
  workspaceWriteFileHandler,
  writeStageHandler,
  writeUnstageHandler,
  type ToolHandler
} from "./handlers.js";

export type ToolDefinition = {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: ToolContract["input"];
  outputSchema: ToolContract["output"];
  annotations: typeof readOnlyAnnotations | typeof writeAnnotations;
  handler: ToolHandler;
};

const hiddenPublicToolNames = new Set<ToolName>([
  "repo_git_stage",
  "repo_git_unstage",
  "repo_git_restore_paths",
  "repo_git_commit",
  "repo_write_stage",
  "repo_write_unstage",
  "repo_write_commit",
  "repo_cleanup_paths",
  "workspace_export_file",
  "workspace_tree",
  "workspace_read_file",
  "workspace_read_many",
  "workspace_search",
  "workspace_delete_paths",
  "workspace_git_status",
  "workspace_git_diff"
]);

const fullToolCatalog: ToolDefinition[] = [
  {
    name: "repo_list_roots",
    title: "List approved repositories",
    description: descriptions.repo_list_roots,
    inputSchema: toolContracts.repo_list_roots.input,
    outputSchema: toolContracts.repo_list_roots.output,
    annotations: readOnlyAnnotations,
    handler: listRootsHandler
  },
  {
    name: "repo_policy_explain",
    title: "Explain repository policy",
    description: descriptions.repo_policy_explain,
    inputSchema: toolContracts.repo_policy_explain.input,
    outputSchema: toolContracts.repo_policy_explain.output,
    annotations: readOnlyAnnotations,
    handler: policyExplainHandler
  },
  {
    name: "repo_last_write",
    title: "Read last write receipt",
    description: descriptions.repo_last_write,
    inputSchema: toolContracts.repo_last_write.input,
    outputSchema: toolContracts.repo_last_write.output,
    annotations: readOnlyAnnotations,
    handler: lastWriteHandler
  },
  {
    name: "repo_tree",
    title: "Inspect repository tree",
    description: descriptions.repo_tree,
    inputSchema: toolContracts.repo_tree.input,
    outputSchema: toolContracts.repo_tree.output,
    annotations: readOnlyAnnotations,
    handler: treeHandler
  },
  {
    name: "repo_search",
    title: "Search repository text",
    description: descriptions.repo_search,
    inputSchema: toolContracts.repo_search.input,
    outputSchema: toolContracts.repo_search.output,
    annotations: readOnlyAnnotations,
    handler: searchHandler
  },
  {
    name: "repo_fetch_file",
    title: "Fetch one file",
    description: descriptions.repo_fetch_file,
    inputSchema: toolContracts.repo_fetch_file.input,
    outputSchema: toolContracts.repo_fetch_file.output,
    annotations: readOnlyAnnotations,
    handler: fetchFileHandler
  },
  {
    name: "repo_read_many",
    title: "Read bounded files",
    description: descriptions.repo_read_many,
    inputSchema: toolContracts.repo_read_many.input,
    outputSchema: toolContracts.repo_read_many.output,
    annotations: readOnlyAnnotations,
    handler: readManyHandler
  },
  {
    name: "repo_git_status",
    title: "Read git status",
    description: descriptions.repo_git_status,
    inputSchema: toolContracts.repo_git_status.input,
    outputSchema: toolContracts.repo_git_status.output,
    annotations: readOnlyAnnotations,
    handler: gitStatusHandler
  },
  {
    name: "repo_git_diff",
    title: "Read git diff",
    description: descriptions.repo_git_diff,
    inputSchema: toolContracts.repo_git_diff.input,
    outputSchema: toolContracts.repo_git_diff.output,
    annotations: readOnlyAnnotations,
    handler: gitDiffHandler
  },
  {
    name: "repo_git_review",
    title: "Plan git review",
    description: descriptions.repo_git_review,
    inputSchema: toolContracts.repo_git_review.input,
    outputSchema: toolContracts.repo_git_review.output,
    annotations: readOnlyAnnotations,
    handler: gitReviewHandler
  },
  {
    name: "repo_git_stage",
    title: "Stage explicit git paths",
    description: descriptions.repo_git_stage,
    inputSchema: toolContracts.repo_git_stage.input,
    outputSchema: toolContracts.repo_git_stage.output,
    annotations: writeAnnotations,
    handler: gitStageHandler
  },
  {
    name: "repo_git_unstage",
    title: "Unstage explicit git paths",
    description: descriptions.repo_git_unstage,
    inputSchema: toolContracts.repo_git_unstage.input,
    outputSchema: toolContracts.repo_git_unstage.output,
    annotations: writeAnnotations,
    handler: gitUnstageHandler
  },
  {
    name: "repo_git_restore_paths",
    title: "Restore explicit worktree paths",
    description: descriptions.repo_git_restore_paths,
    inputSchema: toolContracts.repo_git_restore_paths.input,
    outputSchema: toolContracts.repo_git_restore_paths.output,
    annotations: writeAnnotations,
    handler: gitRestorePathsHandler
  },
  {
    name: "repo_git_commit",
    title: "Create local git commit",
    description: descriptions.repo_git_commit,
    inputSchema: toolContracts.repo_git_commit.input,
    outputSchema: toolContracts.repo_git_commit.output,
    annotations: writeAnnotations,
    handler: gitCommitHandler
  },
  {
    name: "repo_write_stage",
    title: "Stage reviewed paths",
    description: descriptions.repo_write_stage,
    inputSchema: toolContracts.repo_write_stage.input,
    outputSchema: toolContracts.repo_write_stage.output,
    annotations: writeAnnotations,
    handler: writeStageHandler
  },
  {
    name: "repo_write_unstage",
    title: "Unstage reviewed paths",
    description: descriptions.repo_write_unstage,
    inputSchema: toolContracts.repo_write_unstage.input,
    outputSchema: toolContracts.repo_write_unstage.output,
    annotations: writeAnnotations,
    handler: writeUnstageHandler
  },
  {
    name: "repo_write_commit",
    title: "Create reviewed local commit",
    description: descriptions.repo_write_commit,
    inputSchema: toolContracts.repo_write_commit.input,
    outputSchema: toolContracts.repo_write_commit.output,
    annotations: writeAnnotations,
    handler: writeCommitHandler
  },
  {
    name: "repo_write_stage_commit",
    title: "Stage and commit reviewed paths",
    description: descriptions.repo_write_stage_commit,
    inputSchema: toolContracts.repo_write_stage_commit.input,
    outputSchema: toolContracts.repo_write_stage_commit.output,
    annotations: writeAnnotations,
    handler: writeStageCommitHandler
  },
  {
    name: "repo_write_recover",
    title: "Recover reviewed paths",
    description: descriptions.repo_write_recover,
    inputSchema: toolContracts.repo_write_recover.input,
    outputSchema: toolContracts.repo_write_recover.output,
    annotations: writeAnnotations,
    handler: writeRecoverHandler
  },
  {
    name: "repo_cleanup_paths",
    title: "Clean up generated paths",
    description: descriptions.repo_cleanup_paths,
    inputSchema: toolContracts.repo_cleanup_paths.input,
    outputSchema: toolContracts.repo_cleanup_paths.output,
    annotations: writeAnnotations,
    handler: cleanupPathsHandler
  },
  {
    name: "repo_project_brief",
    title: "Create project brief",
    description: descriptions.repo_project_brief,
    inputSchema: toolContracts.repo_project_brief.input,
    outputSchema: toolContracts.repo_project_brief.output,
    annotations: readOnlyAnnotations,
    handler: projectBriefHandler
  },
  {
    name: "repo_task_inventory",
    title: "Inventory repository tasks",
    description: descriptions.repo_task_inventory,
    inputSchema: toolContracts.repo_task_inventory.input,
    outputSchema: toolContracts.repo_task_inventory.output,
    annotations: readOnlyAnnotations,
    handler: taskInventoryHandler
  },
  {
    name: "repo_decision_memory",
    title: "Extract decision memory",
    description: descriptions.repo_decision_memory,
    inputSchema: toolContracts.repo_decision_memory.input,
    outputSchema: toolContracts.repo_decision_memory.output,
    annotations: readOnlyAnnotations,
    handler: decisionMemoryHandler
  },
  {
    name: "repo_change_plan",
    title: "Plan repository change",
    description: descriptions.repo_change_plan,
    inputSchema: toolContracts.repo_change_plan.input,
    outputSchema: toolContracts.repo_change_plan.output,
    annotations: readOnlyAnnotations,
    handler: changePlanHandler
  },
  {
    name: "repo_next_action",
    title: "Recommend next action",
    description: descriptions.repo_next_action,
    inputSchema: toolContracts.repo_next_action.input,
    outputSchema: toolContracts.repo_next_action.output,
    annotations: readOnlyAnnotations,
    handler: nextActionHandler
  },
  {
    name: "repo_plan_review",
    title: "Plan repository review",
    description: descriptions.repo_plan_review,
    inputSchema: toolContracts.repo_plan_review.input,
    outputSchema: toolContracts.repo_plan_review.output,
    annotations: readOnlyAnnotations,
    handler: planReviewHandler
  },
  {
    name: "repo_prepare_codex_task",
    title: "Prepare Codex task prompt",
    description: descriptions.repo_prepare_codex_task,
    inputSchema: toolContracts.repo_prepare_codex_task.input,
    outputSchema: toolContracts.repo_prepare_codex_task.output,
    annotations: readOnlyAnnotations,
    handler: prepareCodexTaskHandler
  },
  {
    name: "repo_write_codex_task",
    title: "Write Codex task prompt",
    description: descriptions.repo_write_codex_task,
    inputSchema: toolContracts.repo_write_codex_task.input,
    outputSchema: toolContracts.repo_write_codex_task.output,
    annotations: writeAnnotations,
    handler: writeCodexTaskHandler
  },
  {
    name: "repo_codex_review",
    title: "Review Codex result",
    description: descriptions.repo_codex_review,
    inputSchema: toolContracts.repo_codex_review.input,
    outputSchema: toolContracts.repo_codex_review.output,
    annotations: readOnlyAnnotations,
    handler: codexReviewHandler
  },
  {
    name: "repo_write_file",
    title: "Write one repository file",
    description: descriptions.repo_write_file,
    inputSchema: toolContracts.repo_write_file.input,
    outputSchema: toolContracts.repo_write_file.output,
    annotations: writeAnnotations,
    handler: writeFileHandler
  },
  {
    name: "repo_write_changes",
    title: "Apply repository edit pack",
    description: descriptions.repo_write_changes,
    inputSchema: toolContracts.repo_write_changes.input,
    outputSchema: toolContracts.repo_write_changes.output,
    annotations: writeAnnotations,
    handler: writeChangesHandler
  },
  {
    name: "repo_write_handoff",
    title: "Create ChatGPT handoff",
    description: descriptions.repo_write_handoff,
    inputSchema: toolContracts.repo_write_handoff.input,
    outputSchema: toolContracts.repo_write_handoff.output,
    annotations: writeAnnotations,
    handler: writeHandoffHandler
  },
  {
    name: "workspace_exec",
    title: "Run approved workspace command",
    description: descriptions.workspace_exec,
    inputSchema: toolContracts.workspace_exec.input,
    outputSchema: toolContracts.workspace_exec.output,
    annotations: writeAnnotations,
    handler: workspaceExecHandler
  },
  {
    name: "workspace_agent_session",
    title: "Create workspace agent session",
    description: descriptions.workspace_agent_session,
    inputSchema: toolContracts.workspace_agent_session.input,
    outputSchema: toolContracts.workspace_agent_session.output,
    annotations: writeAnnotations,
    handler: workspaceAgentSessionHandler
  },
  {
    name: "workspace_claim_task",
    title: "Claim workspace task",
    description: descriptions.workspace_claim_task,
    inputSchema: toolContracts.workspace_claim_task.input,
    outputSchema: toolContracts.workspace_claim_task.output,
    annotations: writeAnnotations,
    handler: workspaceClaimTaskHandler
  },
  {
    name: "workspace_release_task",
    title: "Release workspace task claim",
    description: descriptions.workspace_release_task,
    inputSchema: toolContracts.workspace_release_task.input,
    outputSchema: toolContracts.workspace_release_task.output,
    annotations: writeAnnotations,
    handler: workspaceReleaseTaskHandler
  },
  {
    name: "workspace_acquire_official_lock",
    title: "Acquire official workspace lock",
    description: descriptions.workspace_acquire_official_lock,
    inputSchema: toolContracts.workspace_acquire_official_lock.input,
    outputSchema: toolContracts.workspace_acquire_official_lock.output,
    annotations: writeAnnotations,
    handler: workspaceAcquireOfficialLockHandler
  },
  {
    name: "workspace_release_official_lock",
    title: "Release official workspace lock",
    description: descriptions.workspace_release_official_lock,
    inputSchema: toolContracts.workspace_release_official_lock.input,
    outputSchema: toolContracts.workspace_release_official_lock.output,
    annotations: writeAnnotations,
    handler: workspaceReleaseOfficialLockHandler
  },
  {
    name: "workspace_reap_processes",
    title: "Reap stale workspace processes",
    description: descriptions.workspace_reap_processes,
    inputSchema: toolContracts.workspace_reap_processes.input,
    outputSchema: toolContracts.workspace_reap_processes.output,
    annotations: writeAnnotations,
    handler: workspaceReapProcessesHandler
  },
  {
    name: "workspace_export_file",
    title: "Create compatibility file artifact",
    description: descriptions.workspace_export_file,
    inputSchema: toolContracts.workspace_export_file.input,
    outputSchema: toolContracts.workspace_export_file.output,
    annotations: readOnlyAnnotations,
    handler: workspaceExportFileHandler
  },
  {
    name: "workspace_create_file_artifact",
    title: "Create workspace file artifact",
    description: descriptions.workspace_create_file_artifact,
    inputSchema: toolContracts.workspace_create_file_artifact.input,
    outputSchema: toolContracts.workspace_create_file_artifact.output,
    annotations: readOnlyAnnotations,
    handler: workspaceCreateFileArtifactHandler
  },
  {
    name: "workspace_import_file",
    title: "Import artifact into workspace",
    description: descriptions.workspace_import_file,
    inputSchema: toolContracts.workspace_import_file.input,
    outputSchema: toolContracts.workspace_import_file.output,
    annotations: writeAnnotations,
    handler: workspaceImportFileHandler
  },
  {
    name: "workspace_file_info",
    title: "Inspect workspace file metadata",
    description: descriptions.workspace_file_info,
    inputSchema: toolContracts.workspace_file_info.input,
    outputSchema: toolContracts.workspace_file_info.output,
    annotations: readOnlyAnnotations,
    handler: workspaceFileInfoHandler
  },
  {
    name: "workspace_tree",
    title: "Inspect workspace tree",
    description: descriptions.workspace_tree,
    inputSchema: toolContracts.workspace_tree.input,
    outputSchema: toolContracts.workspace_tree.output,
    annotations: readOnlyAnnotations,
    handler: workspaceTreeHandler
  },
  {
    name: "workspace_read_file",
    title: "Read workspace text file",
    description: descriptions.workspace_read_file,
    inputSchema: toolContracts.workspace_read_file.input,
    outputSchema: toolContracts.workspace_read_file.output,
    annotations: readOnlyAnnotations,
    handler: workspaceReadFileHandler
  },
  {
    name: "workspace_read_many",
    title: "Read bounded workspace files",
    description: descriptions.workspace_read_many,
    inputSchema: toolContracts.workspace_read_many.input,
    outputSchema: toolContracts.workspace_read_many.output,
    annotations: readOnlyAnnotations,
    handler: workspaceReadManyHandler
  },
  {
    name: "workspace_search",
    title: "Search workspace text",
    description: descriptions.workspace_search,
    inputSchema: toolContracts.workspace_search.input,
    outputSchema: toolContracts.workspace_search.output,
    annotations: readOnlyAnnotations,
    handler: workspaceSearchHandler
  },
  {
    name: "workspace_write_file",
    title: "Write workspace scratch file",
    description: descriptions.workspace_write_file,
    inputSchema: toolContracts.workspace_write_file.input,
    outputSchema: toolContracts.workspace_write_file.output,
    annotations: writeAnnotations,
    handler: workspaceWriteFileHandler
  },
  {
    name: "workspace_apply_patch",
    title: "Apply workspace patch",
    description: descriptions.workspace_apply_patch,
    inputSchema: toolContracts.workspace_apply_patch.input,
    outputSchema: toolContracts.workspace_apply_patch.output,
    annotations: writeAnnotations,
    handler: workspaceApplyPatchHandler
  },
  {
    name: "workspace_make_dir",
    title: "Create workspace directory",
    description: descriptions.workspace_make_dir,
    inputSchema: toolContracts.workspace_make_dir.input,
    outputSchema: toolContracts.workspace_make_dir.output,
    annotations: writeAnnotations,
    handler: workspaceMakeDirHandler
  },
  {
    name: "workspace_delete_paths",
    title: "Compatibility workspace cleanup",
    description: descriptions.workspace_delete_paths,
    inputSchema: toolContracts.workspace_delete_paths.input,
    outputSchema: toolContracts.workspace_delete_paths.output,
    annotations: writeAnnotations,
    handler: workspaceDeletePathsHandler
  },
  {
    name: "workspace_cleanup_paths",
    title: "Clean workspace scratch paths",
    description: descriptions.workspace_cleanup_paths,
    inputSchema: toolContracts.workspace_cleanup_paths.input,
    outputSchema: toolContracts.workspace_cleanup_paths.output,
    annotations: writeAnnotations,
    handler: workspaceCleanupPathsHandler
  },
  {
    name: "workspace_git_status",
    title: "Read workspace git status",
    description: descriptions.workspace_git_status,
    inputSchema: toolContracts.workspace_git_status.input,
    outputSchema: toolContracts.workspace_git_status.output,
    annotations: readOnlyAnnotations,
    handler: workspaceGitStatusHandler
  },
  {
    name: "workspace_git_diff",
    title: "Read workspace git diff",
    description: descriptions.workspace_git_diff,
    inputSchema: toolContracts.workspace_git_diff.input,
    outputSchema: toolContracts.workspace_git_diff.output,
    annotations: readOnlyAnnotations,
    handler: workspaceGitDiffHandler
  },
  {
    name: "workspace_policy_explain",
    title: "Explain workspace policy",
    description: descriptions.workspace_policy_explain,
    inputSchema: toolContracts.workspace_policy_explain.input,
    outputSchema: toolContracts.workspace_policy_explain.output,
    annotations: readOnlyAnnotations,
    handler: workspacePolicyExplainHandler
  }
];

export const toolCatalog: ToolDefinition[] = fullToolCatalog.filter(
  (tool) => !hiddenPublicToolNames.has(tool.name)
);
