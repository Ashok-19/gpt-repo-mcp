import { describe, expect, test } from "vitest";
import { RepoReaderError, toRepoReaderError } from "../src/runtime/errors.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../src/runtime/result-envelope.js";

describe("result envelope", () => {
  test("maps missing filesystem paths to a stable public error", () => {
    expect(toRepoReaderError(Object.assign(new Error("raw path"), { code: "ENOENT" }))).toMatchObject({
      code: "PATH_NOT_FOUND",
      message: "Path does not exist."
    });
  });
  test("wraps successful structured content", () => {
    const result = createSuccessEnvelope({ repos: [] }, "No approved repositories configured.");

    expect(result.structuredContent).toEqual({ repos: [] });
    expect(result.content[0]?.text).toBe("No approved repositories configured.");
    expect(result.isError).toBeUndefined();
  });

  test("redacts sensitive and absolute-path details from errors", () => {
    const result = createErrorEnvelope({
      code: "INTERNAL_ERROR",
      message: "Failed reading /Users/example/repo/.env with token sk-secret",
      retryable: false
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.message).not.toContain("/Users/example");
    expect(result.structuredContent.error.message).not.toContain("sk-secret");
  });

  test("exposes only safe allowlisted diagnostics in errors", () => {
    const result = createErrorEnvelope(new RepoReaderError("WRITE_FIND_NOT_FOUND", "find text was not found in src/c.ts.", {
      diagnostics: {
        applied_paths: ["src/a.ts", "/Users/example/repo/src/absolute.ts"],
        failed_path: "src/c.ts",
        recovery_hint: "Run repo_git_review, then use repo_git_restore_paths for tracked applied paths or repo_cleanup_paths for generated untracked artifacts.",
        content: "OPENAI_API_KEY=sk-secret",
        diff: "@@ secret",
        stack: "Error at /Users/example/repo/src/c.ts",
        raw_output: "token sk-secret"
      }
    }));

    expect(result.structuredContent.error.diagnostics).toEqual({
      applied_paths: ["src/a.ts"],
      failed_path: "src/c.ts",
      recovery_hint: "Run repo_git_review, then use repo_git_restore_paths for tracked applied paths or repo_cleanup_paths for generated untracked artifacts."
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("/Users/example");
    expect(serialized).not.toContain("@@ secret");
  });

  test("returns actionable execution rejection diagnostics", () => {
    const result = createErrorEnvelope(new RepoReaderError("EXECUTION_POLICY_REJECTED", "Network command is blocked: curl", {
      diagnostics: {
        policy_stage: "pre_execution",
        reason_code: "NETWORK_COMMAND_BLOCKED",
        trigger: "curl",
        allowed_alternative: "Use a configured connector.",
        safe_alternative: "Use a configured connector.",
        mutation_occurred: false
      }
    }));

    expect(result.structuredContent.error.diagnostics).toEqual({
      policy_stage: "pre_execution",
      reason_code: "NETWORK_COMMAND_BLOCKED",
      trigger: "curl",
      allowed_alternative: "Use a configured connector.",
      safe_alternative: "Use a configured connector.",
      mutation_occurred: false
    });
  });
});
