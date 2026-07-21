import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { toolCatalog } from "./tools/catalog.js";
import { registerCatalogTool } from "./tools/define-tool.js";
import type { RuntimeContext } from "./runtime/context.js";
import type { KaggleTool } from "./services/kaggle-mcp-proxy.js";
import { registerKaggleTools } from "./tools/register-kaggle-tools.js";

export { SERVER_INSTRUCTIONS };
export const SERVER_VERSION = "0.2.2";
export const TOOL_SCHEMA_REVISION = "3";

export function createMcpServer(context: RuntimeContext, kaggleTools: KaggleTool[] = []): McpServer {
  const server = new McpServer(
    {
      name: "gpt-repo-mcp",
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: { listChanged: true }
      },
      instructions: SERVER_INSTRUCTIONS
    }
  );

  for (const tool of toolCatalog) {
    registerCatalogTool(server, context, tool);
  }
  registerKaggleTools(server, kaggleTools);

  return server;
}
