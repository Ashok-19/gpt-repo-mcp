import type { z } from "zod";
import { ChangePlanInputSchema, ChangePlanResultSchema } from "../contracts/change-plan.contract.js";
import { CleanupPathsInputSchema, CleanupPathsResultSchema } from "../contracts/cleanup.contract.js";
import { CodexReviewInputSchema, CodexReviewResultSchema, CodexTaskInputSchema, CodexTaskResultSchema, CodexTaskWriteInputSchema, CodexTaskWriteResultSchema } from "../contracts/codex-task.contract.js";
import { DecisionLogInputSchema, DecisionLogResultSchema } from "../contracts/decision.contract.js";
import { FetchFileInputSchema, FileContentSchema, ReadManyInputSchema, ReadManyResultSchema } from "../contracts/file.contract.js";
import { GitCommitInputSchema, GitCommitResultSchema, GitRecoverInputSchema, GitRecoverResultSchema, GitRestorePathsInputSchema, GitRestorePathsResultSchema, GitStageCommitInputSchema, GitStageCommitResultSchema, GitStageInputSchema, GitStageResultSchema, GitUnstageInputSchema, GitUnstageResultSchema } from "../contracts/git-operations.contract.js";
import { GitDiffInputSchema, GitDiffResultSchema, GitStatusInputSchema, GitStatusResultSchema } from "../contracts/git.contract.js";
import { GitReviewInputSchema, GitReviewResultSchema } from "../contracts/git-review.contract.js";
import { HandoffInputSchema, HandoffResultSchema } from "../contracts/handoff.contract.js";
import { NextActionInputSchema, NextActionResultSchema } from "../contracts/next-action.contract.js";
import { LastWriteInputSchema, LastWriteResultSchema } from "../contracts/operation-receipt.contract.js";
import { PolicyExplainInputSchema, PolicyExplainResultSchema } from "../contracts/policy.contract.js";
import { ProjectBriefInputSchema, ProjectBriefResultSchema } from "../contracts/project.contract.js";
import { RepoInputSchema, RepoListResultSchema, RepoTreeInputSchema } from "../contracts/repo.contract.js";
import { PlanReviewInputSchema, PlanReviewResultSchema } from "../contracts/review.contract.js";
import { SearchInputSchema, SearchResponseSchema } from "../contracts/search.contract.js";
import { TaskInventoryInputSchema, TaskInventoryResultSchema } from "../contracts/task.contract.js";
import { RepoTreeResultSchema } from "../contracts/tree.contract.js";
import { WriteChangesInputSchema, WriteChangesResultSchema, WriteFileInputSchema, WriteFileResultSchema } from "../contracts/write.contract.js";
import {
  WorkspaceApplyPatchInputSchema,
  WorkspaceApplyPatchResultSchema,
  WorkspaceAgentSessionInputSchema,
  WorkspaceAgentSessionResultSchema,
  WorkspaceClaimTaskInputSchema,
  WorkspaceClaimTaskResultSchema,
  WorkspaceDeletePathsInputSchema,
  WorkspaceDeletePathsResultSchema,
  WorkspaceExecInputSchema,
  WorkspaceExecResultSchema,
  WorkspaceExportFileInputSchema,
  WorkspaceExportFileResultSchema,
  WorkspaceFileInfoInputSchema,
  WorkspaceFileInfoResultSchema,
  WorkspaceImportFileInputSchema,
  WorkspaceImportFileResultSchema,
  WorkspaceMakeDirInputSchema,
  WorkspaceMakeDirResultSchema,
  WorkspaceOfficialLockInputSchema,
  WorkspaceOfficialLockResultSchema,
  WorkspaceOfficialUnlockInputSchema,
  WorkspaceOfficialUnlockResultSchema,
  WorkspacePolicyExplainInputSchema,
  WorkspacePolicyExplainResultSchema,
  WorkspaceReapProcessesInputSchema,
  WorkspaceReapProcessesResultSchema,
  WorkspaceReleaseTaskInputSchema,
  WorkspaceReleaseTaskResultSchema,
  WorkspaceRunBashInputSchema,
  WorkspaceRunPythonInputSchema,
  WorkspaceRunScriptResultSchema,
  WorkspaceReadFileInputSchema,
  WorkspaceReadManyInputSchema,
  WorkspaceWriteFileInputSchema
} from "../contracts/workspace.contract.js";

