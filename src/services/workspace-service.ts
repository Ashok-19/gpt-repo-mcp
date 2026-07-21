import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_WORKSPACE_POLICY } from "../policies/workspace-defaults.js";
import { RepoReaderError, toRepoReaderError } from "../runtime/errors.js";
import { PathSandbox, validateRepoPath } from "./path-sandbox.js";
import { WorkspacePolicy } from "./workspace-policy.js";
import { GitService } from "./git-service.js";
import type {
  WorkspaceApplyPatchInput,
  WorkspaceDeletePathsInput,
  WorkspaceExecInput,
  WorkspaceExportFileInput,
  WorkspaceFileInfoInput,
  WorkspaceImportFileInput,
  WorkspaceMakeDirInput,
  WorkspaceRunBashInput,
  WorkspaceRunPythonInput,
  WorkspaceRunScriptInput,
  WorkspaceSaveFileInput
} from "../contracts/workspace.contract.js";

const execFileAsync = promisify(execFile);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const MUTATING_FILE_COMMANDS = new Set(["cp", "mv", "mkdir", "rm"]);
const NETWORK_COMMANDS = new Set(["ssh", "scp", "rsync", "curl", "wget", "nc", "ncat", "telnet", "ftp"]);
const SUDO_COMMANDS = new Set(["sudo", "su", "passwd"]);
const PATH_LIKE_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".json",
  ".zip",
  ".onnx",
  ".png",
  ".jpg",
  ".jpeg",
  ".sqlite",
  ".db",
  ".pkl",
  ".npy",
  ".npz",
  ".txt",
  ".csv",
  ".tsv"
]);

export class WorkspaceService {
  constructor(
    private readonly root: string,
    private readonly sandbox: PathSandbox,
    private readonly policy: WorkspacePolicy
  ) {}

