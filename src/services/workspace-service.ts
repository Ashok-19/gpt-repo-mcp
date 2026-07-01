import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_WORKSPACE_POLICY } from "../policies/workspace-defaults.js";
import { RepoReaderError, toRepoReaderError } from "../runtime/errors.js";
import { PathSandbox, validateRepoPath } from "./path-sandbox.js";
import { WorkspacePolicy } from "./workspace-policy.js";
import type {
  WorkspaceApplyPatchInput,
  WorkspaceDeletePathsInput,
  WorkspaceExecInput,
  WorkspaceExportFileInput,
  WorkspaceFileInfoInput,
  WorkspaceImportFileInput,
  WorkspaceMakeDirInput,
  WorkspaceRunBashInput,
  WorkspaceRunPythonInput
} from "../contracts/workspace.contract.js";

const execFileAsync = promisify(execFile);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const MUTATING_FILE_COMMANDS = new Set(["cp", "mv", "mkdir", "rm"]);
const NETWORK_COMMANDS = new Set(["ssh", "scp", "rsync", "curl", "wget", "nc", "ncat", "telnet", "ftp"]);
const SUDO_COMMANDS = new Set(["sudo", "su", "passwd"]);
const GENERIC_ALLOWED = new Set([
  "python",
  "python3",
  "python3.12",
  "node",
  "npm",
  "npx",
  "bash",
  "sh",
  "ls",
  "find",
  "stat",
  "du",
  "cat",
  "head",
  "tail",
  "grep",
  "sed",
  "awk",
  "cp",
  "mv",
  "mkdir",
  "rm",
  "zip",
  "unzip",
  "tar",
  "git",
  "timeout"
]);
const GIT_ALLOWED = new Set(["status", "diff", "log", "rev-parse"]);
const NPM_BLOCKED = new Set(["install", "i", "add", "update", "upgrade", "publish", "audit", "fund", "login"]);
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
    await this.assertCommandPathEffects(cwd.repoPath, policyCmd, input.agent_id);

    const timeoutSeconds = Math.min(
      input.timeout_seconds ?? this.policy.config.exec_default_timeout_seconds,
      this.policy.config.exec_max_timeout_seconds
    );
    const maxStdoutBytes = Math.min(input.max_stdout_bytes ?? this.policy.config.exec_max_output_bytes, this.policy.config.exec_max_output_bytes);
    const maxStderrBytes = Math.min(input.max_stderr_bytes ?? this.policy.config.exec_max_output_bytes, this.policy.config.exec_max_output_bytes);
    const started = Date.now();

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
        cmd,
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
      cmd: string[];
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
        reject(new RepoReaderError("INTERNAL_ERROR", error.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolvePromise({
          exit_code: code,
          stdout: stdout.text(),
          stderr: stderr.text(),
          duration_ms: Date.now() - started,
          timed_out: timedOut,
          stdout_truncated: stdout.truncated(),
          stderr_truncated: stderr.truncated(),
          cwd: cwd.repoPath,
          cmd
        });
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
      label: "python"
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
      dry_run: input.dry_run,
      reason: input.reason
    });
    return {
      ...result,
      interpreter,
      script_path: prepared.repoPath,
      ...(prepared.generated ? { generated_script_path: prepared.repoPath } : {})
    };
  }

  async runBash(input: Omit<WorkspaceRunBashInput, "repo_id">) {
    this.policy.assertReason(input.reason);
    const prepared = await this.prepareRunnableScript({
      agentId: input.agent_id,
      cwd: input.cwd ?? ".",
      inlineContent: input.script,
      scriptPath: input.script_path,
      extension: "sh",
      label: "bash"
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
      dry_run: input.dry_run,
      reason: input.reason
    });
    return {
      ...result,
      interpreter,
      script_path: prepared.repoPath,
      ...(prepared.generated ? { generated_script_path: prepared.repoPath } : {})
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
    const repoPath = this.policy.assertWritePath(input.path);
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
        deleted.push({ path: repoPath, type: resolved.stat.isDirectory() ? "directory" : "file" });
        if (!dryRun) {
          await rm(resolved.absolutePath, { recursive: resolved.stat.isDirectory() });
        }
      } catch (error) {
        skipped.push({ path: repoPath, reason: toRepoReaderError(error).code });
      }
    }
    return { ok: true as const, dry_run: dryRun, deleted, skipped, warnings: [] };
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
    extension: "py" | "sh";
    label: "python" | "bash";
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
    const absolutePath = await this.resolveWriteTarget(repoPath, true);
    await writeFile(absolutePath, input.inlineContent ?? "", "utf8");
    return { repoPath, execPath: absolutePath, generated: true };
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
      throw new RepoReaderError("OPERATIONS_DISABLED", `Command is blocked: ${exe}`);
    }
    if (this.policy.config.exec_block_network && NETWORK_COMMANDS.has(exe)) {
      throw new RepoReaderError("OPERATIONS_DISABLED", `Network command is blocked: ${exe}`);
    }
    if (!GENERIC_ALLOWED.has(exe) && !isRepoLocalExecutable(cmd[0] ?? "")) {
      throw new RepoReaderError("OPERATIONS_DISABLED", `Command family is not allowed: ${exe}`);
    }
    if (exe === "git") {
      const subcommand = cmd.find((arg, index) => index > 0 && !arg.startsWith("-"));
      if (!subcommand || !GIT_ALLOWED.has(subcommand)) {
        throw new RepoReaderError("OPERATIONS_DISABLED", `Git subcommand is blocked: ${subcommand ?? ""}`);
      }
    }
    if (exe === "npm" && cmd.some((arg, index) => index > 0 && NPM_BLOCKED.has(arg))) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "npm network/install commands are blocked.");
    }
    if (exe === "npx" && !cmd.includes("--no-install") && !cmd.includes("--offline")) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "npx requires --no-install or --offline.");
    }
    if (exe === "timeout") {
      this.assertCommandAllowed(parseTimeoutWrappedCommand(cmd), depth + 1);
    }
    if (exe === "bash" || exe === "sh") {
      if (cmd[1] === "-lc") {
        if (cmd.length !== 3) {
          throw new RepoReaderError("OPERATIONS_DISABLED", `${exe} -lc must contain exactly one simple command string.`);
        }
        this.assertCommandAllowed(splitSimpleShellCommand(cmd[2] ?? ""), depth + 1);
      } else if (cmd.includes("-c") || cmd.length < 2 || cmd[1]?.startsWith("-")) {
        throw new RepoReaderError("OPERATIONS_DISABLED", `${exe} may only run an explicit local script file or a checked -lc command.`);
      }
    }
    if (cmd.some((arg) => arg.includes("\0"))) {
      throw new RepoReaderError("VALIDATION_ERROR", "NUL bytes are not allowed in cmd.");
    }
    if (cmd.length === 1 && /[\s;&|`$<>]/.test(cmd[0] ?? "")) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "Shell command strings are not allowed; pass an argv array.");
    }
    if (/[\s;&|`$<>]/.test(cmd[0] ?? "")) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "Executable name is not allowed.");
    }
    if (cmd.join(" ") === "rm -rf /") {
      throw new RepoReaderError("OPERATIONS_DISABLED", "Dangerous rm command is blocked.");
    }
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
      if (this.policy.isSecretPath(repoPath)) {
        throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${repoPath}`);
      }
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

  private async assertCommandPathEffects(cwdRepoPath: string, cmd: string[], agentId?: string): Promise<void> {
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
        if (this.policy.isSecretPath(sourcePath)) {
          throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${sourcePath}`);
        }
        await this.sandbox.resolve(sourcePath);
      }
      this.policy.assertWritePath(await this.normalizeCommandPathArg(cwdRepoPath, pathArgs[pathArgs.length - 1] ?? ""));
      return;
    }
    for (const arg of pathArgs) {
      const repoPath = await this.normalizeCommandPathArg(cwdRepoPath, arg);
      if (arg === "/" || arg === "." || repoPath === ".") {
        throw new RepoReaderError("OPERATIONS_DISABLED", `Unsafe ${exe} target rejected: ${arg}`);
      }
      if (exe === "rm") {
        this.assertAgentScratchPath(repoPath, agentId);
      } else {
        this.policy.assertWritePath(repoPath);
      }
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

  private assertAgentScratchPath(repoPath: string, agentId?: string): void {
    if (!agentId) {
      throw new RepoReaderError("OPERATIONS_DISABLED", "rm through workspace_exec requires agent_id and is limited to that agent scratch directory.");
    }
    const agentRoot = `scratch/agents/${agentId}`;
    if (repoPath === agentRoot || !repoPath.startsWith(`${agentRoot}/`)) {
      throw new RepoReaderError("WRITE_NOT_ALLOWED_GLOB", `rm is limited to ${agentRoot}/ paths.`);
    }
    this.policy.assertDeletePath(repoPath);
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

function isRepoLocalExecutable(command: string): boolean {
  return command.startsWith("./") || command.startsWith("../") || command.includes("/");
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
      throw new RepoReaderError("OPERATIONS_DISABLED", `Unsupported timeout option: ${arg}`);
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
    throw new RepoReaderError("OPERATIONS_DISABLED", "Shell control operators and substitutions are blocked.");
  }
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (char === "\\") {
      throw new RepoReaderError("OPERATIONS_DISABLED", "Backslash escaping is not allowed in shell command strings.");
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