export type ToolName =
  | "repo_list_roots"
  | "repo_policy_explain"
  | "repo_last_write"
  | "repo_tree"
  | "repo_search"
  | "repo_fetch_file"
  | "repo_read_many"
  | "repo_git_status"
  | "repo_git_diff"
  | "repo_git_review"
  | "repo_git_stage"
  | "repo_git_unstage"
  | "repo_git_restore_paths"
  | "repo_git_commit"
  | "repo_write_stage"
  | "repo_write_unstage"
  | "repo_write_commit"
  | "repo_write_stage_commit"
  | "repo_write_recover"
  | "repo_cleanup_paths"
  | "repo_project_brief"
  | "repo_task_inventory"
  | "repo_decision_memory"
  | "repo_change_plan"
  | "repo_next_action"
  | "repo_plan_review"
  | "repo_prepare_codex_task"
  | "repo_write_codex_task"
  | "repo_codex_review"
  | "repo_write_file"
  | "repo_write_changes"
  | "repo_write_handoff"
  | "workspace_exec"
  | "workspace_agent_session"
  | "workspace_claim_task"
  | "workspace_release_task"
  | "workspace_acquire_official_lock"
  | "workspace_release_official_lock"
  | "workspace_reap_processes"
  | "workspace_export_file"
  | "workspace_create_file_artifact"
  | "workspace_import_file"
  | "workspace_file_info"
  | "workspace_tree"
  | "workspace_read_file"
  | "workspace_read_many"
  | "workspace_search"
  | "workspace_write_file"
  | "workspace_apply_patch"
  | "workspace_make_dir"
  | "workspace_delete_paths"
  | "workspace_cleanup_paths"
  | "workspace_git_status"
  | "workspace_git_diff"
  | "workspace_run_python"
  | "workspace_run_bash"
  | "workspace_policy_explain";

export type ToolContract = {
  input: z.ZodObject<z.ZodRawShape>;
  output: z.ZodObject<z.ZodRawShape>;
};