  async exec(input: Omit<WorkspaceExecInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    if (!this.policy.config.exec_enabled) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "workspace_exec is disabled by configuration.");
    }
    const cwd = await this.resolveExistingDirectory(input.cwd ?? ".");
    const cmd = input.cmd;
    this.assertCommandAllowed(cmd);
    const policyCmd = this.unwrapCommandForPolicy(cmd);
    await this.assertNoOutsideAbsolutePaths(policyCmd);
    await this.assertPathLikeArgsInsideRoot(cwd.repoPath, policyCmd);
    await this.assertCommandPathEffects(cwd.repoPath, policyCmd);

    const timeoutSeconds = Math.min(
      input.timeout_seconds ?? this.policy.config.exec_default_timeout_seconds,
      this.policy.config.exec_max_timeout_seconds
    );
    const maxStdoutBytes = Math.min(input.max_stdout_bytes ?? this.policy.config.exec_max_output_bytes, this.policy.config.exec_max_output_bytes);
    const maxStderrBytes = Math.min(input.max_stderr_bytes ?? this.policy.config.exec_max_output_bytes, this.policy.config.exec_max_output_bytes);
    const started = Date.now();
    const preservation = input.preserve_tracked_worktree && !input.dry_run
      ? await this.captureTrackedState()
      : undefined;

    if (input.dry_run) {
      return {
        exit_code: 0,
        stdout: "",
        stderr: "",
        duration_ms: 0,
        timed_out: false,
        stdout_truncated: false,
        stderr_truncated: false,
        cwd: cwd.repoPath,
        resolved_cwd: cwd.absolutePath,
        cmd,
        preservation_requested: input.preserve_tracked_worktree ?? false,
        restored_tracked_paths: [],
        preservation_warnings: [],
        dry_run: true
      };
    }

    return await new Promise<{
      exit_code: number | null;
      stdout: string;
      stderr: string;
      duration_ms: number;
      timed_out: boolean;
      stdout_truncated: boolean;
      stderr_truncated: boolean;
      cwd: string;
      resolved_cwd: string;
      cmd: string[];
      preservation_requested: boolean;
      restored_tracked_paths: string[];
      preservation_warnings: string[];
    }>((resolvePromise, reject) => {
      let timedOut = false;
      const stdout = cappedCollector(maxStdoutBytes);
      const stderr = cappedCollector(maxStderrBytes);
      const child = spawn(cmd[0] ?? "", cmd.slice(1), {
        cwd: cwd.absolutePath,
        shell: false,
        detached: process.platform !== "win32",
        env: {
          PATH: process.env.PATH ?? "",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          ...input.env
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
      }, timeoutSeconds * 1000);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        reject(new RepoReaderError(missing ? "EXECUTABLE_NOT_FOUND" : "INTERNAL_ERROR", error.message, {
          diagnostics: missing ? {
            policy_stage: "execution",
            reason_code: "EXECUTABLE_NOT_FOUND",
            trigger: basename(cmd[0] ?? ""),
            mutation_occurred: false
          } : undefined
        }));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        void this.restoreNewTrackedChanges(preservation).then(({ restored, warnings }) => {
          resolvePromise({
            exit_code: code,
            stdout: stdout.text(),
            stderr: stderr.text(),
            duration_ms: Date.now() - started,
            timed_out: timedOut,
            stdout_truncated: stdout.truncated(),
            stderr_truncated: stderr.truncated(),
            cwd: cwd.repoPath,
            resolved_cwd: cwd.absolutePath,
            cmd,
            preservation_requested: input.preserve_tracked_worktree ?? false,
            restored_tracked_paths: restored,
            preservation_warnings: warnings
          });
        }).catch(reject);
      });
    });
  }

  async runPython(input: Omit<WorkspaceRunPythonInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const prepared = await this.prepareRunnableScript({
      agentId: input.agent_id,
      cwd: input.cwd ?? ".",
      inlineContent: input.code,
      scriptPath: input.script_path,
      extension: "py",
      label: "python",
      dryRun: input.dry_run
    });
    const interpreter = input.python ?? "python3";
    const result = await this.exec({
      agent_id: input.agent_id,
      cwd: input.cwd ?? ".",
      cmd: [interpreter, prepared.execPath, ...(input.args ?? [])],
      timeout_seconds: input.timeout_seconds,
      max_stdout_bytes: input.max_stdout_bytes,
      max_stderr_bytes: input.max_stderr_bytes,
      env: input.env,
      preserve_tracked_worktree: input.preserve_tracked_worktree,
      dry_run: input.dry_run,
      reason: input.reason
    });
    return await this.finishScriptRun(prepared, result, interpreter, input.dry_run);
  }

  async runBash(input: Omit<WorkspaceRunBashInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const prepared = await this.prepareRunnableScript({
      agentId: input.agent_id,
      cwd: input.cwd ?? ".",
      inlineContent: input.script,
      scriptPath: input.script_path,
      extension: "sh",
      label: "bash",
      dryRun: input.dry_run
    });
    const interpreter = input.shell ?? "bash";
    const result = await this.exec({
      agent_id: input.agent_id,
      cwd: input.cwd ?? ".",
      cmd: [interpreter, prepared.execPath, ...(input.args ?? [])],
      timeout_seconds: input.timeout_seconds,
      max_stdout_bytes: input.max_stdout_bytes,
      max_stderr_bytes: input.max_stderr_bytes,
      env: input.env,
      preserve_tracked_worktree: input.preserve_tracked_worktree,
      dry_run: input.dry_run,
      reason: input.reason
    });
    return await this.finishScriptRun(prepared, result, interpreter, input.dry_run);
  }

  async runScript(input: Omit<WorkspaceRunScriptInput, "repo_id">) {
    if ((input.script ? 1 : 0) + (input.script_path ? 1 : 0) !== 1) {
      throw new RepoReaderError("VALIDATION_ERROR", "Provide exactly one of script or script_path.");
    }
    const runtime = input.runtime ?? "py";
    if (runtime === "py") {
      return await this.runPython({
        ...input,
        code: input.script,
        python: "python3"
      });
    }
    if (runtime === "node") {
      return await this.runNode(input);
    }
    return await this.runBash({
      ...input,
      shell: "bash"
    });
  }

  async saveFile(input: Omit<WorkspaceSaveFileInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const repoPath = this.assertRepoMutablePath(input.path);
    const target = await this.resolveWriteTarget(repoPath, input.create_dirs ?? true);
    const content = decodeSaveFileData(input.data, input.encoding ?? "utf8");
    let overwritten = false;
    try {
      const existing = await lstat(target);
      if (existing.isDirectory()) {
        throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Save target is a directory: ${repoPath}`);
      }
      overwritten = true;
      if (!input.overwrite) {
        throw new RepoReaderError("WRITE_TARGET_EXISTS", `Destination already exists: ${repoPath}`);
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    if (!input.dry_run) {
      await writeFile(target, content);
    }
    return {
      ok: true as const,
      path: repoPath,
      size_bytes: content.byteLength,
      sha256: sha256(content),
      mime: guessMime(repoPath),
      overwritten,
      dry_run: input.dry_run ?? false
    };
  }

  async exportFile(input: Omit<WorkspaceExportFileInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const requestedPath = validateRepoPath(input.path);
    if (this.policy.isSecretPath(requestedPath)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${requestedPath}`);
    }
    const resolved = await this.sandbox.resolve(input.path);
    if (!resolved.stat.isFile()) {
      throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Not a regular file: ${resolved.repoPath}`);
    }
    const maxBytes = Math.min(input.max_bytes ?? this.policy.config.export_max_bytes, this.policy.config.export_max_bytes);
    if (resolved.stat.size > maxBytes) {
      throw new RepoReaderError("SIZE_LIMIT_EXCEEDED", `File exceeds max_bytes: ${resolved.repoPath}`);
    }
    const content = await readFile(resolved.absolutePath);
    const digest = sha256(content);
    const exportRoot = this.policy.config.export_dir || join(tmpdir(), "gpt-repo-mcp-exports");
    await mkdir(exportRoot, { recursive: true });
    const target = join(exportRoot, `${digest.slice(0, 16)}-${basename(resolved.repoPath)}`);
    await copyFile(resolved.absolutePath, target);
    return {
      path: resolved.repoPath,
      size_bytes: content.byteLength,
      sha256: digest,
      mime: guessMime(resolved.repoPath),
      resource_uri: `file://${target}`,
      mounted_path: target,
      warnings: []
    };
  }

  async importFile(input: Omit<WorkspaceImportFileInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const destPath = this.policy.assertWritePath(input.dest_path);
    const sourcePath = filePathFromReference(input.source_file);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Import source is not a regular file: ${input.source_file}`);
    }
    const dest = await this.resolveWriteTarget(destPath, true);
    let overwritten = false;
    try {
      const existing = await lstat(dest);
      if (existing.isDirectory()) {
        throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Import destination is a directory: ${destPath}`);
      }
      overwritten = true;
      if (!input.overwrite) {
        throw new RepoReaderError("WRITE_TARGET_EXISTS", `Destination already exists: ${destPath}`);
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    await copyFile(sourcePath, dest);
    const content = await readFile(dest);
    return {
      destination_path: destPath,
      size_bytes: content.byteLength,
      sha256: sha256(content),
      overwritten
    };
  }

  async fileInfo(input: Omit<WorkspaceFileInfoInput, "repo_id">) {
    const repoPath = validateRepoPath(input.path);
    try {
      if (this.policy.isSecretPath(repoPath)) {
        return blockedInfo(repoPath, "SECRET_CANDIDATE_BLOCKED");
      }
      const resolved = await this.sandbox.resolve(repoPath);
      const type = resolved.stat.isSymbolicLink()
        ? "symlink"
        : resolved.stat.isFile()
          ? "file"
          : resolved.stat.isDirectory()
            ? "directory"
            : "other";
      const readable = await canAccess(resolved.absolutePath, constants.R_OK);
      const writable = await canAccess(resolved.absolutePath, constants.W_OK);
      const content = input.include_hash && resolved.stat.isFile() ? await readFile(resolved.absolutePath) : undefined;
      return {
        exists: true,
        path: resolved.repoPath,
        type,
        size_bytes: Number(resolved.stat.size),
        ...(content ? { sha256: sha256(content) } : {}),
        modified_time: resolved.stat.mtime.toISOString(),
        permissions: modeSummary(Number(resolved.stat.mode)),
        ...(input.include_mime ? { mime: guessMime(resolved.repoPath) } : {}),
        readable,
        writable,
        exportable: resolved.stat.isFile() && !this.policy.isSecretPath(resolved.repoPath),
        blocked: false
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          exists: false,
          path: repoPath,
          readable: false,
          writable: false,
          exportable: false,
          blocked: false
        };
      }
      const normalized = toRepoReaderError(error);
      return {
        exists: false,
        path: repoPath,
        readable: false,
        writable: false,
        exportable: false,
        blocked: true,
        blocked_reason: normalized.code
      };
    }
  }

  async makeDir(input: Omit<WorkspaceMakeDirInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const repoPath = this.assertRepoMutablePath(input.path);
    const absolutePath = await this.resolveWriteTarget(repoPath, true);
    const existed = await exists(absolutePath);
    if (!input.dry_run && !existed) {
      await mkdir(absolutePath, { recursive: input.parents ?? true });
    }
    return {
      ok: true as const,
      path: repoPath,
      dry_run: input.dry_run ?? false,
      created: !existed
    };
  }

  async deletePaths(input: Omit<WorkspaceDeletePathsInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const dryRun = input.dry_run ?? true;
    const deleted: Array<{ path: string; type: "file" | "directory" }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    let selectedFiles = 0;
    let selectedBytes = 0;
    for (const path of input.paths) {
      let repoPath: string;
      try {
        repoPath = this.policy.assertDeletePath(path);
      } catch (error) {
        skipped.push({ path, reason: toRepoReaderError(error).code });
        continue;
      }
      try {
        const resolved = await this.sandbox.resolve(repoPath).catch((error: unknown) => {
          if (isNotFoundError(error)) return undefined;
          throw error;
        });
        if (!resolved) {
          skipped.push({ path: repoPath, reason: "NOT_FOUND" });
          continue;
        }
        if (!resolved.stat.isFile() && !resolved.stat.isDirectory()) {
          skipped.push({ path: repoPath, reason: "UNSUPPORTED_FILE_TYPE" });
          continue;
        }
        const tracked = await this.isTracked(repoPath);
        if (tracked) {
          skipped.push({ path: repoPath, reason: "CLEANUP_TRACKED_PATH" });
          continue;
        }
        const totals = await pathTotals(resolved.absolutePath);
        selectedFiles += totals.fileCount;
        selectedBytes += totals.sizeBytes;
        deleted.push({ path: repoPath, type: resolved.stat.isDirectory() ? "directory" : "file" });
        if (!dryRun) {
          await rm(resolved.absolutePath, { recursive: resolved.stat.isDirectory() });
        }
      } catch (error) {
        skipped.push({ path: repoPath, reason: toRepoReaderError(error).code });
      }
    }
    return {
      ok: true as const,
      dry_run: dryRun,
      deleted,
      skipped,
      selected_files: selectedFiles,
      selected_bytes: selectedBytes,
      deleted_files: dryRun ? 0 : selectedFiles,
      deleted_bytes: dryRun ? 0 : selectedBytes,
      warnings: []
    };
  }

  async applyPatch(input: Omit<WorkspaceApplyPatchInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    if (/^GIT binary patch$/m.test(input.patch) || /^Binary files /m.test(input.patch)) {
      throw new RepoReaderError("BINARY_FILE_REJECTED", "Binary patches are not allowed.");
    }
    const changedFiles = extractPatchPaths(input.patch);
    if (changedFiles.length === 0) {
      throw new RepoReaderError("VALIDATION_ERROR", "Patch does not contain any file paths.");
    }
    for (const path of changedFiles) {
      this.policy.assertWritePath(path);
    }
    const patchDir = join(tmpdir(), "gpt-repo-mcp-patches");
    await mkdir(patchDir, { recursive: true });
    const patchPath = join(patchDir, `patch-${process.pid}-${Date.now()}.diff`);
    await writeFile(patchPath, input.patch, "utf8");
    const args = ["apply", "--whitespace=nowarn", input.dry_run ? "--check" : patchPath].filter(Boolean);
    if (input.dry_run) {
      args.push(patchPath);
    }
    try {
      await execFileAsync("git", args, {
        cwd: this.root,
        env: { PATH: process.env.PATH ?? "" },
        maxBuffer: DEFAULT_WORKSPACE_POLICY.exec_max_output_bytes
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Patch failed";
      throw new RepoReaderError("VALIDATION_ERROR", message);
    }
    return {
      ok: true as const,
      dry_run: input.dry_run ?? false,
      changed_files: changedFiles,
      summary: input.dry_run ? `Dry run checked patch for ${changedFiles.length} files.` : `Applied patch to ${changedFiles.length} files.`,
      warnings: []
    };
  }

  policyExplain(path: string, operation: "read" | "write" | "exec" | "export" | "delete") {
    return this.policy.explain(path, operation);
  }

  private async resolveExistingDirectory(path: string): Promise<{ repoPath: string; absolutePath: string }> {
    const resolved = await this.resolveInsideRoot(path);
    const stats = await lstat(resolved.absolutePath);
    if (!stats.isDirectory()) {
      throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `cwd is not a directory: ${resolved.repoPath}`);
    }
    return resolved;
  }

  private async resolveInsideRoot(path: string): Promise<{ repoPath: string; absolutePath: string }> {
    if (isAbsolute(path)) {
      const rootReal = await realpath(this.root);
      const targetReal = await realpath(path);
      if (!isWithin(rootReal, targetReal)) {
        throw new RepoReaderError("ABSOLUTE_PATH_REJECTED", `Absolute path is outside approved repository: ${path}`);
      }
      return {
        repoPath: normalizeRelative(relative(rootReal, targetReal)),
        absolutePath: targetReal
      };
    }
    const resolved = await this.sandbox.resolve(path);
    return { repoPath: resolved.repoPath, absolutePath: resolved.absolutePath };
  }

  private async resolveWriteTarget(repoPath: string, createParents: boolean): Promise<string> {
    const parent = dirname(repoPath);
    const parentAbsolute = join(this.root, parent === "." ? "" : parent);
    if (createParents) {
      await mkdir(parentAbsolute, { recursive: true });
    }
    const rootReal = await realpath(this.root);
    const parentReal = await realpath(parentAbsolute);
    if (!isWithin(rootReal, parentReal)) {
      throw new RepoReaderError("SYMLINK_ESCAPE_REJECTED", `Path escapes approved repository: ${repoPath}`);
    }
    return join(this.root, repoPath);
  }

  private async prepareRunnableScript(input: {
    agentId?: string;
    cwd: string;
    inlineContent?: string;
    scriptPath?: string;
    extension: "py" | "sh" | "js";
    label: "python" | "bash" | "node" | "script";
    dryRun?: boolean;
  }): Promise<{ repoPath: string; execPath: string; generated: boolean }> {
    if ((input.inlineContent ? 1 : 0) + (input.scriptPath ? 1 : 0) !== 1) {
      throw new RepoReaderError("VALIDATION_ERROR", `Provide exactly one of ${input.label === "python" ? "code" : "script"} or script_path.`);
    }
    if (input.scriptPath) {
      const cwd = await this.resolveExistingDirectory(input.cwd);
      const repoPath = await this.normalizeCommandPathArg(cwd.repoPath, input.scriptPath);
      if (this.policy.isSecretPath(repoPath)) {
        throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${repoPath}`);
      }
      await this.sandbox.resolve(repoPath);
      return { repoPath, execPath: input.scriptPath, generated: false };
    }

    const agentId = input.agentId ?? `auto-${randomUUID().slice(0, 8)}`;
    const repoPath = `scratch/agents/${agentId}/workspace-runs/${Date.now()}-${randomUUID().slice(0, 8)}.${input.extension}`;
    this.policy.assertWritePath(repoPath);
    const absolutePath = input.dryRun ? join(this.root, repoPath) : await this.resolveWriteTarget(repoPath, true);
    if (!input.dryRun) {
      await writeFile(absolutePath, input.inlineContent ?? "", "utf8");
    }
    return { repoPath, execPath: absolutePath, generated: true };
  }

  private async runNode(input: Omit<WorkspaceRunScriptInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const prepared = await this.prepareRunnableScript({
      agentId: input.agent_id,
      cwd: input.cwd ?? ".",
      inlineContent: input.script,
      scriptPath: input.script_path,
      extension: "js",
      label: "node",
      dryRun: input.dry_run
    });
    const interpreter = "node";
    const result = await this.exec({
      agent_id: input.agent_id,
      cwd: input.cwd ?? ".",
      cmd: [interpreter, prepared.execPath, ...(input.args ?? [])],
      timeout_seconds: input.timeout_seconds,
      max_stdout_bytes: input.max_stdout_bytes,
      max_stderr_bytes: input.max_stderr_bytes,
      env: input.env,
      preserve_tracked_worktree: input.preserve_tracked_worktree,
      dry_run: input.dry_run,
      reason: input.reason
    });
    return await this.finishScriptRun(prepared, result, interpreter, input.dry_run);
  }

  private async finishScriptRun(
    prepared: { repoPath: string; execPath: string; generated: boolean },
    result: Awaited<ReturnType<WorkspaceService["exec"]>>,
    interpreter: string,
    dryRun?: boolean
  ) {
    const cleaned = prepared.generated && (dryRun || (result.exit_code === 0 && !result.timed_out));
    if (cleaned && !dryRun) {
      await rm(prepared.execPath, { force: true });
    }
    return {
      ...result,
      interpreter,
      script_path: prepared.repoPath,
      ...(prepared.generated && !cleaned ? { generated_script_path: prepared.repoPath } : {}),
      ...(prepared.generated ? { generated_script_cleaned: cleaned } : {})
    };
  }

  private async captureTrackedState(): Promise<{ dirty: Set<string>; tracked: Set<string> }> {
    const [status, tracked] = await Promise.all([
      new GitService(this.root).status(),
      execFileAsync("git", ["ls-files", "--", "."], {
        cwd: this.root,
        env: { PATH: process.env.PATH ?? "" },
        maxBuffer: 10 * 1024 * 1024
      })
    ]);
    return {
      dirty: new Set(status.files.flatMap((file) => [file.path, file.original_path].filter((path): path is string => Boolean(path)))),
      tracked: new Set(tracked.stdout.split("\n").filter(Boolean))
    };
  }

  private async restoreNewTrackedChanges(state?: { dirty: Set<string>; tracked: Set<string> }): Promise<{ restored: string[]; warnings: string[] }> {
    if (!state) return { restored: [], warnings: [] };
    const status = await new GitService(this.root).status();
    const warnings: string[] = [];
    const restored = status.files.filter((file) => {
      if (file.original_path) {
        warnings.push(`PRESERVE_RENAME_SKIPPED:${file.path}`);
        return false;
      }
      return state.tracked.has(file.path) && !state.dirty.has(file.path);
    }).map((file) => file.path);
    if (restored.length > 0) {
      await execFileAsync("git", ["restore", "--staged", "--worktree", "--source=HEAD", "--", ...restored], {
        cwd: this.root,
        env: { PATH: process.env.PATH ?? "" }
      });
    }
    return { restored, warnings };
  }

  private assertRepoMutablePath(path: string): string {
    const repoPath = validateRepoPath(path);
    if (repoPath === ".") {
      throw new RepoReaderError("WRITE_NOT_ALLOWED_GLOB", "Repository root is not a file target.");
    }
    if (repoPath === ".git" || repoPath.startsWith(".git/")) {
      throw new RepoReaderError("WRITE_NOT_ALLOWED_GLOB", `Git internals are not writable through workspace tools: ${repoPath}`);
    }
    return repoPath;
  }

  private assertCommandAllowed(cmd: string[], depth = 0): void {
    if (depth > 3) {
      throw new RepoReaderError("VALIDATION_ERROR", "Nested command wrappers are too deep.");
    }
    const exe = basename(cmd[0] ?? "");
    if (!exe) {
      throw new RepoReaderError("VALIDATION_ERROR", "cmd must contain an executable.");
    }
    if (this.policy.config.exec_block_sudo && SUDO_COMMANDS.has(exe)) {
      this.rejectCommand("ADMIN_COMMAND_BLOCKED", exe, `Command is blocked: ${exe}`, "Run without sudo or ask the user to run the administrative command outside MCP.");
    }
    if (this.policy.config.exec_block_network && NETWORK_COMMANDS.has(exe)) {
      this.rejectCommand("NETWORK_COMMAND_BLOCKED", exe, `Network command is blocked: ${exe}`);
    }
    if (exe === "git") {
      const subcommand = cmd.find((arg, index) => index > 0 && !arg.startsWith("-"));
      const blocked = new Set(["push", "reset", "clean", "checkout", "switch"]);
      if (subcommand && blocked.has(subcommand)) {
        this.rejectCommand("GIT_SUBCOMMAND_BLOCKED", subcommand, `Git subcommand is blocked: ${subcommand}`);
      }
    }
    if (exe === "timeout") {
      this.assertCommandAllowed(parseTimeoutWrappedCommand(cmd), depth + 1);
    }
    if (exe === "bash" || exe === "sh") {
      if (cmd[1] === "-lc") {
        if (cmd.length !== 3) {
          this.rejectCommand("SHELL_WRAPPER_INVALID", `${exe} -lc`, `${exe} -lc must contain exactly one simple command string.`, "Pass a direct argv command to workspace_exec.");
        }
        this.assertCommandAllowed(splitSimpleShellCommand(cmd[2] ?? ""), depth + 1);
      } else if (cmd.includes("-c") || cmd.length < 2 || cmd[1]?.startsWith("-")) {
        this.rejectCommand("SHELL_WRAPPER_INVALID", exe, `${exe} may only run an explicit local script file or a checked -lc command.`, "Use workspace_run_script for inline scripts.");
      }
    }
    if (cmd.some((arg) => arg.includes("\0"))) {
      throw new RepoReaderError("VALIDATION_ERROR", "NUL bytes are not allowed in cmd.");
    }
    if (cmd.length === 1 && /[\s;&|`$<>]/.test(cmd[0] ?? "")) {
      this.rejectCommand("SHELL_COMMAND_STRING_BLOCKED", cmd[0] ?? "", "Shell command strings are not allowed; pass an argv array.", "Pass executable and arguments as separate cmd items.");
    }
    if (/[\s;&|`$<>]/.test(cmd[0] ?? "")) {
      this.rejectCommand("EXECUTABLE_NAME_INVALID", cmd[0] ?? "", "Executable name is not allowed.");
    }
    if (cmd.join(" ") === "rm -rf /") {
      this.rejectCommand("DANGEROUS_DELETE_BLOCKED", "rm -rf /", "Dangerous rm command is blocked.");
    }
  }

  private rejectCommand(reasonCode: string, trigger: string, message: string, allowedAlternative?: string): never {
    throw commandPolicyError(reasonCode, trigger, message, allowedAlternative);
  }

  private async assertNoOutsideAbsolutePaths(cmd: string[]): Promise<void> {
    const rootReal = await realpath(this.root);
    for (const arg of cmd) {
      if (isAbsolute(arg)) {
        const candidate = await realpath(arg).catch(() => resolve(arg));
        if (!isWithin(rootReal, candidate)) {
          throw new RepoReaderError("ABSOLUTE_PATH_REJECTED", `Absolute path is outside approved repository: ${arg}`);
        }
      }
    }
  }

  private async assertPathLikeArgsInsideRoot(cwdRepoPath: string, cmd: string[]): Promise<void> {
    for (const arg of cmd.slice(1)) {
      if (!isPathLikeArg(arg)) {
        continue;
      }
      const repoPath = await this.normalizeCommandPathArg(cwdRepoPath, arg);
      const absolutePath = join(this.root, repoPath);
      try {
        const rootReal = await realpath(this.root);
        const targetReal = await realpath(absolutePath);
        if (!isWithin(rootReal, targetReal)) {
          throw new RepoReaderError("SYMLINK_ESCAPE_REJECTED", `Path argument escapes approved repository: ${repoPath}`);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  private async assertCommandPathEffects(cwdRepoPath: string, cmd: string[]): Promise<void> {
    const exe = basename(cmd[0] ?? "");
    if (exe === "bash" || exe === "sh") {
      const script = cmd[1] ?? "";
      const repoPath = await this.normalizeCommandPathArg(cwdRepoPath, script);
      await this.sandbox.resolve(repoPath);
    }
    if (!MUTATING_FILE_COMMANDS.has(exe)) {
      return;
    }
    const pathArgs = cmd.slice(1).filter((arg) => !arg.startsWith("-"));
    if (pathArgs.length === 0) {
      throw new RepoReaderError("VALIDATION_ERROR", `${exe} requires at least one explicit path.`);
    }
    if (exe === "cp" && pathArgs.length < 2) {
      throw new RepoReaderError("VALIDATION_ERROR", "cp requires at least one source and one destination.");
    }
    if (exe === "cp") {
      for (const source of pathArgs.slice(0, -1)) {
        const sourcePath = await this.normalizeCommandPathArg(cwdRepoPath, source);
        await this.sandbox.resolve(sourcePath);
      }
      this.assertRepoMutablePath(await this.normalizeCommandPathArg(cwdRepoPath, pathArgs[pathArgs.length - 1] ?? ""));
      return;
    }
    for (const arg of pathArgs) {
      const repoPath = await this.normalizeCommandPathArg(cwdRepoPath, arg);
      if (arg === "/" || arg === "." || repoPath === ".") {
        throw commandPolicyError("UNSAFE_MUTATION_TARGET", arg, `Unsafe ${exe} target rejected: ${arg}`);
      }
      this.assertRepoMutablePath(repoPath);
    }
  }

  private unwrapCommandForPolicy(cmd: string[], depth = 0): string[] {
    if (depth > 3) {
      throw new RepoReaderError("VALIDATION_ERROR", "Nested command wrappers are too deep.");
    }
    const exe = basename(cmd[0] ?? "");
    if (exe === "timeout") {
      return this.unwrapCommandForPolicy(parseTimeoutWrappedCommand(cmd), depth + 1);
    }
    if ((exe === "bash" || exe === "sh") && cmd[1] === "-lc") {
      return this.unwrapCommandForPolicy(splitSimpleShellCommand(cmd[2] ?? ""), depth + 1);
    }
    return cmd;
  }

  private async normalizeCommandPathArg(cwdRepoPath: string, arg: string): Promise<string> {
    if (hasTraversalSegment(arg)) {
      throw new RepoReaderError("PATH_TRAVERSAL_REJECTED", `Path traversal is not allowed: ${arg}`);
    }
    if (isAbsolute(arg)) {
      const rootReal = await realpath(this.root);
      const candidate = await realpath(arg).catch(() => resolve(arg));
      if (!isWithin(rootReal, candidate)) {
        throw new RepoReaderError("ABSOLUTE_PATH_REJECTED", `Absolute path is outside approved repository: ${arg}`);
      }
      return normalizeRelative(relative(rootReal, candidate));
    }
    return validateRepoPath(cwdRepoPath === "." ? arg : `${cwdRepoPath}/${arg}`);
  }

  private async isTracked(repoPath: string): Promise<boolean> {
    try {
      const result = await execFileAsync("git", ["ls-files", "--", repoPath], {
        cwd: this.root,
        env: { PATH: process.env.PATH ?? "" },
        maxBuffer: 128 * 1024
      });
      return result.stdout.split("\n").filter(Boolean).length > 0;
    } catch {
      return false;
    }
  }
}

function cappedCollector(maxBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let wasTruncated = false;
  return {
    push(chunk: Buffer) {
      if (bytes >= maxBytes) {
        wasTruncated = true;
        return;
      }
      const remaining = maxBytes - bytes;
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        bytes += remaining;
        wasTruncated = true;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.byteLength;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
    truncated() {
      return wasTruncated;
    }
  };
}

function commandPolicyError(reasonCode: string, trigger: string, message: string, allowedAlternative?: string): RepoReaderError {
  return new RepoReaderError("EXECUTION_POLICY_REJECTED", message, {
    diagnostics: {
      policy_stage: "pre_execution",
      reason_code: reasonCode,
      trigger,
      ...(allowedAlternative ? { allowed_alternative: allowedAlternative, safe_alternative: allowedAlternative } : {}),
      mutation_occurred: false
    }
  });
}

function killProcessTree(pid?: number): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      process.kill(pid);
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Process may already have exited.
  }
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function decodeSaveFileData(data: string, encoding: "utf8" | "base64" | "hex"): Buffer {
  if (encoding === "utf8") {
    return Buffer.from(data, "utf8");
  }
  if (encoding === "hex") {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(data)) {
      throw new RepoReaderError("VALIDATION_ERROR", "hex data must contain an even number of hexadecimal characters.");
    }
    return Buffer.from(data, "hex");
  }
  return Buffer.from(data, "base64");
}

function isPathLikeArg(arg: string): boolean {
  if (arg.length === 0 || arg.startsWith("-") || /^[a-z]+:\/\//i.test(arg)) {
    return false;
  }
  return arg.startsWith(".")
    || arg.includes("/")
    || PATH_LIKE_EXTENSIONS.has(extname(arg).toLowerCase());
}

function parseTimeoutWrappedCommand(cmd: string[]): string[] {
  let index = 1;
  while (index < cmd.length) {
    const arg = cmd[index] ?? "";
    if (arg === "--") {
      index += 1;
      break;
    }
    if (arg === "--foreground" || arg === "--preserve-status" || arg === "--verbose") {
      index += 1;
      continue;
    }
    if (arg === "-s" || arg === "--signal" || arg === "-k" || arg === "--kill-after") {
      index += 2;
      continue;
    }
    if (arg.startsWith("--signal=") || arg.startsWith("--kill-after=")) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw commandPolicyError("TIMEOUT_OPTION_UNSUPPORTED", arg, `Unsupported timeout option: ${arg}`);
    }
    index += 1;
    break;
  }
  const wrapped = cmd.slice(index);
  if (wrapped.length === 0) {
    throw new RepoReaderError("VALIDATION_ERROR", "timeout requires a wrapped command.");
  }
  return wrapped;
}

function splitSimpleShellCommand(command: string): string[] {
  if (command.trim().length === 0) {
    throw new RepoReaderError("VALIDATION_ERROR", "Shell command string must not be empty.");
  }
  if (/[\0\r\n;&|`$<>]/.test(command)) {
    throw commandPolicyError("SHELL_CONTROL_OPERATOR_BLOCKED", command, "Shell control operators and substitutions are blocked.", "Pass a direct argv command to workspace_exec.");
  }
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (char === "\\") {
      throw commandPolicyError("SHELL_ESCAPE_BLOCKED", "\\", "Backslash escaping is not allowed in shell command strings.", "Pass a direct argv command to workspace_exec.");
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    throw new RepoReaderError("VALIDATION_ERROR", "Unterminated shell quote.");
  }
  if (current.length > 0) {
    args.push(current);
  }
  if (args.length === 0) {
    throw new RepoReaderError("VALIDATION_ERROR", "Shell command string must contain an executable.");
  }
  return args;
}

function hasTraversalSegment(path: string): boolean {
  return path.replaceAll("\\", "/").split("/").includes("..");
}

function isWithin(rootPath: string, targetPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function normalizeRelative(path: string): string {
  const normalized = path.replaceAll(sep, "/");
  return normalized.length === 0 ? "." : normalized;
}

function filePathFromReference(reference: string): string {
  if (reference.startsWith("file://")) {
    return new URL(reference).pathname;
  }
  return reference;
}

function guessMime(path: string): string {
  const ext = extname(path).toLowerCase();
  if ([".txt", ".md", ".ts", ".js", ".json", ".html", ".css", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h"].includes(ext)) return "text/plain";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".zip") return "application/zip";
  if (ext === ".sqlite" || ext === ".db") return "application/vnd.sqlite3";
  if (ext === ".onnx") return "application/octet-stream";
  if (ext === ".tar") return "application/x-tar";
  if (ext === ".gz") return "application/gzip";
  return "application/octet-stream";
}

function modeSummary(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function blockedInfo(path: string, reason: string) {
  return {
    exists: false,
    path,
    readable: false,
    writable: false,
    exportable: false,
    blocked: true,
    blocked_reason: reason
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function pathTotals(path: string): Promise<{ fileCount: number; sizeBytes: number }> {
  const entry = await lstat(path);
  if (!entry.isDirectory()) return { fileCount: 1, sizeBytes: entry.size };
  let fileCount = 0;
  let sizeBytes = 0;
  for (const child of await readdir(path)) {
    const totals = await pathTotals(join(path, child));
    fileCount += totals.fileCount;
    sizeBytes += totals.sizeBytes;
  }
  return { fileCount, sizeBytes };
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("+++ ") && !line.startsWith("--- ")) continue;
    const raw = line.slice(4).trim().split(/\t/)[0] ?? "";
    if (raw === "/dev/null") continue;
    const path = raw.replace(/^a\//, "").replace(/^b\//, "");
    paths.add(validateRepoPath(path));
  }
  return [...paths].sort();
}

export function decodeUtf8ForWorkspace(content: Buffer, repoPath: string): string {
  try {
    return textDecoder.decode(content);
  } catch {
    throw new RepoReaderError("BINARY_FILE_REJECTED", `Non-text file blocked: ${repoPath}. Use workspace_create_file_artifact for file artifacts.`);
  }
}
