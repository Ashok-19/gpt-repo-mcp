import type { ToolName } from "./contracts.js";

export const MUTATING_TOOL_NAMES = [
  "repo_write_file",
  "repo_write_changes",
  "repo_write_handoff",
  "repo_write_codex_task",
  "repo_write_stage_commit",
  "repo_write_recover",
  "workspace_exec",
  "workspace_run_python",
  "workspace_run_bash",
  "workspace_agent_session",
  "workspace_claim_task",
  "workspace_release_task",
  "workspace_acquire_official_lock",
  "workspace_release_official_lock",
  "workspace_reap_processes",
  "workspace_import_file",
  "workspace_write_file",
  "workspace_apply_patch",
  "workspace_make_dir",
  "workspace_cleanup_paths"
] as const satisfies readonly ToolName[];

const MUTATING_TOOL_NAME_SET = new Set<ToolName>(MUTATING_TOOL_NAMES);

export function isMutatingToolName(name: ToolName | string): name is typeof MUTATING_TOOL_NAMES[number] {
  return MUTATING_TOOL_NAME_SET.has(name as ToolName);
}
