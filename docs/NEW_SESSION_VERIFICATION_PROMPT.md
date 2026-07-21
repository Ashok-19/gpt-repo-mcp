# New Session Verification Prompt

Paste the text below into a new ChatGPT session that has the Local MCP connector
enabled.

```text
Audit the connected Local MCP after its workflow/surface repair. This is a live
acceptance test, not an implementation task.

Rules

- Use Local MCP tools directly. Do not use shell or Python workarounds for a tool
  failure.
- Do not repeatedly rediscover schemas. Use the schemas already supplied by the
  connector; if discovery is genuinely required, do it once and count it.
- Do not modify or commit tracked files in normal project repositories.
- Use repo_id `gpt-repo-mcp` for the automated test suite and disposable scratch
  checks. Use `preserve_tracked_worktree: true` for validations.
- Treat every configured repo as an independent project root. Do not assume the
  parent of a configured root is part of that project.
- Never launch, update, or rerun a Kaggle notebook. Saved-output checks are read-only.
- On any policy rejection, record its structured reason and stop that check. Do not
  try an equivalent wrapper or subprocess fallback.
- Track the number of MCP calls, schema-discovery calls, rejected calls, and fallback
  attempts.

Checks

1. Call `repo_list_roots` once. Confirm every returned root exists and that at least
   two different repo_ids can be inspected independently. If `ptcg-rl` and `ptcg`
   are present, confirm `ptcg-rl` is the active project root and `ptcg` is a separate
   archive root. Do not treat those names as required product behavior.

2. On two different repositories, call `repo_tree`, `repo_search`,
   `repo_read_many`, and `repo_git_status` with small bounds. Confirm all returned
   paths are relative to the selected root, generated roots are excluded by default,
   oversized search files are skipped with a warning, and no sibling/archive paths
   leak into the active project.

3. On `gpt-repo-mcp`, call `workspace_exec` for each command below. Use cwd `.` and
   `preserve_tracked_worktree: true`:

   - `["npm", "test"]`
   - `["npm", "run", "typecheck"]`
   - `["npm", "run", "lint"]`
   - `["npm", "run", "build"]`
   - `["npm", "run", "check:public"]`
   - `["npm", "run", "check:config"]`

   Confirm every receipt contains the repo-relative `cwd`, absolute `resolved_cwd`,
   exit code, duration, truncation flags, and tracked-file preservation result. Check
   `repo_git_status` before and after and confirm validation did not add tracked
   changes.

4. Run the exact same read-only call
   `workspace_exec(repo_id="gpt-repo-mcp", cwd=".", cmd=["node", "--version"]...)`
   five times. Report whether all five executed. Any alternating allow/block result
   is a failure.

5. Run one nested-cwd command from `src` and verify `cwd` is `src` while
   `resolved_cwd` is the absolute `.../gpt-repo-mcp/src` path. Then deliberately
   request one harmless blocked command such as `sudo id`; confirm the error says
   `EXECUTION_POLICY_REJECTED` and includes policy stage, reason code, trigger, safe
   alternative when available, and `mutation_occurred: false`.

6. If any configured repository has `uv.lock`, run
   `["uv", "run", "python", "--version"]` there through `workspace_exec`. Confirm it
   executes directly without bash, Python-subprocess, or system-Python fallbacks.

7. Exercise disposable cleanup only under
   `gpt-repo-mcp/scratch/mcp-acceptance-<timestamp>/`:

   - create two small files with `workspace_save_file`;
   - call `workspace_cleanup_paths` once with `dry_run: true` on the parent directory;
   - confirm selected file and byte counts are exact;
   - call it once with `dry_run: false` on the same directory;
   - confirm deleted file and byte counts match the dry run and the directory is gone.

8. Exercise coordination without leaving state: claim and release one unique task,
   acquire and release one unique official lock, and call `workspace_reap_processes`
   in dry-run mode. Any acquired state must be released even when a later check fails.

9. Read `docs/TOOL_AUDIT.md`. Compare its 30 public tools with the connector's
   visible tool list. Report any missing tool, unexpected legacy alias, duplicated
   read/write tool, schema mismatch, or tool whose response is disproportionately
   verbose. The repository test suite must have executed representative calls and
   output-schema parsing for all 30 public tools.

10. Call `repo_git_review` on `gpt-repo-mcp`. Confirm ordinary output is compact and
    MCP-created hash-matched new files would be reviewable while local `.chatgpt`
    artifacts remain excluded. Do not create a tracked change just to obtain a live
    review token: the automated MCP contract test covers review-token dry run, actual
    exact commit in a temporary Git fixture, and stale-content rejection.

11. If a completed saved private Kaggle notebook owner/slug/version is already known,
    test only the exposed saved-output flow: notebook info, file listing, and download
    of one small selected output or output ZIP. Confirm returned remote/local path
    semantics and hashes where the upstream connector supplies them. Never create,
    update, launch, or rerun the notebook. If no identity is known, mark only this
    live external check SKIPPED rather than guessing.

Report

Return a concise table with PASS, FAIL, or SKIPPED for each numbered check. Then give:

- total MCP calls;
- schema-discovery calls;
- policy rejections with exact structured reason codes;
- fallback attempts (target: zero);
- tracked files changed after validation (target: zero);
- public tool count and unexpected tool names;
- any response that was too verbose or should have been a pageable resource;
- remaining friction ranked P0/P1/P2, preferring fixes to existing tools over new
  workflow tools.

Fact-check every conclusion against actual receipts. Do not call a check successful
because an ignored file merely disappeared from Git status; distinguish physically
deleted, ignored but present, policy-blocked, and preserved artifacts.
```
