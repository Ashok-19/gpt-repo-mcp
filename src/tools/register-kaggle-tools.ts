import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { kaggleMcpProxy, type KaggleTool } from "../services/kaggle-mcp-proxy.js";

const KaggleArgumentsSchema = z.object({}).passthrough();
const MUTATING_KAGGLE_TOOL = /^(cancel|create|save|start|submit|update|upload)_/;

export function registerKaggleTools(server: McpServer, tools: KaggleTool[]): void {
  for (const tool of tools) {
    const mutating = MUTATING_KAGGLE_TOOL.test(tool.name);
    server.registerTool(
      `kaggle_${tool.name}`,
      {
        title: tool.title ?? `Kaggle: ${tool.name.replaceAll("_", " ")}`,
        description: `${tool.description ?? `Call Kaggle's ${tool.name} tool.`}\n\nInput schema: ${JSON.stringify(tool.inputSchema)}`,
        inputSchema: KaggleArgumentsSchema,
        annotations: {
          readOnlyHint: !mutating,
          destructiveHint: mutating,
          idempotentHint: !mutating,
          ...tool.annotations,
          openWorldHint: true
        } satisfies ToolAnnotations
      },
      async (args) => await kaggleMcpProxy.callTool(tool.name, args) as CallToolResult
    );
  }
}
