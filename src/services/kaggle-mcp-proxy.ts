import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

type UpstreamClient = Pick<Client, "listTools" | "callTool">;
type ClientFactory = () => Promise<UpstreamClient>;
export type KaggleTool = ListToolsResult["tools"][number];

export class KaggleMcpProxy {
  private client?: Promise<UpstreamClient>;

  constructor(private readonly createClient: ClientFactory = connectKaggleMcp) {}

  listTools(cursor?: string) {
    return this.withClient((client) => client.listTools(cursor ? { cursor } : undefined));
  }

  callTool(name: string, args: Record<string, unknown>) {
    return this.withClient((client) => client.callTool({ name, arguments: args }));
  }

  private async withClient<T>(operation: (client: UpstreamClient) => Promise<T>): Promise<T> {
    try {
      return await operation(await (this.client ??= this.createClient()));
    } catch (error) {
      this.client = undefined;
      throw error;
    }
  }
}

async function connectKaggleMcp(): Promise<Client> {
  const token = process.env.GPT_REPO_KAGGLE_TOKEN;
  if (!token) {
    throw new Error("Kaggle MCP is not configured. Set GPT_REPO_KAGGLE_TOKEN in .env and restart npm run connect.");
  }

  const client = new Client({ name: "gpt-repo-kaggle-bridge", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.GPT_REPO_KAGGLE_MCP_URL ?? "https://www.kaggle.com/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  );
  await client.connect(transport);
  return client;
}

export const kaggleMcpProxy = new KaggleMcpProxy();

export async function loadKaggleTools(): Promise<KaggleTool[]> {
  if (!process.env.GPT_REPO_KAGGLE_TOKEN) {
    return [];
  }
  try {
    const tools: KaggleTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await kaggleMcpProxy.listTools(cursor);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const configured = process.env.GPT_REPO_KAGGLE_TOOLS?.split(",").map((name) => name.trim()).filter(Boolean);
    if (!configured?.length || configured.includes("*")) return tools;
    const allowed = new Set(configured);
    return tools.filter((tool) => allowed.has(tool.name));
  } catch (error) {
    console.warn(`[kaggle] Could not load upstream tools: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
