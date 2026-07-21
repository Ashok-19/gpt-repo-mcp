import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { kaggleMcpProxy, type KaggleTool } from "../services/kaggle-mcp-proxy.js";

const KaggleArgumentsSchema = z.object({}).passthrough();
const MUTATING_KAGGLE_TOOL = /^(cancel|create|save|start|submit|update|upload)_/;
const DOWNLOAD_TOOLS = new Set(["download_notebook_output", "download_notebook_output_zip"]);
const SAVED_NOTEBOOK_TOOLS = new Set(["get_notebook_info", "list_notebook_files", ...DOWNLOAD_TOOLS]);
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export function registerKaggleTools(server: McpServer, tools: KaggleTool[]): void {
  for (const tool of tools) {
    const mutating = MUTATING_KAGGLE_TOOL.test(tool.name);
    server.registerTool(
      `kaggle_${tool.name}`,
      {
        title: tool.title ?? `Kaggle: ${tool.name.replaceAll("_", " ")}`,
        description: `${tool.description ?? `Call Kaggle's ${tool.name} tool.`}${SAVED_NOTEBOOK_TOOLS.has(tool.name) ? " Saved versions use numeric version identifiers; omit version-label fields unless Kaggle returned a valid label." : ""}\n\nInput schema: ${JSON.stringify(tool.inputSchema)}`,
        inputSchema: KaggleArgumentsSchema,
        annotations: {
          ...tool.annotations,
          readOnlyHint: !mutating,
          destructiveHint: mutating,
          idempotentHint: !mutating,
          openWorldHint: true
        } satisfies ToolAnnotations
      },
      async (args) => {
        try {
          const result = await kaggleMcpProxy.callTool(tool.name, args) as CallToolResult;
          if (DOWNLOAD_TOOLS.has(tool.name)) return await materializeDownload(result, tool.name, args);
          return tool.name === "get_notebook_info" ? compactNotebookInfo(result) : result;
        } catch (error) {
          if (!DOWNLOAD_TOOLS.has(tool.name)) throw error;
          return kaggleDownloadErrorResult(error, args);
        }
      }
    );
  }
}

function compactNotebookInfo(result: CallToolResult): CallToolResult {
  return {
    ...result,
    content: result.content.map((block) => {
      if (block.type !== "text") return block;
      try {
        return { ...block, text: JSON.stringify(withoutNotebookSource(JSON.parse(block.text))) };
      } catch {
        return block;
      }
    }),
    ...(result.structuredContent ? { structuredContent: withoutNotebookSource(result.structuredContent) as Record<string, unknown> } : {})
  };
}

function withoutNotebookSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNotebookSource);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(cells|code|kernel_source|notebook_source|script|source)$/i.test(key))
    .map(([key, item]) => [key, withoutNotebookSource(item)]));
}

async function materializeDownload(result: CallToolResult, toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const remoteUrl = findDownloadUrl(result.structuredContent) ?? findDownloadUrl(result.content);
  if (!remoteUrl) throw downloadError("KAGGLE_ARTIFACT_URL_MISSING", "url_resolution", args, "Kaggle did not return a signed artifact URL.");

  const url = new URL(remoteUrl);
  if (url.protocol !== "https:" || !isKaggleDownloadHost(url.hostname)) {
    throw downloadError("KAGGLE_ARTIFACT_URL_REJECTED", "url_resolution", args, "Kaggle returned an untrusted artifact URL.");
  }
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw downloadError("KAGGLE_ARTIFACT_FETCH_FAILED", "artifact_fetch", args, "Kaggle artifact fetch failed.", { upstream_error: safeErrorText(error) });
  }
  if (!response.ok) {
    if (response.status === 404 && toolName === "download_notebook_output") {
      return await materializeWithKaggleCli(result, args, remoteUrl, response.status);
    }
    throw downloadError("KAGGLE_ARTIFACT_FETCH_FAILED", "artifact_fetch", args, `Kaggle artifact fetch failed with HTTP ${response.status}.`, { http_status: response.status });
  }
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_DOWNLOAD_BYTES) throw downloadError("KAGGLE_ARTIFACT_TOO_LARGE", "artifact_fetch", args, `Kaggle artifact exceeds the ${MAX_DOWNLOAD_BYTES}-byte local materialization limit.`, { declared_bytes: declaredBytes });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw downloadError("KAGGLE_ARTIFACT_TOO_LARGE", "artifact_fetch", args, `Kaggle artifact exceeds the ${MAX_DOWNLOAD_BYTES}-byte local materialization limit.`, { downloaded_bytes: buffer.length });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const remoteName = sanitizeFilename(basename(url.pathname));
  const fallbackName = toolName.endsWith("_zip") ? "notebook-output.zip" : "notebook-output.bin";
  const directory = join(tmpdir(), "gpt-repo-mcp", "kaggle");
  const localPath = join(directory, `${sha256.slice(0, 12)}-${remoteName || fallbackName}`);
  await mkdir(directory, { recursive: true });
  await writeFile(localPath, buffer);
  const artifact = { remote_artifact_url: remoteUrl, local_path: localPath, size_bytes: buffer.length, sha256 };

  return {
    ...result,
    content: [...result.content, { type: "text", text: JSON.stringify({ materialized_artifact: artifact }) }],
    structuredContent: {
      ...(isRecord(result.structuredContent) ? result.structuredContent : {}),
      materialized_artifact: artifact
    }
  };
}