export const toolContracts = {
  repo_list_roots: {
    input: RepoInputSchema.omit({ repo_id: true }),
    output: RepoListResultSchema
  },
  repo_policy_explain: {
    input: PolicyExplainInputSchema,
    output: PolicyExplainResultSchema
  },
  repo_last_write: {
    input: LastWriteInputSchema,
    output: LastWriteResultSchema
  },
  repo_tree: {
    input: RepoTreeInputSchema,
    output: RepoTreeResultSchema
  },
  repo_search: {
    input: SearchInputSchema,
    output: SearchResponseSchema
  },
  repo_fetch_file: {
    input: FetchFileInputSchema,
    output: FileContentSchema
  },
  repo_read_many: {
    input: ReadManyInputSchema,
    output: ReadManyResultSchema
  },
  repo_git_status: {
    input: GitStatusInputSchema,
    output: GitStatusResultSchema
  },
  repo_git_diff: {
    input: GitDiffInputSchema,
    output: GitDiffResultSchema
  },
  repo_git_review: {
    input: GitReviewInputSchema,
    output: GitReviewResultSchema
  },
  repo_git_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_git_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_git_restore_paths: {
    input: GitRestorePathsInputSchema,
    output: GitRestorePathsResultSchema
  },
  repo_git_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_write_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_write_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage_commit: {
    input: GitStageCommitInputSchema,
    output: GitStageCommitResultSchema
  },
  repo_write_recover: {
    input: GitRecoverInputSchema,
    output: GitRecoverResultSchema
  },
  repo_cleanup_paths: {
    input: CleanupPathsInputSchema,
    output: CleanupPathsResultSchema
  },
  repo_project_brief: {
    input: ProjectBriefInputSchema,
    output: ProjectBriefResultSchema
  },
  repo_task_inventory: {
    input: TaskInventoryInputSchema,
    output: TaskInventoryResultSchema
  },
  repo_decision_memory: {
    input: DecisionLogInputSchema,
    output: DecisionLogResultSchema
  },
  repo_change_plan: {
    input: ChangePlanInputSchema,
    output: ChangePlanResultSchema
  },
  repo_next_action: {
    input: NextActionInputSchema,
    output: NextActionResultSchema
  },
  repo_plan_review: {
    input: PlanReviewInputSchema,
    output: PlanReviewResultSchema
  },
  repo_prepare_codex_task: {
    input: CodexTaskInputSchema,
    output: CodexTaskResultSchema
  },
  repo_write_codex_task: {
    input: CodexTaskWriteInputSchema,
    output: CodexTaskWriteResultSchema
  },
  repo_codex_review: {
    input: CodexReviewInputSchema,
    output: CodexReviewResultSchema
  },
  repo_write_file: {
    input: WriteFileInputSchema,
    output: WriteFileResultSchema
  },
  repo_write_changes: {
    input: WriteChangesInputSchema,
    output: WriteChangesResultSchema
  },
  repo_write_handoff: {
    input: HandoffInputSchema,
    output: HandoffResultSchema
  },
  workspace_exec: {
    input: WorkspaceExecInputSchema,
    output: WorkspaceExecResultSchema
  },
  workspace_run_python: {
    input: WorkspaceRunPythonInputSchema,
    output: WorkspaceRunScriptResultSchema
  },
  workspace_run_bash: {
    input: WorkspaceRunBashInputSchema,
    output: WorkspaceRunScriptResultSchema
  },
  workspace_agent_session: {
    input: WorkspaceAgentSessionInputSchema,
    output: WorkspaceAgentSessionResultSchema
  },
  workspace_claim_task: {
    input: WorkspaceClaimTaskInputSchema,
    output: WorkspaceClaimTaskResultSchema
  },
  workspace_release_task: {
    input: WorkspaceReleaseTaskInputSchema,
    output: WorkspaceReleaseTaskResultSchema
  },
  workspace_acquire_official_lock: {
    input: WorkspaceOfficialLockInputSchema,
    output: WorkspaceOfficialLockResultSchema
  },
  workspace_release_official_lock: {
    input: WorkspaceOfficialUnlockInputSchema,
    output: WorkspaceOfficialUnlockResultSchema
  },
  workspace_reap_processes: {
    input: WorkspaceReapProcessesInputSchema,
    output: WorkspaceReapProcessesResultSchema
  },
  workspace_export_file: {
    input: WorkspaceExportFileInputSchema,
    output: WorkspaceExportFileResultSchema
  },
  workspace_create_file_artifact: {
    input: WorkspaceExportFileInputSchema,
    output: WorkspaceExportFileResultSchema
  },
  workspace_import_file: {
    input: WorkspaceImportFileInputSchema,
    output: WorkspaceImportFileResultSchema
  },
  workspace_file_info: {
    input: WorkspaceFileInfoInputSchema,
    output: WorkspaceFileInfoResultSchema
  },
  workspace_tree: {
    input: RepoTreeInputSchema,
    output: RepoTreeResultSchema
  },
  workspace_read_file: {
    input: WorkspaceReadFileInputSchema,
    output: FileContentSchema
  },
  workspace_read_many: {
    input: WorkspaceReadManyInputSchema,
    output: ReadManyResultSchema
  },
  workspace_search: {
    input: SearchInputSchema,
    output: SearchResponseSchema
  },
  workspace_write_file: {
    input: WorkspaceWriteFileInputSchema,
    output: WriteFileResultSchema
  },
  workspace_apply_patch: {
    input: WorkspaceApplyPatchInputSchema,
    output: WorkspaceApplyPatchResultSchema
  },
  workspace_make_dir: {
    input: WorkspaceMakeDirInputSchema,
    output: WorkspaceMakeDirResultSchema
  },
  workspace_delete_paths: {
    input: WorkspaceDeletePathsInputSchema,
    output: WorkspaceDeletePathsResultSchema
  },
  workspace_cleanup_paths: {
    input: WorkspaceDeletePathsInputSchema,
    output: WorkspaceDeletePathsResultSchema
  },
  workspace_git_status: {
    input: GitStatusInputSchema,
    output: GitStatusResultSchema
  },
  workspace_git_diff: {
    input: GitDiffInputSchema,
    output: GitDiffResultSchema
  },
  workspace_policy_explain: {
    input: WorkspacePolicyExplainInputSchema,
    output: WorkspacePolicyExplainResultSchema
  }
} as const satisfies Record<ToolName, ToolContract>;
