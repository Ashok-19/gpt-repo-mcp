import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRepoFixture } from "./fixtures/repo-fixture.js";
import { RootRegistry } from "../src/services/root-registry.js";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { RepoTreeService } from "../src/services/repo-tree-service.js";
import { WorkspacePolicy } from "../src/services/workspace-policy.js";
import { WorkspaceService } from "../src/services/workspace-service.js";
import {
  workspaceAcquireOfficialLockHandler,
  workspaceAgentSessionHandler,
  workspaceClaimTaskHandler,
  workspaceCreateFileArtifactHandler,
  workspaceExecHandler,
  workspaceFileInfoHandler,
  workspacePolicyExplainHandler,
  workspaceReleaseOfficialLockHandler,
  workspaceReleaseTaskHandler,
  workspaceWriteFileHandler
} from "../src/tools/handlers.js";
import type { RuntimeContext } from "../src/runtime/context.js";

const execFileAsync = promisify(execFile);

async function workspace(root: string): Promise<WorkspaceService> {
  const registry = await RootRegistry.fromConfig({
    repos: [{ repo_id: "repo", display_name: "Repo", root }],
    workspace: { exec_require_reason: true }
  });
  return new WorkspaceService(root, new PathSandbox(root), new WorkspacePolicy(registry.workspace));
}

async function context(root: string): Promise<RuntimeContext> {
  return {
    registry: await RootRegistry.fromConfig({
      repos: [{ repo_id: "repo", display_name: "Repo", root }],
      workspace: { exec_require_reason: true }
    })
  };
}

