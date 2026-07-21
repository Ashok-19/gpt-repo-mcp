import { describe, expect, test } from "vitest";
import {
  buildMcpRoutePatterns,
  buildPublicMcpPath,
  isAuthorizedMcpPath,
  sanitizeMcpRouteForAudit
} from "../src/runtime/mcp-routes.js";

describe("public MCP path token routing", () => {
  test("keeps /mcp authorized when no public path token is configured", () => {
    expect(buildMcpRoutePatterns(undefined)).toEqual(["/s/:schemaRevision/mcp"]);
    expect(isAuthorizedMcpPath("/s/3/mcp", undefined, "3")).toBe(true);
    expect(isAuthorizedMcpPath("/mcp", undefined, "3")).toBe(false);
  });

  test("requires the token-prefixed path when a public path token is configured", () => {
    const token = "0123456789abcdef0123456789abcdef";

    expect(buildMcpRoutePatterns(token)).toEqual(["/s/:schemaRevision/t/:publicPathToken/mcp"]);
    expect(buildPublicMcpPath(token, "3")).toBe("/s/3/t/0123456789abcdef0123456789abcdef/mcp");
    expect(isAuthorizedMcpPath("/mcp", token, "3")).toBe(false);
    expect(isAuthorizedMcpPath("/s/3/t/0123456789abcdef0123456789abcdef/mcp", token, "3")).toBe(true);
    expect(isAuthorizedMcpPath("/s/2/t/0123456789abcdef0123456789abcdef/mcp", token, "3")).toBe(false);
  });

  test("sanitizes token-prefixed routes for audit logs", () => {
    expect(sanitizeMcpRouteForAudit("/s/3/mcp")).toBe("/s/[revision]/mcp");
    expect(sanitizeMcpRouteForAudit("/s/3/t/0123456789abcdef0123456789abcdef/mcp")).toBe("/s/[revision]/t/[token]/mcp");
  });
});
