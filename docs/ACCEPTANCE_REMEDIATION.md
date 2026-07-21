# Acceptance Remediation

## Root cause of the surface mismatch

The 43 core schemas and 70 Kaggle schemas were connector-cached, pre-repair
definitions. This is confirmed by the impossible mixed state in the report:
`workspace_file_info` was advertised by ChatGPT but rejected by the current server as
unknown, while current source and contract tests expose 30 core tools.

The connector URL is now schema-versioned. The old unversioned route returns HTTP
410 with `MCP_SCHEMA_ROUTE_RETIRED`; it can no longer silently pair cached schemas
with a newer server. After rebuild/restart, health reports:

```json
{"version":"0.2.1","schema_revision":"2","core_tool_count":30,"kaggle_tool_count":4}
```

Server version `0.2.1` advertises `tools.listChanged`, and `npm run connect` prints a
new `/s/2/t/<token>/mcp` URL. ChatGPT connectors must be completely removed and added
again with that URL. Starting or refreshing a chat does not invalidate the cache.

## Fixes applied

| Acceptance failure | Remediation |
| --- | --- |
| Generated directory stubs in trees | Default-excluded directories are rejected before their directory entry is added. `.git`, `.venv`, `.pytest_cache`, `.ruff_cache`, dependency roots, and other configured defaults no longer appear as stubs. |
| Oversized search warning flood | Search returns one aggregate count/byte warning with at most five example paths. |
| Missing preservation schema/result | The field was already present in repaired source; every execution result now additionally returns required `preservation_requested`, `restored_tracked_paths`, and `preservation_warnings` fields, including empty outcomes. |
| Missing safe alternative | Policy rejections now expose both `allowed_alternative` and `safe_alternative` when guidance exists. Administrative-command rejection recommends running without `sudo` or asking the user to run it outside MCP. |
| Missing path became internal error | Raw filesystem `ENOENT` errors now map to stable `PATH_NOT_FOUND`. |
| Stale public surface | Version bumped to `0.2.0`; health exposes live core/Kaggle counts; list-change capability is advertised; connector-refresh instructions were added. |
| Saved-output download returned only a URL | Existing Kaggle download tools now fetch trusted Kaggle signed URLs into a bounded system-temp artifact and return remote URL, local path, exact bytes, and SHA-256. No new tool was added. |
| Notebook info returned source | JSON source/code/cell blobs are removed from notebook-info responses. Saved-version descriptions distinguish numeric versions from optional labels. |
| Signed output URL returned 404 | Selected-output retrieval now falls back to the official read-only `kaggle kernels output` command, resolves the requested file without trusting flattened list metadata, and returns retrieval mode, local path, bytes, and SHA-256. |
| Kaggle errors lacked diagnostics | Download failures now return stable `KAGGLE_ARTIFACT_*` codes with stage, owner, slug, version, file, HTTP status, and redacted upstream error details. |

## Incremental commits

| Commit | Change |
| --- | --- |
| `b65a449` | Hide excluded directories from tree results |
| `b440b0e` | Aggregate oversized search warnings |
| `6debc1d` | Clarify policy and missing-path errors |
| `4b86745` | Expose connector schema revision state |
| `77215f5` | Report preservation on every execution |
| `f0dd817` | Materialize saved Kaggle outputs locally |
| `2655363` | Compact saved notebook metadata |
| `d606ef9` | Version connector URLs to bust schema caches |
| `1697a07` | Diagnose and recover Kaggle output downloads |

## Verification

- 35 test files passed.
- 353 tests passed.
- Typecheck passed.
- ESLint passed.
- Production build passed.
- Public-hygiene check passed.
- Four configured repository roots passed config validation.
- Worktree is clean.
- Restarted live server reports version `0.2.1`, schema revision 2, 30 core tools, and four Kaggle tools.

## Retest boundary

Completely remove the old ChatGPT connector, run `npm run connect`, and add a new
connector with the printed `/s/2/` URL before rerunning the acceptance prompt. The
retired unversioned URL intentionally returns 410.

Kaggle file-list path and size values originate in the official upstream connector.
The local bridge does not invent missing directory information or rewrite reported
sizes. Selected-output fallback now resolves against files actually downloaded by
the official CLI, so listing metadata is not trusted for byte/hash evidence. Preserve
raw list responses if upstream normalization is still needed.

Large command output remains bounded and explicitly marked truncated. Moving full
logs into pageable MCP resources is a separate P2 change because it requires a log
resource lifecycle; it was not mixed into the execution-safety fixes.
