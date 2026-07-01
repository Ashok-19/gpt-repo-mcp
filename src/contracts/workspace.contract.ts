import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { WriteFileActionSchema } from "./write.contract.js";

const ReasonSchema = z.string().min(1).optional();
const StringRecordSchema = z.record(z.string(), z.string());
const AgentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).optional();
const RunScriptCommonSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  cwd: z.string().default("."),
  script_path: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  timeout_seconds: z.number().int().positive().optional(),
  max_stdout_bytes: z.number().int().positive().optional(),
  max_stderr_bytes: z.number().int().positive().optional(),
  env: StringRecordSchema.optional(),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceExecInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  cwd: z.string().default("."),
  cmd: z.array(z.string()).min(1),
  timeout_seconds: z.number().int().positive().optional(),
  max_stdout_bytes: z.number().int().positive().optional(),
  max_stderr_bytes: z.number().int().positive().optional(),
  env: StringRecordSchema.optional(),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceExecResultSchema = z.object({
  agent_id: z.string().optional(),
  exit_code: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
  timed_out: z.boolean(),
  stdout_truncated: z.boolean(),
  stderr_truncated: z.boolean(),
  cwd: z.string(),
  cmd: z.array(z.string()),
  dry_run: z.boolean().optional()
});

export const WorkspaceRunScriptResultSchema = WorkspaceExecResultSchema.extend({
  interpreter: z.string(),
  script_path: z.string(),
  generated_script_path: z.string().optional()
});

export const WorkspaceRunPythonInputSchema = RunScriptCommonSchema.extend({
  python: z.enum(["python", "python3", "python3.12"]).optional(),
  code: z.string().min(1).optional()
});

export const WorkspaceRunBashInputSchema = RunScriptCommonSchema.extend({
  shell: z.enum(["bash", "sh"]).optional(),
  script: z.string().min(1).optional()
});

export const WorkspaceRunScriptInputSchema = RunScriptCommonSchema.extend({
  runtime: z.enum(["py", "posix", "node"]).default("py"),
  script: z.string().min(1).optional()
});

export const WorkspaceSaveFileInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  data: z.string(),
  encoding: z.enum(["utf8", "base64", "hex"]).default("utf8"),
  overwrite: z.boolean().optional(),
  create_dirs: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceSaveFileResultSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  mime: z.string().optional(),
  overwritten: z.boolean(),
  dry_run: z.boolean()
});

export const WorkspaceExportFileInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  max_bytes: z.number().int().positive().optional(),
  reason: ReasonSchema
});

export const WorkspaceExportFileResultSchema = z.object({
  path: z.string(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  mime: z.string().optional(),
  resource_uri: z.string(),
  mounted_path: z.string(),
  warnings: z.array(z.string()).default([])
});

export const WorkspaceImportFileInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  source_file: z.string().min(1),
  dest_path: z.string().min(1),
  overwrite: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceImportFileResultSchema = z.object({
  destination_path: z.string(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  overwritten: z.boolean()
});

export const WorkspaceFileInfoInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  include_hash: z.boolean().optional(),
  include_mime: z.boolean().optional()
});

export const WorkspaceFileInfoResultSchema = z.object({
  exists: z.boolean(),
  path: z.string(),
  type: z.enum(["file", "directory", "symlink", "other"]).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  modified_time: z.string().optional(),
  permissions: z.string().optional(),
  mime: z.string().optional(),
  readable: z.boolean(),
  writable: z.boolean(),
  exportable: z.boolean(),
  blocked: z.boolean(),
  blocked_reason: z.string().optional()
});

export const WorkspaceReadFileInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  start_line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  start_byte: z.number().int().nonnegative().optional(),
  end_byte: z.number().int().positive().optional(),
  max_bytes: z.number().int().positive().optional(),
  override_default_excludes: z.boolean().optional()
});

export const WorkspaceReadManyInputSchema = RepoInputSchema.extend({
  paths: z.array(z.string()).optional(),
  include_globs: z.array(z.string()).optional(),
  exclude_globs: z.array(z.string()).optional(),
  max_files: z.number().int().positive().optional(),
  max_bytes_per_file: z.number().int().positive().optional(),
  max_total_bytes: z.number().int().positive().optional(),
  cursor: z.string().optional()
}).refine((input) => (input.paths?.length ?? 0) > 0 || (input.include_globs?.length ?? 0) > 0, {
  message: "workspace_read_many requires paths or include_globs.",
  path: ["paths"]
});

export const WorkspaceWriteFileInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  path: z.string().min(1),
  action: WriteFileActionSchema.optional(),
  content: z.string().optional(),
  find: z.string().min(1).optional(),
  replace: z.string().optional(),
  create_dirs: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceApplyPatchInputSchema = RepoInputSchema.extend({
  patch: z.string().min(1),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceApplyPatchResultSchema = z.object({
  ok: z.literal(true),
  dry_run: z.boolean(),
  changed_files: z.array(z.string()),
  summary: z.string(),
  warnings: z.array(z.string()).default([])
});

export const WorkspaceMakeDirInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  path: z.string().min(1),
  parents: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceMakeDirResultSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
  dry_run: z.boolean(),
  created: z.boolean()
});

export const WorkspaceDeletePathsInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  paths: z.array(z.string()).min(1),
  dry_run: z.boolean().optional().default(true),
  reason: ReasonSchema
});

