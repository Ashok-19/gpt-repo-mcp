import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { WriteFileActionSchema } from "./write.contract.js";

const ReasonSchema = z.string().min(1).optional();
const StringRecordSchema = z.record(z.string(), z.string());

export const WorkspaceExecInputSchema = RepoInputSchema.extend({
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
  next_step: z.string()
});

export type WorkspaceExecInput = z.infer<typeof WorkspaceExecInputSchema>;
export type WorkspaceExportFileInput = z.infer<typeof WorkspaceExportFileInputSchema>;
export type WorkspaceImportFileInput = z.infer<typeof WorkspaceImportFileInputSchema>;
export type WorkspaceFileInfoInput = z.infer<typeof WorkspaceFileInfoInputSchema>;
export type WorkspaceWriteFileInput = z.infer<typeof WorkspaceWriteFileInputSchema>;
export type WorkspaceApplyPatchInput = z.infer<typeof WorkspaceApplyPatchInputSchema>;
export type WorkspaceMakeDirInput = z.infer<typeof WorkspaceMakeDirInputSchema>;
export type WorkspaceDeletePathsInput = z.infer<typeof WorkspaceDeletePathsInputSchema>;
export type WorkspacePolicyExplainInput = z.infer<typeof WorkspacePolicyExplainInputSchema>;