describe("WorkspaceService", () => {
  test("runs allowed commands inside the approved repo", async () => {
    const fixture = await createRepoFixture();
    const result = await (await workspace(fixture.root)).exec({
      cwd: ".",
      cmd: ["python3", "--version"],
      reason: "Check local Python"
    });

    expect(result.exit_code).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Python/);
    expect(result.cwd).toBe(".");
    expect(result.resolved_cwd).toBe(fixture.root);
  });

  test("runs repo-local validation script from a task directory", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "task349"), { recursive: true });
    await writeFile(join(fixture.root, "task349", "validate_task.py"), "import sys\nprint('quick' if '--quick' in sys.argv else 'full')\n");

    const result = await (await workspace(fixture.root)).exec({
      cwd: "task349",
      cmd: ["python3", "validate_task.py", "--quick"],
      timeout_seconds: 1200,
      max_stdout_bytes: 20000,
      max_stderr_bytes: 20000,
      reason: "Run repo-local validation"
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("quick");
  });

  test("runs scratch helper with repo-relative data arguments", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "scratch", "run1"), { recursive: true });
    await mkdir(join(fixture.root, "task349", "task"), { recursive: true });
    await writeFile(join(fixture.root, "task349", "task", "task349.onnx"), Buffer.from([1, 2, 3]));
    await writeFile(join(fixture.root, "scratch", "run1", "check_model.py"), "import sys\nprint('|'.join(sys.argv[1:]))\n");

    const result = await (await workspace(fixture.root)).exec({
      cwd: ".",
      cmd: ["python3", "scratch/run1/check_model.py", "task349", "task349/task/task349.onnx", "--fresh-n", "0"],
      timeout_seconds: 1200,
      max_stdout_bytes: 20000,
      max_stderr_bytes: 20000,
      reason: "Run scratch helper"
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("task349/task/task349.onnx");
  });

  test("allows approved shell wrappers and timeout after recursive command checks", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    const python312DryRun = await service.exec({
      cwd: ".",
      cmd: ["python3.12", "--version"],
      dry_run: true,
      reason: "Validate python3.12 command family"
    });
    expect(python312DryRun).toMatchObject({ dry_run: true });

    const bash = await service.exec({
      cwd: ".",
      cmd: ["bash", "-lc", "python3 -c 'print(123)'"],
      reason: "Run checked bash shell wrapper"
    });
    expect(bash.exit_code).toBe(0);
    expect(bash.stdout).toContain("123");

    const sh = await service.exec({
      cwd: ".",
      cmd: ["sh", "-lc", "cat docs/guide.md"],
      reason: "Run checked sh shell wrapper"
    });
    expect(sh.exit_code).toBe(0);
    expect(sh.stdout).toContain("Guide");

    const wrapped = await service.exec({
      cwd: ".",
      cmd: ["timeout", "5", "python3", "--version"],
      reason: "Run timeout wrapper"
    });
    expect(wrapped.exit_code).toBe(0);
    expect(`${wrapped.stdout}${wrapped.stderr}`).toMatch(/Python/);
  });

  test("allows cp and mv into scratch while limiting rm to the matching agent scratch", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);
    await mkdir(join(fixture.root, "scratch", "agents", "agent-a", "task001"), { recursive: true });

    const copied = await service.exec({
      agent_id: "agent-a",
      cwd: ".",
      cmd: ["cp", "docs/guide.md", "scratch/agents/agent-a/task001/readme-copy.md"],
      reason: "Copy fixture into agent scratch"
    });
    expect(copied.exit_code).toBe(0);
    await expect(readFile(join(fixture.root, "scratch", "agents", "agent-a", "task001", "readme-copy.md"), "utf8")).resolves.toContain("Guide");

    const moved = await service.exec({
      agent_id: "agent-a",
      cwd: ".",
      cmd: ["mv", "scratch/agents/agent-a/task001/readme-copy.md", "scratch/agents/agent-a/task001/readme-moved.md"],
      reason: "Move fixture inside agent scratch"
    });
    expect(moved.exit_code).toBe(0);
    await expect(readFile(join(fixture.root, "scratch", "agents", "agent-a", "task001", "readme-moved.md"), "utf8")).resolves.toContain("Guide");

    const removed = await service.exec({
      agent_id: "agent-a",
      cwd: "scratch/agents/agent-a/task001",
      cmd: ["rm", "readme-moved.md"],
      reason: "Remove own agent scratch file"
    });
    expect(removed.exit_code).toBe(0);
    await expect(readFile(join(fixture.root, "scratch", "agents", "agent-a", "task001", "readme-moved.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("runs Python and shell experiments through scratch-backed script runners", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    const python = await service.runPython({
      agent_id: "agent-a",
      cwd: ".",
      code: "from pathlib import Path\nPath('scratch/agents/agent-a/task001').mkdir(parents=True, exist_ok=True)\nPath('scratch/agents/agent-a/task001/model.onnx').write_bytes(b'ONNX')\nprint('python-ok')\n",
      timeout_seconds: 30,
      reason: "Run inline Python experiment"
    });
    expect(python.exit_code).toBe(0);
    expect(python.stdout).toContain("python-ok");
    expect(python.generated_script_cleaned).toBe(true);
    expect(python.generated_script_path).toBeUndefined();
    await expect(readFile(join(fixture.root, python.script_path))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.root, "scratch", "agents", "agent-a", "task001", "model.onnx"))).resolves.toEqual(Buffer.from("ONNX"));

    const shell = await service.runBash({
      agent_id: "agent-a",
      cwd: ".",
      script: "mkdir -p scratch/agents/agent-a/task001\nprintf shell-ok > scratch/agents/agent-a/task001/out.txt\ncat scratch/agents/agent-a/task001/out.txt\n",
      timeout_seconds: 30,
      reason: "Run inline shell experiment"
    });
    expect(shell.exit_code).toBe(0);
    expect(shell.stdout).toContain("shell-ok");
    expect(shell.generated_script_cleaned).toBe(true);
    expect(shell.generated_script_path).toBeUndefined();

    const neutral = await service.runScript({
      agent_id: "agent-a",
      cwd: ".",
      runtime: "py",
      script: "print('neutral-ok')\n",
      timeout_seconds: 30,
      reason: "Run neutral script experiment"
    });
    expect(neutral.exit_code).toBe(0);
    expect(neutral.stdout).toContain("neutral-ok");
    expect(neutral.generated_script_cleaned).toBe(true);
  });

  test("does not materialize dry-run wrappers and retains failed wrappers", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);
    const dryRun = await service.runScript({
      runtime: "py",
      script: "print('dry')\n",
      dry_run: true,
      reason: "Preview script"
    });
    expect(dryRun.generated_script_cleaned).toBe(true);
    await expect(readFile(join(fixture.root, dryRun.script_path))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(fixture.root, "scratch", "agents"))).rejects.toMatchObject({ code: "ENOENT" });

    const failed = await service.runScript({
      runtime: "py",
      script: "raise SystemExit(2)\n",
      reason: "Run failing script"
    });
    expect(failed.exit_code).toBe(2);
    expect(failed.generated_script_cleaned).toBe(false);
    await expect(readFile(join(fixture.root, failed.generated_script_path!), "utf8")).resolves.toContain("SystemExit");
  });

  test("executes the same safe command deterministically and accepts uv argv", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);
    for (let run = 0; run < 5; run += 1) {
      await expect(service.exec({ cwd: ".", cmd: ["node", "--version"], reason: "Repeat validation" }))
        .resolves.toMatchObject({ exit_code: 0, timed_out: false });
    }
    await expect(service.exec({ cwd: ".", cmd: ["uv", "run", "pytest", "-q"], dry_run: true, reason: "Preview uv validation" }))
      .resolves.toMatchObject({ dry_run: true, cmd: ["uv", "run", "pytest", "-q"] });
  });

  test("distinguishes a missing executable from policy rejection", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    await expect(service.exec({ cwd: ".", cmd: ["definitely-not-an-executable"], reason: "Probe missing executable" }))
      .rejects.toMatchObject({
        code: "EXECUTABLE_NOT_FOUND",
        diagnostics: {
          policy_stage: "execution",
          reason_code: "EXECUTABLE_NOT_FOUND",
          trigger: "definitely-not-an-executable",
          mutation_occurred: false
        }
      });
  });

  test("restores tracked files created by validation without touching prior changes", async () => {
    const fixture = await createRepoFixture();
    await execFileAsync("git", ["init"], { cwd: fixture.root });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: fixture.root });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: fixture.root });
    await execFileAsync("git", ["add", "src/app.ts", "docs/guide.md"], { cwd: fixture.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: fixture.root });
    await writeFile(join(fixture.root, "docs", "guide.md"), "prior user change\n");

    const result = await (await workspace(fixture.root)).exec({
      cwd: ".",
      cmd: ["node", "-e", "require('node:fs').writeFileSync('src/app.ts', 'generated validation output\\n')"],
      preserve_tracked_worktree: true,
      reason: "Run artifact-producing validation"
    });

    expect(result).toMatchObject({
      exit_code: 0,
      restored_tracked_paths: ["src/app.ts"],
      preservation_warnings: []
    });
    await expect(readFile(join(fixture.root, "src", "app.ts"), "utf8")).resolves.toContain("export function rawFetch()");
    await expect(readFile(join(fixture.root, "docs", "guide.md"), "utf8")).resolves.toBe("prior user change\n");
  });

  test("saves binary files directly inside the approved repo", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    const result = await service.saveFile({
      path: "task001/task/model.onnx",
      data: Buffer.from("ONNX").toString("base64"),
      encoding: "base64",
      overwrite: true,
      create_dirs: true,
      reason: "Save binary candidate"
    });

    expect(result).toMatchObject({
      ok: true,
      path: "task001/task/model.onnx",
      size_bytes: 4,
      overwritten: false,
      dry_run: false
    });
    await expect(readFile(join(fixture.root, "task001", "task", "model.onnx"))).resolves.toEqual(Buffer.from("ONNX"));
  });

  test("blocks sudo and high-risk git while allowing network families by default", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    await expect(service.exec({ cwd: ".", cmd: ["sudo", "id"], reason: "Probe block" })).rejects.toMatchObject({ code: "EXECUTION_POLICY_REJECTED" });
    await expect(service.exec({ cwd: ".", cmd: ["curl", "https://example.com"], dry_run: true, reason: "Probe network family" })).resolves.toMatchObject({ dry_run: true });
    await expect(service.exec({ cwd: ".", cmd: ["timeout", "5", "curl", "https://example.com"], dry_run: true, reason: "Probe timeout wrapper" })).resolves.toMatchObject({ dry_run: true });
    await expect(service.exec({ cwd: ".", cmd: ["git", "push"], reason: "Probe block" })).rejects.toMatchObject({ code: "EXECUTION_POLICY_REJECTED" });
    await expect(service.exec({ cwd: ".", cmd: ["python3", "../outside.py"], reason: "Probe path block" })).rejects.toMatchObject({ code: "PATH_TRAVERSAL_REJECTED" });
    await expect(service.exec({ cwd: ".", cmd: ["bash", "-lc", "python3 --version && cat README.md"], reason: "Probe shell operator block" })).rejects.toMatchObject({ code: "EXECUTION_POLICY_REJECTED" });
  });

  test("allows repo-local secret reads and rm through exec while still blocking traversal", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);
    await writeFile(join(fixture.root, ".env"), "TOKEN=secret\n");
    await mkdir(join(fixture.root, "scratch"), { recursive: true });
    await writeFile(join(fixture.root, "scratch", "delete-me.txt"), "temporary\n");

    await expect(service.exec({ cwd: ".", cmd: ["cat", ".env"], reason: "Read repo-local env file" })).resolves.toMatchObject({ exit_code: 0, stdout: "TOKEN=secret\n" });
    await expect(service.exec({ cwd: ".", cmd: ["rm", "scratch/delete-me.txt"], reason: "Remove repo-local scratch file" })).resolves.toMatchObject({ exit_code: 0 });
    await expect(service.exec({ cwd: ".", cmd: ["rm", "../outside.txt"], reason: "Probe traversal block" })).rejects.toMatchObject({ code: "PATH_TRAVERSAL_REJECTED" });
  });

  test("times out long-running commands and returns partial output metadata", async () => {
    const fixture = await createRepoFixture();
    const result = await (await workspace(fixture.root)).exec({
      cwd: ".",
      cmd: ["python3", "-c", "import time; print('started', flush=True); time.sleep(5)"],
      timeout_seconds: 1,
      max_stdout_bytes: 100,
      reason: "Exercise timeout"
    });

    expect(result.timed_out).toBe(true);
    expect(result.stdout).toContain("started");
  });

  test("truncates large stdout safely", async () => {
    const fixture = await createRepoFixture();
    const result = await (await workspace(fixture.root)).exec({
      cwd: ".",
      cmd: ["python3", "-c", "print('x' * 1000)"],
      max_stdout_bytes: 20,
      reason: "Exercise output cap"
    });

    expect(result.stdout.length).toBe(20);
    expect(result.stdout_truncated).toBe(true);
  });

  test("exports binary files without inlining bytes", async () => {
    const fixture = await createRepoFixture();
    const result = await (await workspace(fixture.root)).exportFile({
      path: "binary.bin",
      reason: "Export binary fixture"
    });

    expect(result.path).toBe("binary.bin");
    expect(result.size_bytes).toBe(4);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.resource_uri).toMatch(/^file:\/\//);
    expect(await stat(result.mounted_path)).toMatchObject({ size: 4 });
  });

  test("returns metadata and creates artifacts for approved file types", async () => {
    const fixture = await createRepoFixture();
    const runtime = await context(fixture.root);
    await writeFile(join(fixture.root, "task349.zip"), Buffer.from([80, 75, 3, 4]));
    await mkdir(join(fixture.root, "task349", "task"), { recursive: true });
    await writeFile(join(fixture.root, "task349", "task", "task349.onnx"), Buffer.from([8, 1, 18, 2]));
    await writeFile(join(fixture.root, "data.json"), "{\"ok\":true}\n");
    await writeFile(join(fixture.root, "private.pem"), "-----BEGIN PRIVATE KEY-----\nsecret\n");

    const zipInfo = await workspaceFileInfoHandler({
      repo_id: "repo",
      path: "task349.zip",
      include_hash: true,
      include_mime: true
    }, runtime);
    expect(zipInfo.isError).toBeUndefined();
    expect(zipInfo.structuredContent).toMatchObject({ exists: true, type: "file", mime: "application/zip", exportable: true });

    const onnxInfo = await workspaceFileInfoHandler({
      repo_id: "repo",
      path: "task349/task/task349.onnx",
      include_hash: true,
      include_mime: true
    }, runtime);
    expect(onnxInfo.structuredContent).toMatchObject({ exists: true, type: "file", exportable: true });

    const jsonInfo = await workspaceFileInfoHandler({
      repo_id: "repo",
      path: "data.json",
      include_hash: true,
      include_mime: true
    }, runtime);
    expect(jsonInfo.structuredContent).toMatchObject({ exists: true, type: "file", mime: "text/plain", exportable: true });

    const artifact = await workspaceCreateFileArtifactHandler({
      repo_id: "repo",
      path: "task349.zip",
      max_bytes: 5000000,
      reason: "Create mounted artifact for analysis"
    }, runtime);
    expect(artifact.isError).toBeUndefined();
    expect(artifact.structuredContent).toMatchObject({ path: "task349.zip", size_bytes: 4 });

    const envInfo = await workspaceFileInfoHandler({
      repo_id: "repo",
      path: ".env",
      include_hash: true,
      include_mime: true
    }, runtime);
    expect(envInfo.structuredContent).toMatchObject({ blocked: true, blocked_reason: "SECRET_CANDIDATE_BLOCKED" });

    const pemArtifact = await workspaceCreateFileArtifactHandler({
      repo_id: "repo",
      path: "private.pem",
      reason: "Probe secret path block"
    }, runtime);
    expect(pemArtifact.isError).toBe(true);
    expect(pemArtifact.structuredContent).toMatchObject({ error: { code: "SECRET_CANDIDATE_BLOCKED" } });
  });

  test("prevents symlink escape during export", async () => {
    const fixture = await createRepoFixture();

    await expect((await workspace(fixture.root)).exportFile({
      path: "linked-secret.txt",
      reason: "Probe symlink safety"
    })).rejects.toMatchObject({ code: "SYMLINK_ESCAPE_REJECTED" });
  });

  test("can explicitly expand nested repositories", async () => {
    const fixture = await createRepoFixture();
    const result = await new RepoTreeService(fixture.root, new PathSandbox(fixture.root)).tree({
      include_files: true,
      include_nested_repos: true
    });

    expect(result.entries.some((entry) => entry.path === "vendor/nested/index.ts")).toBe(true);
  });

  test("lists task-like nested directories without reading contents", async () => {
    const fixture = await createRepoFixture();
    for (const taskId of ["task349", "task286"]) {
      await mkdir(join(fixture.root, taskId, "task"), { recursive: true });
      await mkdir(join(fixture.root, taskId, "scorer"), { recursive: true });
      await mkdir(join(fixture.root, taskId, "ARC-GEN", ".git"), { recursive: true });
      await writeFile(join(fixture.root, taskId, "task", `${taskId}.onnx`), Buffer.from([1, 2, 3]));
      await writeFile(join(fixture.root, taskId, "scorer", "README.md"), "scorer\n");
      await writeFile(join(fixture.root, taskId, "ARC-GEN", "README.md"), "nested\n");
    }

    const service = new RepoTreeService(fixture.root, new PathSandbox(fixture.root));
    const task349 = await service.tree({ path: "task349/task", include_files: true, include_nested_repos: true, max_depth: 1 });
    const task286 = await service.tree({ path: "task286/task", include_files: true, include_nested_repos: true, max_depth: 1 });
    const nested = await service.tree({ path: "task349/ARC-GEN", include_files: true, include_nested_repos: true, max_depth: 1 });

    expect(task349.entries.some((entry) => entry.path === "task349/task/task349.onnx" && entry.size_bytes === 3)).toBe(true);
    expect(task286.entries.some((entry) => entry.path === "task286/task/task286.onnx" && entry.size_bytes === 3)).toBe(true);
    expect(nested.entries.some((entry) => entry.path === "task349/ARC-GEN/README.md")).toBe(true);
  });

  test("workspace_write_file allows approved repo-local paths", async () => {
    const fixture = await createRepoFixture();
    const runtime = await context(fixture.root);

    const allowed = await workspaceWriteFileHandler({
      repo_id: "repo",
      path: "scratch/result.txt",
      action: "write",
      content: "ok\n",
      create_dirs: true,
      reason: "Write scratch result"
    }, runtime);
    expect(allowed.isError).toBeUndefined();
    expect(await readFile(join(fixture.root, "scratch", "result.txt"), "utf8")).toBe("ok\n");

    const repoWrite = await workspaceWriteFileHandler({
      repo_id: "repo",
      path: "src/app.ts",
      action: "write",
      content: "export const updated = true;\n",
      reason: "Write repo-local source file"
    }, runtime);
    expect(repoWrite.isError).toBeUndefined();
    expect(await readFile(join(fixture.root, "src", "app.ts"), "utf8")).toBe("export const updated = true;\n");
  });

  test("delete dry run reports explicit scratch paths without deleting", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "scratch"), { recursive: true });
    await writeFile(join(fixture.root, "scratch", "delete-me.txt"), "temporary\n");

    const result = await (await workspace(fixture.root)).deletePaths({
      paths: ["scratch/delete-me.txt"],
      dry_run: true,
      reason: "Preview cleanup"
    });

    expect(result.dry_run).toBe(true);
    expect(result.deleted).toEqual([{ path: "scratch/delete-me.txt", type: "file" }]);
    expect(result).toMatchObject({ selected_files: 1, selected_bytes: 10, deleted_files: 0, deleted_bytes: 0 });
    await expect(readFile(join(fixture.root, "scratch", "delete-me.txt"), "utf8")).resolves.toBe("temporary\n");
  });

  test("cleanup removes scratch files when dry_run is false", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "scratch", "run1"), { recursive: true });
    await writeFile(join(fixture.root, "scratch", "run1", "tmp.txt"), "temporary\n");

    const result = await (await workspace(fixture.root)).deletePaths({
      paths: ["scratch/run1/tmp.txt"],
      dry_run: false,
      reason: "Clean scratch file"
    });

    expect(result.deleted).toEqual([{ path: "scratch/run1/tmp.txt", type: "file" }]);
    expect(result).toMatchObject({ selected_files: 1, selected_bytes: 10, deleted_files: 1, deleted_bytes: 10 });
    await expect(readFile(join(fixture.root, "scratch", "run1", "tmp.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleanup allows explicit untracked repo paths and refuses tracked files, traversal, and broad globs", async () => {
    const fixture = await createRepoFixture();
    await mkdir(join(fixture.root, "scratch"), { recursive: true });
    await writeFile(join(fixture.root, "scratch", "tracked.txt"), "tracked\n");
    await execFileAsync("git", ["init"], { cwd: fixture.root });
    await execFileAsync("git", ["add", "scratch/tracked.txt"], { cwd: fixture.root });

    const result = await (await workspace(fixture.root)).deletePaths({
      paths: ["scratch/tracked.txt", "src/app.ts", "../outside", "scratch/*.txt"],
      dry_run: false,
      reason: "Probe cleanup refusal"
    });

    expect(result.deleted).toEqual([{ path: "src/app.ts", type: "file" }]);
    expect(result.skipped).toEqual([
      { path: "scratch/tracked.txt", reason: "CLEANUP_TRACKED_PATH" },
      { path: "../outside", reason: "PATH_TRAVERSAL_REJECTED" },
      { path: "scratch/*.txt", reason: "CLEANUP_UNSAFE_PATH" }
    ]);
  });

  test("workspace_policy_explain returns suggested tools", async () => {
    const fixture = await createRepoFixture();
    const runtime = await context(fixture.root);

    const artifact = await workspacePolicyExplainHandler({
      repo_id: "repo",
      path: "task349.zip",
      operation: "export"
    }, runtime);
    expect(artifact.structuredContent).toMatchObject({ allowed: true, suggested_tool: "workspace_create_file_artifact" });

    const cleanup = await workspacePolicyExplainHandler({
      repo_id: "repo",
      path: "scratch/run1/tmp.txt",
      operation: "delete"
    }, runtime);
    expect(cleanup.structuredContent).toMatchObject({ allowed: true, suggested_tool: "workspace_cleanup_paths" });

    const exec = await workspacePolicyExplainHandler({
      repo_id: "repo",
      path: "task349/validate_task.py",
      operation: "exec"
    }, runtime);
    expect(exec.structuredContent).toMatchObject({ allowed: true, suggested_tool: "workspace_exec" });
  });

  test("supports three simulated agents with isolated scratch and unchanged official files", async () => {
    const fixture = await createRepoFixture();
    const runtime = await context(fixture.root);
    await mkdir(join(fixture.root, "task101"), { recursive: true });
    await writeFile(join(fixture.root, "task101", "input.txt"), "official\n");
    await writeFile(join(fixture.root, "task101", "validate_task.py"), "print('validation ok')\n");
    const officialBefore = await readFile(join(fixture.root, "task101", "input.txt"), "utf8");

    const agents = await Promise.all(["agent_a", "agent_b", "agent_c"].map(async (agentId, index) => {
      const session = await workspaceAgentSessionHandler({
        repo_id: "repo",
        agent_id: agentId,
        task_id: `task10${index}`,
        reason: "Create isolated agent workspace"
      }, runtime);
      expect(session.isError).toBeUndefined();
      const scratchPath = session.structuredContent!.task_scratch_path!;
      const scriptPath = `${scratchPath}/run.py`;
      const write = await workspaceWriteFileHandler({
        repo_id: "repo",
        agent_id: agentId,
        path: scriptPath,
        action: "write",
        content: `print('${agentId}')\n`,
        create_dirs: true,
        reason: "Write isolated scratch script"
      }, runtime);
      expect(write.isError).toBeUndefined();
      const run = await workspaceExecHandler({
        repo_id: "repo",
        agent_id: agentId,
        cwd: ".",
        cmd: ["python3", scriptPath],
        reason: "Run isolated scratch script"
      }, runtime);
      expect(run.structuredContent).toMatchObject({ exit_code: 0, timed_out: false });
      const validation = await workspaceExecHandler({
        repo_id: "repo",
        agent_id: agentId,
        cwd: "task101",
        cmd: ["python3", "validate_task.py"],
        reason: "Run quick validation"
      }, runtime);
      expect(validation.structuredContent).toMatchObject({ exit_code: 0, timed_out: false });
      return { agentId, scratchPath, scriptPath };
    }));

    expect(new Set(agents.map((agent) => agent.scratchPath)).size).toBe(3);
    for (const agent of agents) {
      expect(agent.scratchPath).toBe(`scratch/agents/${agent.agentId}/task10${agent.agentId.at(-1) === "a" ? "0" : agent.agentId.at(-1) === "b" ? "1" : "2"}`);
      await expect(readFile(join(fixture.root, agent.scriptPath), "utf8")).resolves.toContain(agent.agentId);
    }
    await expect(readFile(join(fixture.root, "task101", "input.txt"), "utf8")).resolves.toBe(officialBefore);
  });

  test("serializes task claims and official-write locks", async () => {
    const fixture = await createRepoFixture();
    const runtime = await context(fixture.root);

    const firstClaim = await workspaceClaimTaskHandler({
      repo_id: "repo",
      agent_id: "agent_one",
      task_id: "task777",
      reason: "Claim task"
    }, runtime);
    const secondClaim = await workspaceClaimTaskHandler({
      repo_id: "repo",
      agent_id: "agent_two",
      task_id: "task777",
      reason: "Claim task"
    }, runtime);
    expect(firstClaim.structuredContent).toMatchObject({ acquired: true, agent_id: "agent_one", resource: "task777" });
    expect(secondClaim.structuredContent).toMatchObject({ acquired: false, agent_id: "agent_two", resource: "task777" });

    const releaseClaim = await workspaceReleaseTaskHandler({
      repo_id: "repo",
      agent_id: "agent_one",
      task_id: "task777",
      claim_id: firstClaim.structuredContent!.lock_id,
      reason: "Release task"
    }, runtime);
    expect(releaseClaim.structuredContent).toMatchObject({ released: true });

    const firstLock = await workspaceAcquireOfficialLockHandler({
      repo_id: "repo",
      agent_id: "agent_one",
      reason: "Acquire official write lock"
    }, runtime);
    const secondLock = await workspaceAcquireOfficialLockHandler({
      repo_id: "repo",
      agent_id: "agent_two",
      reason: "Acquire official write lock"
    }, runtime);
    expect(firstLock.structuredContent).toMatchObject({ acquired: true, agent_id: "agent_one", resource: "official" });
    expect(secondLock.structuredContent).toMatchObject({ acquired: false, agent_id: "agent_two", resource: "official" });

    const releaseLock = await workspaceReleaseOfficialLockHandler({
      repo_id: "repo",
      agent_id: "agent_one",
      lock_id: firstLock.structuredContent!.lock_id,
      reason: "Release official write lock"
    }, runtime);
    expect(releaseLock.structuredContent).toMatchObject({ released: true });

    const retryLock = await workspaceAcquireOfficialLockHandler({
      repo_id: "repo",
      agent_id: "agent_two",
      reason: "Acquire official write lock after release"
    }, runtime);
    expect(retryLock.structuredContent).toMatchObject({ acquired: true, agent_id: "agent_two", resource: "official" });
  });
});
