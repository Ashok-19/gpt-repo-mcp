import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { kaggleMcpProxy, type KaggleTool } from "../services/kaggle-mcp-proxy.js";

const KaggleArgumentsSchema = z.object({}).passthrough();
const MUTATING_KAGGLE_TOOL = /^(cancel|create|save|start|submit|update|upload)_/;
const DOWNLOAD_TOOLS = new Set(["download_notebook_output", "download_notebook_output_zip"]);
const SAVED_NOTEBOOK_TOOLS = new Set(["get_notebook_info", "list_notebook_files", ...DOWNLOAD_TOOLS]);
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export function registerKaggleTools(server: McpServer, tools: KaggleTool[]): void {
  for (const tool of tools) {
    const mutating = MUTATING_KAGGLE_TOOL.test(tool.name);
    const materializes = DOWNLOAD_TOOLS.has(tool.name);
    server.registerTool(
      `kaggle_${tool.name}`,
      {
        title: tool.title ?? `Kaggle: ${tool.name.replaceAll("_", " ")}`,
        description: `${tool.description ?? `Call Kaggle's ${tool.name} tool.`}${SAVED_NOTEBOOK_TOOLS.has(tool.name) ? " Saved versions use numeric version identifiers; omit version-label fields unless Kaggle returned a valid label." : ""}\n\nInput schema: ${JSON.stringify(tool.inputSchema)}`,
        inputSchema: KaggleArgumentsSchema,
        annotations: {
          ...tool.annotations,
          readOnlyHint: !mutating && !materializes,
          destructiveHint: mutating,
          idempotentHint: !mutating,
          openWorldHint: true
        } satisfies ToolAnnotations
      },
      async (args) => {
        const result = await kaggleMcpProxy.callTool(tool.name, args) as CallToolResult;
        if (DOWNLOAD_TOOLS.has(tool.name)) return await materializeDownload(result, tool.name);
        return tool.name === "get_notebook_info" ? compactNotebookInfo(result) : result;
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

async function materializeDownload(result: CallToolResult, toolName: string): Promise<CallToolResult> {
  const remoteUrl = findDownloadUrl(result.structuredContent) ?? findDownloadUrl(result.content);
  if (!remoteUrl) return result;

  const url = new URL(remoteUrl);
  if (url.protocol !== "https:" || !isKaggleDownloadHost(url.hostname)) return result;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Kaggle artifact download failed with HTTP ${response.status}.`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_DOWNLOAD_BYTES) throw new Error(`Kaggle artifact exceeds the ${MAX_DOWNLOAD_BYTES}-byte local materialization limit.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error(`Kaggle artifact exceeds the ${MAX_DOWNLOAD_BYTES}-byte local materialization limit.`);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