async function materializeWithKaggleCli(result: CallToolResult, args: Record<string, unknown>, remoteUrl: string, httpStatus: number): Promise<CallToolResult> {
  const requested = requestedArtifact(args);
  if (!requested.owner || !requested.slug || !requested.file) {
    throw downloadError("KAGGLE_ARTIFACT_FALLBACK_INPUT_MISSING", "cli_fallback", args, "Signed URL returned 404 and the request lacks owner, slug, or output file for the official CLI fallback.", { http_status: httpStatus });
  }
  const directory = await mkdtemp(join(tmpdir(), "gpt-repo-mcp-kaggle-"));
  try {
    await execFileAsync("kaggle", ["kernels", "output", `${requested.owner}/${requested.slug}`, "-p", directory, "-o", "-q"], {
      timeout: 120_000,
      maxBuffer: 1_000_000,
      env: { ...process.env, ...(process.env.GPT_REPO_KAGGLE_TOKEN ? { KAGGLE_API_TOKEN: process.env.GPT_REPO_KAGGLE_TOKEN } : {}) }
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw downloadError("KAGGLE_ARTIFACT_CLI_FALLBACK_FAILED", "cli_fallback", args, "Signed URL returned 404 and the official Kaggle CLI fallback failed.", { http_status: httpStatus, upstream_error: safeErrorText(error) });
  }
  const files = await listFiles(directory);
  const requestedPath = requested.file.replace(/^\/+/, "");
  const exact = files.find((path) => relative(directory, path).replaceAll("\\", "/") === requestedPath);
  const basenameMatches = files.filter((path) => basename(path) === basename(requestedPath));
  const selected = exact ?? (basenameMatches.length === 1 ? basenameMatches[0] : undefined);
  if (!selected) {
    await rm(directory, { recursive: true, force: true });
    throw downloadError("KAGGLE_ARTIFACT_NOT_FOUND", "cli_fallback", args, "The official Kaggle CLI completed but did not produce one unambiguous requested output file.", { http_status: httpStatus, candidate_count: basenameMatches.length });
  }
  const buffer = await readFile(selected);
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    await rm(directory, { recursive: true, force: true });
    throw downloadError("KAGGLE_ARTIFACT_TOO_LARGE", "cli_fallback", args, `Kaggle artifact exceeds the ${MAX_DOWNLOAD_BYTES}-byte local materialization limit.`, { downloaded_bytes: buffer.length });
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const artifact = {
    remote_artifact_url: remoteUrl,
    local_path: selected,
    size_bytes: buffer.length,
    sha256,
    retrieval: "kaggle_cli_latest_output_fallback",
    requested_version: requested.version
  };
  return {
    ...result,
    content: [...result.content, { type: "text", text: JSON.stringify({ materialized_artifact: artifact }) }],
    structuredContent: { ...(isRecord(result.structuredContent) ? result.structuredContent : {}), materialized_artifact: artifact }
  };
}

function findDownloadUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    try {
      return findDownloadUrl(JSON.parse(value));
    } catch {
      return value.match(/https:\/\/[^\s"']+/)?.[0];
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDownloadUrl(item);
      if (found) return found;
    }
  }
  if (isRecord(value)) {
    for (const key of ["download_url", "signed_url", "url", "text"]) {
      const found = findDownloadUrl(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findDownloadUrl(item);
      if (found) return found;
    }
  }
  return undefined;
}

function isKaggleDownloadHost(hostname: string): boolean {
  return hostname === "storage.googleapis.com"
    || hostname === "kaggle.com"
    || hostname.endsWith(".kaggle.com")
    || hostname.endsWith(".kaggleusercontent.com");
}

function sanitizeFilename(value: string): string {
  return decodeURIComponent(value).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
}

function requestedArtifact(args: Record<string, unknown>) {
  const combined = findField(args, ["kernel", "notebook", "notebook_id"]);
  const [combinedOwner, combinedSlug] = typeof combined === "string" && combined.includes("/") ? combined.split("/", 2) : [];
  return {
    owner: stringField(findField(args, ["owner", "username", "ownerslug"])) ?? combinedOwner,
    slug: stringField(findField(args, ["slug", "kernel_slug", "notebook_slug", "kernelslug"])) ?? combinedSlug,
    version: findField(args, ["version", "version_number", "saved_version", "versionnumber"]),
    file: stringField(findField(args, ["file", "file_name", "filename", "output_path", "path", "filepath"]))
  };
}

function findField(value: unknown, keys: string[]): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findField(item, keys);
      if (found !== undefined) return found;
    }
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (keys.includes(key.toLowerCase()) && (typeof item === "string" || typeof item === "number")) return item;
    }
    for (const item of Object.values(value)) {
      const found = findField(item, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

class KaggleDownloadError extends Error {
  constructor(readonly code: string, readonly diagnostics: Record<string, unknown>, message: string) {
    super(message);
  }
}

function downloadError(code: string, stage: string, args: Record<string, unknown>, message: string, extra: Record<string, unknown> = {}): KaggleDownloadError {
  return new KaggleDownloadError(code, { stage, ...requestedArtifact(args), ...extra }, message);
}

function kaggleDownloadErrorResult(error: unknown, args: Record<string, unknown>): CallToolResult {
  const normalized = error instanceof KaggleDownloadError
    ? error
    : downloadError("KAGGLE_SAVED_OUTPUT_FAILED", "upstream_tool", args, "Kaggle saved-output retrieval failed.", { upstream_error: safeErrorText(error) });
  const payload = { ok: false, error: { code: normalized.code, message: normalized.message, diagnostics: normalized.diagnostics } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

function safeErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https:\/\/\S+/g, "[redacted-url]").replace(/(token|key|secret)=\S+/gi, "$1=[redacted]").slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
