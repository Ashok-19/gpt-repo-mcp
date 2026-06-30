import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { RepoReaderError } from "../runtime/errors.js";
import { getRequestTelemetry } from "../runtime/telemetry.js";
import { validateRepoPath } from "./path-sandbox.js";

const execFileAsync = promisify(execFile);
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LOCK_ROOT = ".chatgpt/workspace-locks";

export type WorkspaceAgentSessionInput = {
  agent_id?: string;
  label?: string;
  task_id?: string;
  create_dirs?: boolean;
};

export type WorkspaceTaskClaimInput = {
  task_id: string;
  agent_id?: string;
  ttl_seconds?: number;
};

export type WorkspaceTaskReleaseInput = {
  task_id: string;
  agent_id?: string;
  claim_id?: string;
};

export type WorkspaceOfficialLockInput = {
  agent_id?: string;
  scope?: string;
  ttl_seconds?: number;
};

export type WorkspaceOfficialUnlockInput = {
  agent_id?: string;
  scope?: string;
  lock_id?: string;
};

type LockMetadata = {
  kind: "task" | "official";
  owner_agent_id: string;
  resource: string;
  lock_id: string;
  created_at: string;
  expires_at: string;
};

export class WorkspaceAgentService {
  constructor(private readonly root: string) {}

  async session(input: WorkspaceAgentSessionInput) {
    const agentId = resolveAgentId(input.agent_id);
    const scratch_root = `scratch/agents/${agentId}`;
    const task_scratch_path = input.task_id ? `${scratch_root}/${safeSegment(input.task_id, "task_id")}` : undefined;
    if (input.create_dirs ?? true) {
      await mkdir(join(this.root, task_scratch_path ?? scratch_root), { recursive: true });
      await assertWithinRoot(this.root, join(this.root, task_scratch_path ?? scratch_root));
    }

    return {
      ok: true as const,
      agent_id: agentId,
      scratch_root,
      ...(task_scratch_path ? { task_scratch_path } : {}),
      label: input.label,
      instructions: [
        `Use ${task_scratch_path ?? scratch_root} for scripts, candidates, logs, profiler outputs, and temp files.`,
        "Do not write shared scratch paths when running parallel agents."
      ]
    };
  }

  async claimTask(input: WorkspaceTaskClaimInput) {
    const agentId = resolveAgentId(input.agent_id);
    const taskId = safeSegment(input.task_id, "task_id");
    return await this.acquireLock({
      kind: "task",
      resource: taskId,
      agentId,
      ttlSeconds: input.ttl_seconds ?? 3600
    });
  }

  async releaseTask(input: WorkspaceTaskReleaseInput) {
    const agentId = resolveAgentId(input.agent_id);
    const taskId = safeSegment(input.task_id, "task_id");
    return await this.releaseLock({
      kind: "task",
      resource: taskId,
      agentId,
      lockId: input.claim_id
    });
  }

  async acquireOfficialLock(input: WorkspaceOfficialLockInput) {
    const agentId = resolveAgentId(input.agent_id);
    const scope = safeSegment(input.scope ?? "official", "scope");
    return await this.acquireLock({
      kind: "official",
      resource: scope,
      agentId,
      ttlSeconds: input.ttl_seconds ?? 1800
    });
  }

  async releaseOfficialLock(input: WorkspaceOfficialUnlockInput) {
    const agentId = resolveAgentId(input.agent_id);
    const scope = safeSegment(input.scope ?? "official", "scope");
    return await this.releaseLock({
      kind: "official",
      resource: scope,
      agentId,
      lockId: input.lock_id
    });
  }

  async reapProcesses(input: { dry_run?: boolean; min_age_seconds?: number }) {
    const minAge = input.min_age_seconds ?? 60;
    const dryRun = input.dry_run ?? true;
    const candidates = await this.findRepoProcesses(minAge);
    const killed: Array<{ pid: number; command: string }> = [];
    if (!dryRun) {
      for (const candidate of candidates) {
        try {
          process.kill(candidate.pid, "SIGTERM");
          killed.push({ pid: candidate.pid, command: candidate.command });
        } catch {
          // Process may already have exited.
        }
      }
    }
    return {
      ok: true as const,
      dry_run: dryRun,
      candidates,
      killed,
      warnings: []
    };
  }

