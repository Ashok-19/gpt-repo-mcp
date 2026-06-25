import ignore from "ignore";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WORKSPACE_POLICY } from "../policies/workspace-defaults.js";
import { RepoReaderError } from "../runtime/errors.js";
import { IgnoreEngine } from "./ignore-engine.js";
import { validateRepoPath } from "./path-sandbox.js";

export type WorkspacePolicyConfig = Partial<typeof DEFAULT_WORKSPACE_POLICY>;

export type EffectiveWorkspacePolicy = typeof DEFAULT_WORKSPACE_POLICY;

export class WorkspacePolicy {
  readonly config: EffectiveWorkspacePolicy;
  private readonly writeMatcher = ignore();
  private readonly deleteMatcher = ignore();
  private readonly ignoreEngine = new IgnoreEngine();

  constructor(config: WorkspacePolicyConfig = {}) {
    this.config = {
      ...DEFAULT_WORKSPACE_POLICY,
      ...config,
      exec_write_allowed_globs: config.exec_write_allowed_globs ?? [...DEFAULT_WORKSPACE_POLICY.exec_write_allowed_globs],
      exec_allowed_roots: config.exec_allowed_roots ?? [...DEFAULT_WORKSPACE_POLICY.exec_allowed_roots],
      delete_allowed_globs: config.delete_allowed_globs ?? [...DEFAULT_WORKSPACE_POLICY.delete_allowed_globs]
    };
    this.writeMatcher.add(this.config.exec_write_allowed_globs);
    this.deleteMatcher.add(this.config.delete_allowed_globs);
  }

  assertReason(reason?: string): void {
    if (this.config.exec_require_reason && (!reason || reason.trim().length === 0)) {
      throw new RepoReaderError("VALIDATION_ERROR", "reason is required by workspace policy.");
    }
  }

  assertWritePath(path: string): string {
    const repoPath = validateRepoPath(path);
    if (this.isSecretPath(repoPath)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${repoPath}`);
    }
    if (!this.writeMatcher.ignores(repoPath) && !this.writeMatcher.ignores(`${repoPath}/placeholder`)) {
      throw new RepoReaderError("WRITE_NOT_ALLOWED_GLOB", `Path is outside workspace write globs: ${repoPath}`);
    }
    return repoPath;
  }

  assertDeletePath(path: string): string {
    const repoPath = validateRepoPath(path);
    if (repoPath === "." || /[*?[\]{}]/.test(repoPath) || repoPath.startsWith("-")) {
      throw new RepoReaderError("CLEANUP_UNSAFE_PATH", `Unsafe delete path rejected: ${path}`);
    }
    if (this.isSecretPath(repoPath)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${repoPath}`);
    }
    if (!this.deleteMatcher.ignores(repoPath) && !this.deleteMatcher.ignores(`${repoPath}/placeholder`)) {
      throw new RepoReaderError("CLEANUP_NOT_ALLOWED_GLOB", `Path is outside workspace delete globs: ${repoPath}`);
    }
    return repoPath;
  }

  isSecretPath(path: string): boolean {
    const repoPath = validateRepoPath(path);
    const lower = repoPath.toLowerCase();
    return this.ignoreEngine.isSensitiveCandidate(repoPath)
      || lower === ".ssh"
      || lower.startsWith(".ssh/")
      || lower.endsWith("/.ssh")
      || lower.includes("/.ssh/")
      || lower.split("/").includes("credentials")
      || lower.split("/").includes("credential")
      || lower.endsWith("/credentials.json")
      || lower.endsWith("/credential.json");
  }

  explain(path: string, operation: "read" | "write" | "exec" | "export" | "delete") {
    const repoPath = validateRepoPath(path || ".");
    const secret = this.isSecretPath(repoPath);
    const matchedAllowGlobs = operation === "delete"
      ? this.config.delete_allowed_globs.filter((glob) => ignore().add(glob).ignores(repoPath) || ignore().add(glob).ignores(`${repoPath}/placeholder`))
      : operation === "write"
        ? this.config.exec_write_allowed_globs.filter((glob) => ignore().add(glob).ignores(repoPath) || ignore().add(glob).ignores(`${repoPath}/placeholder`))
        : ["approved-repo-root"];
    const writeLike = operation === "write" || operation === "delete";
    const allowed = !secret && (!writeLike || matchedAllowGlobs.length > 0);
    return {
      allowed,
      matched_allow_globs: matchedAllowGlobs,
      matched_deny_globs: secret ? ["secret-path-patterns"] : [],
      reason: allowed ? `${operation} is allowed for this approved repo-local path.` : `${operation} is blocked for this path by workspace policy.`,
      next_step: allowed ? `Use ${suggestedTool(operation)}.` : "Choose a non-secret approved repo-local path, or use an allowed scratch/experiment path for writes and cleanup.",
      suggested_tool: suggestedTool(operation)
    };
  }

  async canWriteAbsolute(root: string, repoPath: string): Promise<boolean> {
    try {
      this.assertWritePath(repoPath);
      await access(join(root, repoPath.split("/").slice(0, -1).join("/") || "."), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function suggestedTool(operation: "read" | "write" | "exec" | "export" | "delete"): string {
  if (operation === "exec") return "workspace_exec";
  if (operation === "export") return "workspace_create_file_artifact";
  if (operation === "delete") return "workspace_cleanup_paths";
  if (operation === "write") return "workspace_write_file";
  return "workspace_file_info";
}
