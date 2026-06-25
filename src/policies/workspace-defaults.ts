export type WorkspacePolicyDefaults = {
  exec_enabled: boolean;
  exec_default_timeout_seconds: number;
  exec_max_timeout_seconds: number;
  exec_max_output_bytes: number;
  exec_allowed_roots: string[];
  exec_write_allowed_globs: string[];
  exec_block_network: boolean;
  exec_block_sudo: boolean;
  exec_require_reason: boolean;
  export_max_bytes: number;
  export_dir: string;
  delete_allowed_globs: string[];
};

export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicyDefaults = {
  exec_enabled: true,
  exec_default_timeout_seconds: 60,
  exec_max_timeout_seconds: 600,
  exec_max_output_bytes: 200000,
  exec_allowed_roots: [] as string[],
  exec_write_allowed_globs: [
    ".chatgpt/**",
    "experiments/**",
    "scratch/**",
    "tmp/**",
    "task*/experiments/**",
    "task*/scratch/**",
    "task*/tmp/**"
  ],
  exec_block_network: true,
  exec_block_sudo: true,
  exec_require_reason: true,
  export_max_bytes: 200000000,
  export_dir: "",
  delete_allowed_globs: [
    ".chatgpt/**",
    "experiments/**",
    "scratch/**",
    "tmp/**",
    "task*/experiments/**",
    "task*/scratch/**",
    "task*/tmp/**",
    "coverage/**",
    "dist/**",
    "test-results/**"
  ]
};