  private async acquireLock(input: { kind: "task" | "official"; resource: string; agentId: string; ttlSeconds: number }) {
    const lockPath = this.lockPath(input.kind, input.resource);
    await this.removeExpiredLock(lockPath);
    const now = new Date();
    const metadata: LockMetadata = {
      kind: input.kind,
      owner_agent_id: input.agentId,
      resource: input.resource,
      lock_id: randomUUID(),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString()
    };

    try {
      await mkdir(dirname(lockPath), { recursive: true });
      await mkdir(lockPath, { recursive: false });
      await writeFile(join(lockPath, "lock.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      return {
        ok: true as const,
        acquired: true,
        agent_id: input.agentId,
        resource: input.resource,
        lock_id: metadata.lock_id,
        lock_path: relativeRepoPath(this.root, lockPath),
        expires_at: metadata.expires_at
      };
    } catch (error) {
      if (!isExistsError(error)) {
        throw error;
      }
      const owner = await this.readLock(lockPath);
      return {
        ok: true as const,
        acquired: false,
        agent_id: input.agentId,
        resource: input.resource,
        lock_path: relativeRepoPath(this.root, lockPath),
        owner
      };
    }
  }

  private async releaseLock(input: { kind: "task" | "official"; resource: string; agentId: string; lockId?: string }) {
    const lockPath = this.lockPath(input.kind, input.resource);
    const owner = await this.readLock(lockPath);
    if (!owner) {
      return {
        ok: true as const,
        released: false,
        agent_id: input.agentId,
        resource: input.resource,
        lock_path: relativeRepoPath(this.root, lockPath),
        warnings: ["LOCK_NOT_FOUND"]
      };
    }
    if (owner.owner_agent_id !== input.agentId && owner.lock_id !== input.lockId) {
      return {
        ok: true as const,
        released: false,
        agent_id: input.agentId,
        resource: input.resource,
        lock_path: relativeRepoPath(this.root, lockPath),
        owner,
        warnings: ["LOCK_OWNED_BY_ANOTHER_AGENT"]
      };
    }
    await rm(lockPath, { recursive: true, force: true });
    return {
      ok: true as const,
      released: true,
      agent_id: input.agentId,
      resource: input.resource,
      lock_path: relativeRepoPath(this.root, lockPath),
      warnings: []
    };
  }

  private lockPath(kind: "task" | "official", resource: string): string {
    return join(this.root, LOCK_ROOT, kind === "task" ? "tasks" : "official", resource);
  }

  private async removeExpiredLock(lockPath: string): Promise<void> {
    const owner = await this.readLock(lockPath);
    if (!owner) {
      return;
    }
    if (Date.parse(owner.expires_at) <= Date.now()) {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async readLock(lockPath: string): Promise<LockMetadata | undefined> {
    try {
      return JSON.parse(await readFile(join(lockPath, "lock.json"), "utf8")) as LockMetadata;
    } catch {
      return undefined;
    }
  }

  private async findRepoProcesses(minAgeSeconds: number) {
    const rootReal = await realpath(this.root);
    const ps = await execFileAsync("ps", ["-eo", "pid=,etimes=,comm=,args="], {
      env: { PATH: process.env.PATH ?? "" },
      maxBuffer: 512 * 1024
    });
    const candidates: Array<{ pid: number; age_seconds: number; command: string; cwd?: string }> = [];
    for (const line of ps.stdout.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const age = Number(match[2]);
      const commandName = match[3] ?? "";
      const command = match[4] ?? "";
      if (!Number.isFinite(pid) || !Number.isFinite(age) || age < minAgeSeconds) continue;
      if (!isReapCandidate(commandName, command)) continue;
      let cwd: string | undefined;
      try {
        cwd = await realpath(`/proc/${pid}/cwd`);
      } catch {
        continue;
      }
      if (!isWithin(rootReal, cwd)) continue;
      candidates.push({ pid, age_seconds: age, command, cwd: relativeRepoPath(this.root, cwd) });
    }
    return candidates;
  }
}

export function resolveAgentId(explicitAgentId?: string): string {
  const agentId = explicitAgentId ?? getRequestTelemetry()?.agent_id ?? `agent_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new RepoReaderError("VALIDATION_ERROR", `Invalid agent_id: ${agentId}`);
  }
  return agentId;
}

function safeSegment(value: string, field: string): string {
  const normalized = validateRepoPath(value);
  if (normalized.includes("/")) {
    throw new RepoReaderError("VALIDATION_ERROR", `${field} must be a single path segment.`);
  }
  return normalized;
}

async function assertWithinRoot(root: string, target: string): Promise<void> {
  const [rootReal, targetReal] = await Promise.all([realpath(root), realpath(target)]);
  if (!isWithin(rootReal, targetReal)) {
    throw new RepoReaderError("SYMLINK_ESCAPE_REJECTED", "Path escapes approved repository.");
  }
}

function isWithin(rootPath: string, targetPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

function relativeRepoPath(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath).replaceAll(sep, "/");
  return rel.length === 0 ? "." : rel;
}

function isExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

function isReapCandidate(commandName: string, command: string): boolean {
  const text = `${commandName} ${command}`.toLowerCase();
  return text.includes("python") || text.includes("onnxruntime") || text.includes("onnx");
}
