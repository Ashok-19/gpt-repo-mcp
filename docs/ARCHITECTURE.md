# Architecture

GPT Repo MCP (`gpt-repo-mcp`) is a tool-only MCP server. There is no widget in v1. The server exposes a Streamable HTTP `/mcp` endpoint plus a local health route.

## Boundaries

- `src/server.ts` owns the HTTP server, `/mcp` transport, and `/health`.
- `src/instructions.ts` contains server-wide MCP instructions for cross-tool workflows.
- `src/register.ts` creates the MCP server and registers tools.
- `src/contracts/*` contains Zod input and output contracts.
- `src/tools/contracts.ts` is the single tool-name to contract map.
- `src/tools/catalog.ts` is metadata plus handler wiring only.
- `src/tools/define-tool.ts` converts contract objects to MCP SDK schemas and registers metadata.
- `src/tools/handlers.ts` contains thin adapters from tool input to services.
- `src/services/*` contains filesystem, Git, search, tree, read, write, execution, review, task, and connector logic.
- `src/policies/*` contains shared limits, excludes, write defaults, and secret patterns.
- `src/runtime/*` contains context, structured errors, result envelopes, and audit logging.

## Tool Registration Flow

The intended flow is:

```text
contracts -> toolContracts -> catalog -> define-tool -> handlers -> services
```

Contracts define schemas. `toolContracts` assigns exactly one input and output contract to each tool. `catalog` adds titles, descriptions, annotations, and handlers. `define-tool` is the only layer that turns Zod objects into MCP SDK `inputSchema` and `outputSchema` shapes. Handlers resolve approved repos and call services.

This keeps `catalog` metadata-only and prevents inline schema drift.

## Data Flow

ChatGPT calls a tool with `repo_id` and repo-relative POSIX paths or globs. The handler resolves `repo_id` through `RootRegistry`, creates the required services, and returns a result envelope.

Read filesystem access goes through shared safety layers:

```text
PathSandbox -> IgnoreEngine -> FileClassifier -> SecretScanner/FileReader
```

Write filesystem access stays separate from read services:

```text
PathSandbox -> WritePolicy -> FileWriter
                         \-> WriteChangesService -> FileWriter
write handlers -> OperationReceiptService
```

`repo_write_file` has its own contract, write annotations, repo-level policy, and service. The handler only resolves `repo_id`, builds the sandbox and write policy, and delegates to `FileWriter`.

`repo_write_changes` is the multi-file writer and edit-pack applier. It has its own contract and handler, applies ordered changes through `FileWriter`, and inherits the same repo-local path validation, write policy, symlink, unsupported file type, UTF-8 edit target, hard-risk secret path, resulting-content secret scan, and atomic per-file write guardrails. Grouped same-file edits read one existing file, apply exact-match nested edits in memory, and write once only after every nested edit succeeds. It does not stage, commit, restore, reset, or run shell commands; Git review and recovery workflows are the safety layer after a successful edit pack.

`OperationReceiptService` writes lightweight local receipt metadata after successful actual changed write operations and reads it through `repo_last_write`. Receipts live at `.chatgpt/operations/last-write.json`, are ignored by Git, and contain only safe metadata such as repo-relative paths, counts, timestamps, best-effort HEAD SHAs, and summaries. They do not store contents, snippets, diffs, prompts, command output, secrets, or absolute paths.

Read-only Git status and diff operations are owned by `GitService`. Reviewed stage-and-commit and recovery operations are separate opt-in mutating tools with their own contracts, policy checks, and service logic.

Git recovery is separate from write tools. `repo_write_file` and `repo_write_changes` write files only. `repo_write_recover` verifies reviewed state before it unstages explicit paths, restores explicit tracked worktree paths, or cleans explicit generated artifacts through cleanup policy.

`repo_git_review` remains read-only, but it is the workflow hub after write operations. It classifies changed paths and returns ready-to-run payloads for `repo_write_stage_commit` and `repo_write_recover` without executing either operation.

The preferred mutation flow is `repo_git_review` followed by the review-provided `repo_write_stage_commit` or `repo_write_recover` payload after explicit user approval.

## Adding a Tool

Add a new tool by following the contract-first path:

1. Add input and output Zod objects under `src/contracts/*`.
2. Add the tool entry to `src/tools/contracts.ts`.
3. Add a concise `Use this when...` description in `src/tools/descriptions.ts`.
4. Add metadata and the handler reference in `src/tools/catalog.ts`.
5. Add a thin handler in `src/tools/handlers.ts`.
6. Put real logic in a service under `src/services/*`.
7. Add service tests, MCP contract coverage, tool contract discipline tests, and golden prompts when routing changes.

Do not duplicate path validation, ignore handling, secret scanning, schema definitions, or result envelope logic inside individual tools.

## Mutating Tools

Mutating tools are disabled by default per repository and must be enabled through explicit repo-local policy. `repo_write_file` can write or exact-match edit one file inside configured allowed globs and outside configured denied globs. `repo_write_changes` applies the same write/edit semantics to an ordered multi-file edit pack and supports grouped same-file exact-match edits without allowing duplicate top-level paths.

Mutating tools must stay separate from read tools. Do not loosen read services to support mutation or add broad Git automation. Workspace execution remains constrained by approved roots, execution policy, timeouts, output limits, and process-group cleanup. Cleanup tools remove only explicit generated artifacts allowed by cleanup policy.
