import { describe, expect, test } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRepoFixture } from "./fixtures/repo-fixture.js";
import { RootRegistry } from "../src/services/root-registry.js";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { RepoTreeService } from "../src/services/repo-tree-service.js";
import { WorkspacePolicy } from "../src/services/workspace-policy.js";
import { WorkspaceService } from "../src/services/workspace-service.js";
import { workspaceWriteFileHandler } from "../src/tools/handlers.js";
import type { RuntimeContext } from "../src/runtime/context.js";

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

  test("blocks sudo and network command families", async () => {
    const fixture = await createRepoFixture();
    const service = await workspace(fixture.root);

    await expect(service.exec({ cwd: ".", cmd: ["sudo", "id"], reason: "Probe block" })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
    await expect(service.exec({ cwd: ".", cmd: ["curl", "https://example.com"], reason: "Probe block" })).rejects.toMatchObject({ code: "OPERATIONS_DISABLED" });
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
});
