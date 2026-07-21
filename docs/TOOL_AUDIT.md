# Tool Audit

This audit is repository-agnostic. Repository behavior is selected by `repo_id` and
the configured root; no tool contains a PTCG path or project-specific workflow.

## Validation standard

Every public repository/workspace tool is checked by `tests/mcp-contract.test.ts`:

- it appears exactly once in `tools/list`;
- its input and output schemas are present;
- its safety annotations match its mutation behavior;
- a representative call succeeds; and
- the returned structured content parses against its advertised output schema.

`tests/tool-contracts.test.ts` locks the complete public surface and field metadata.
Focused service tests exercise failure branches, policy boundaries, path sandboxing,
Git state changes, cleanup, execution, receipts, and output truncation.

## Public tools

| Tool | Disposition | Focused validation |
| --- | --- | --- |
| `repo_list_roots` | Keep: one manifest for all configured roots. | MCP contract, root registry |
| `repo_policy_explain` | Keep: diagnoses policy without workaround attempts. | Policy explain service |
| `repo_last_write` | Keep: supplies write provenance and hashes. | Receipt service, MCP contract |
| `repo_tree` | Keep: bounded root-scoped discovery. | Tree service |
| `repo_search` | Keep: bounded root-scoped text search. | Search service |
| `repo_fetch_file` | Keep: focused file read with explicit override. | File reader, path sandbox |
| `repo_read_many` | Keep: coherent bounded evidence reads. | Read-many service |
| `repo_git_status` | Keep: root-scoped Git state. | Git service, subroot test |
| `repo_git_diff` | Keep: root-scoped tracked diff. | Git service |
| `repo_git_review` | Keep: review hub, MCP-created new-file summaries, review token. | Git review service, MCP contract |
| `repo_write_stage_commit` | Keep: compact reviewed local commit; legacy exact form retained. | Git operations, review-token MCP flow |
| `repo_write_recover` | Keep: one reviewed unstage/restore/cleanup operation. | Git operations, cleanup service |
| `repo_write_codex_task` | Keep: explicit task artifact writer. | Codex task service |
| `repo_codex_review` | Keep: reads local Codex result plus current review state. | Codex task service, MCP contract |
| `repo_write_file` | Keep: minimal single-file writer. | File writer |
| `repo_write_changes` | Keep: atomic ordered multi-file edits. | Write changes service and diagnostics |
| `repo_write_handoff` | Keep: local session handoff artifact. | Handoff service |
| `workspace_exec` | Keep: direct argv runner, including `uv run`, with structured rejection details. | Workspace service, five-run determinism test |
| `workspace_run_script` | Keep: inline script runner when direct argv is insufficient. | Workspace service, wrapper cleanup tests |
| `workspace_save_file` | Keep: binary/base64 workspace output. | Workspace service |
| `workspace_claim_task` | Keep: optional coordination for concurrent agents. | Workspace service |
| `workspace_release_task` | Keep: releases an explicit task claim. | Workspace service |
| `workspace_acquire_official_lock` | Keep: optional official-file coordination. | Workspace service |
| `workspace_release_official_lock` | Keep: releases an explicit official lock. | Workspace service |
| `workspace_reap_processes` | Keep: recovery for old workspace process groups. | Workspace service |
| `workspace_create_file_artifact` | Keep: returns a host-downloadable artifact for a repo file. | Workspace service, MCP contract |
| `workspace_import_file` | Keep: copies an approved local artifact into workspace policy. | Workspace service |
| `workspace_apply_patch` | Keep: standard unified-diff edit path. | Workspace service |
| `workspace_cleanup_paths` | Keep: recursive configured cleanup with byte accounting. | Workspace and cleanup services |
| `workspace_policy_explain` | Keep: explains execution/write/delete policy before retrying. | Workspace service, MCP contract |

## Removed from discovery

The following names remain only as internal compatibility handlers or service test
entry points. They are absent from `tools/list`, so ChatGPT cannot discover or call
them. The public-surface snapshot prevents accidental re-exposure.