export const WorkspaceDeletePathsResultSchema = z.object({
  ok: z.literal(true),
  dry_run: z.boolean(),
  deleted: z.array(z.object({
    path: z.string(),
    type: z.enum(["file", "directory"])
  })),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.string()
  })),
  warnings: z.array(z.string()).default([])
});

export const WorkspacePolicyExplainInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  operation: z.enum(["read", "write", "exec", "export", "delete"])
});

export const WorkspacePolicyExplainResultSchema = z.object({
  allowed: z.boolean(),
  matched_allow_globs: z.array(z.string()),
  matched_deny_globs: z.array(z.string()),
  reason: z.string(),
  next_step: z.string(),
  suggested_tool: z.string()
});

export const WorkspaceAgentSessionInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  label: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  create_dirs: z.boolean().optional(),
  reason: ReasonSchema
});

export const WorkspaceAgentSessionResultSchema = z.object({
  ok: z.literal(true),
  agent_id: z.string(),
  scratch_root: z.string(),
  task_scratch_path: z.string().optional(),
  label: z.string().optional(),
  instructions: z.array(z.string())
});

export const WorkspaceClaimTaskInputSchema = RepoInputSchema.extend({
  task_id: z.string().min(1),
  agent_id: AgentIdSchema,
  ttl_seconds: z.number().int().positive().optional(),
  reason: ReasonSchema
});

export const WorkspaceClaimTaskResultSchema = z.object({
  ok: z.literal(true),
  acquired: z.boolean(),
  agent_id: z.string(),
  resource: z.string(),
  lock_id: z.string().optional(),
  lock_path: z.string(),
  expires_at: z.string().optional(),
  owner: z.unknown().optional()
});

export const WorkspaceReleaseTaskInputSchema = RepoInputSchema.extend({
  task_id: z.string().min(1),
  agent_id: AgentIdSchema,
  claim_id: z.string().optional(),
  reason: ReasonSchema
});

export const WorkspaceReleaseTaskResultSchema = z.object({
  ok: z.literal(true),
  released: z.boolean(),
  agent_id: z.string(),
  resource: z.string(),
  lock_path: z.string(),
  owner: z.unknown().optional(),
  warnings: z.array(z.string())
});

export const WorkspaceOfficialLockInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  scope: z.string().min(1).optional(),
  ttl_seconds: z.number().int().positive().optional(),
  reason: ReasonSchema
});

export const WorkspaceOfficialLockResultSchema = WorkspaceClaimTaskResultSchema;

export const WorkspaceOfficialUnlockInputSchema = RepoInputSchema.extend({
  agent_id: AgentIdSchema,
  scope: z.string().min(1).optional(),
  lock_id: z.string().optional(),
  reason: ReasonSchema
});

export const WorkspaceOfficialUnlockResultSchema = WorkspaceReleaseTaskResultSchema;

export const WorkspaceReapProcessesInputSchema = RepoInputSchema.extend({
  dry_run: z.boolean().optional(),
  min_age_seconds: z.number().int().nonnegative().optional(),
  reason: ReasonSchema
});

export const WorkspaceReapProcessesResultSchema = z.object({
  ok: z.literal(true),
  dry_run: z.boolean(),
  candidates: z.array(z.object({
    pid: z.number().int().positive(),
    age_seconds: z.number().int().nonnegative(),
    command: z.string(),
    cwd: z.string().optional()
  })),
  killed: z.array(z.object({
    pid: z.number().int().positive(),
    command: z.string()
  })),
  warnings: z.array(z.string())
});

export type WorkspaceExecInput = z.infer<typeof WorkspaceExecInputSchema>;
export type WorkspaceRunPythonInput = z.input<typeof WorkspaceRunPythonInputSchema>;
export type WorkspaceRunBashInput = z.input<typeof WorkspaceRunBashInputSchema>;
export type WorkspaceRunScriptInput = z.input<typeof WorkspaceRunScriptInputSchema>;
export type WorkspaceSaveFileInput = z.input<typeof WorkspaceSaveFileInputSchema>;
export type WorkspaceExportFileInput = z.infer<typeof WorkspaceExportFileInputSchema>;
export type WorkspaceImportFileInput = z.infer<typeof WorkspaceImportFileInputSchema>;
export type WorkspaceFileInfoInput = z.infer<typeof WorkspaceFileInfoInputSchema>;
export type WorkspaceWriteFileInput = z.infer<typeof WorkspaceWriteFileInputSchema>;
export type WorkspaceApplyPatchInput = z.infer<typeof WorkspaceApplyPatchInputSchema>;
export type WorkspaceMakeDirInput = z.infer<typeof WorkspaceMakeDirInputSchema>;
export type WorkspaceDeletePathsInput = z.infer<typeof WorkspaceDeletePathsInputSchema>;
export type WorkspacePolicyExplainInput = z.infer<typeof WorkspacePolicyExplainInputSchema>;
export type WorkspaceAgentSessionInput = z.infer<typeof WorkspaceAgentSessionInputSchema>;
export type WorkspaceClaimTaskInput = z.infer<typeof WorkspaceClaimTaskInputSchema>;
export type WorkspaceReleaseTaskInput = z.infer<typeof WorkspaceReleaseTaskInputSchema>;
export type WorkspaceOfficialLockInput = z.infer<typeof WorkspaceOfficialLockInputSchema>;
export type WorkspaceOfficialUnlockInput = z.infer<typeof WorkspaceOfficialUnlockInputSchema>;
export type WorkspaceReapProcessesInput = z.infer<typeof WorkspaceReapProcessesInputSchema>;
