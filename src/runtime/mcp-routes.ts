export function buildPublicMcpPath(token: string, schemaRevision: string): string {
  return `/s/${encodeURIComponent(schemaRevision)}/t/${encodeURIComponent(token)}/mcp`;
}

export function buildMcpRoutePatterns(token: string | undefined): string[] {
  return token ? ["/s/:schemaRevision/t/:publicPathToken/mcp"] : ["/s/:schemaRevision/mcp"];
}

export function sanitizeMcpRouteForAudit(path: string): string {
  return path.includes("/t/") && path.endsWith("/mcp") ? "/s/[revision]/t/[token]/mcp" : "/s/[revision]/mcp";
}

export function isAuthorizedMcpPath(path: string, token: string | undefined, schemaRevision: string): boolean {
  if (!token) {
    return path === `/s/${encodeURIComponent(schemaRevision)}/mcp`;
  }

  return path === buildPublicMcpPath(token, schemaRevision);
}