| Name | Reason hidden |
| --- | --- |
| `repo_git_stage` | Legacy alias; composite commit is the normal path. |
| `repo_git_unstage` | Legacy alias; composite recovery is the normal path. |
| `repo_git_restore_paths` | Granular recovery helper. |
| `repo_git_commit` | Legacy alias for local commit. |
| `repo_write_stage` | Granular staging duplicates the composite path. |
| `repo_write_unstage` | Granular unstaging duplicates recovery. |
| `repo_write_commit` | Staged-only compatibility path. |
| `repo_cleanup_paths` | Repository-prefixed duplicate of workspace cleanup. |
| `repo_project_brief` | Heuristic planning produced noisy broad scans. |
| `repo_task_inventory` | Heuristic task scanning was not authoritative. |
| `repo_decision_memory` | Heuristic document selection was not authoritative. |
| `repo_change_plan` | Planning composition added calls rather than reducing them. |
| `repo_next_action` | Generic TODO ranking was low confidence. |
| `repo_plan_review` | Redundant heuristic planning pass. |
| `repo_prepare_codex_task` | Replaced by the explicit task writer. |
| `workspace_run_python` | Runtime alias replaced by `workspace_exec` or `workspace_run_script`. |
| `workspace_run_bash` | Runtime alias replaced by `workspace_exec` or `workspace_run_script`. |
| `workspace_agent_session` | Session wrapper duplicated explicit coordination tools. |
| `workspace_export_file` | Replaced by `workspace_create_file_artifact`. |
| `workspace_tree` | Duplicate of root-scoped `repo_tree`. |
| `workspace_read_file` | Duplicate of `repo_fetch_file`. |
| `workspace_read_many` | Duplicate of `repo_read_many`. |
| `workspace_search` | Duplicate of `repo_search`. |
| `workspace_delete_paths` | Replaced by policy-aware `workspace_cleanup_paths`. |
| `workspace_git_status` | Duplicate of `repo_git_status`. |
| `workspace_git_diff` | Duplicate of `repo_git_diff`. |
| `workspace_file_info` | Redundant metadata-only filesystem call. |
| `workspace_write_file` | Duplicate of repository write tools. |
| `workspace_make_dir` | Writers create approved parent directories when requested. |

## Kaggle proxy

The default proxy allowlist exposes only saved-output review operations:
`get_notebook_info`, `list_notebook_files`, `download_notebook_output`, and
`download_notebook_output_zip`. It does not expose notebook create, update, run, or
submission operations. The two download operations materialize trusted signed URLs
to a bounded temporary file and add its local path, byte count, and SHA-256 to the
result. `tests/kaggle-mcp-proxy.test.ts` verifies default filtering, materialization,
explicit allowlists, full opt-in, schema forwarding, and error forwarding. Live
Kaggle identity and download behavior require the configured external connector and
are intentionally part of the new-session acceptance prompt.

## Generic acceptance coverage

| Requirement | Automated evidence |
| --- | --- |
| Configured project subroot | Git status/diff and Git operations subroot tests |
| New MCP-created files in review | Receipt-bound SHA-256 review tests |
| Deterministic execution | Same direct command executed five times |
| Precise execution rejection | Stable error-code and diagnostic tests |
| Direct `uv run` | Direct argv workspace execution test |
| Generated tracked-file preservation | Clean tracked output restored; prior dirty file preserved |
| Recursive cleanup | Explicit generated root deleted with exact file/byte counts |
| Review-to-commit reuse | Token dry run, actual commit, and stale-content rejection |
| Public surface completeness | Representative call and schema parse for all 30 public tools |

Validation profiles and a transactional mega-tool were deliberately not added. A
repository can keep its normal validation commands in its own script and execute it
once with `workspace_run_script` or direct argv with `workspace_exec`; review and
commit then use the compact `review_id`. This keeps project policy in the project and
avoids rebuilding a second workflow engine inside MCP.
