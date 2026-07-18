import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type UpstreamClient = Pick<Client, "listTools" | "callTool">;
type ClientFactory = () => Promise<UpstreamClient>;

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

  const client = new Client({ name: "gpt-repo-kaggle-bridge", version: "0.1.1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.GPT_REPO_KAGGLE_MCP_URL ?? "https://www.kaggle.com/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  );
  await client.connect(transport);
  return client;
}

export const kaggleMcpProxy = new KaggleMcpProxy();
