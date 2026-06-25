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
import { workspaceCreateFileArtifactHandler, workspaceFileInfoHandler, workspacePolicyExplainHandler, workspaceWriteFileHandler } from "../src/tools/handlers.js";
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

  test("blocks sudo and network command families", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    await expect(service.exec({ cwd: ".", cmd: ["sudo", "id"], reason: "Probe block" })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
    await expect(service.exec({ cwd: ".", cmd: ["curl", "https://example.com"], reason: "Probe block" })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
    await expect(service.exec({ cwd: ".", cmd: ["git", "push"], reason: "Probe block" })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
    await expect(service.exec({ cwd: ".", cmd: ["python3", "../outside.py"], reason: "Probe path block" })).rejects.toMatchObject({ code: "PATH_TRAVERSAL_REJECTED" });
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

  test("workspace_write_file allows scratch paths and denies protected paths", async () => {
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

    const denied = await workspaceWriteFileHandler({
      repo_id: "repo",
      path: "src/app.ts",
      action: "write",
      content: "blocked\n",
      reason: "Probe denied write"
    }, runtime);
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { code: "WRITE_NOT_ALLOWED_GLOB" } });
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
    await expect(readFile(join(fixture.root, "scratch", "run1", "tmp.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleanup refuses tracked files, traversal, and broad globs", async () => {
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

    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([
      { path: "scratch/tracked.txt", reason: "CLEANUP_TRACKED_PATH" },
      { path: "src/app.ts", reason: "CLEANUP_NOT_ALLOWED_GLOB" },
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
});
