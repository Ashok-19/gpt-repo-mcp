import { describe, expect, test, vi } from "vitest";
import { KaggleMcpProxy } from "../src/services/kaggle-mcp-proxy.js";

describe("KaggleMcpProxy", () => {
  test("connects once and forwards list and call requests", async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: "search_competitions", inputSchema: { type: "object" } }] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] })
    };
    const createClient = vi.fn().mockResolvedValue(client);
    const proxy = new KaggleMcpProxy(createClient);

    await expect(proxy.listTools("next")).resolves.toMatchObject({ tools: [{ name: "search_competitions" }] });
    await expect(proxy.callTool("search_competitions", { request: { search: "vision" } })).resolves.toMatchObject({
      content: [{ type: "text", text: "ok" }]
    });
    expect(createClient).toHaveBeenCalledOnce();
    expect(client.listTools).toHaveBeenCalledWith({ cursor: "next" });
    expect(client.callTool).toHaveBeenCalledWith({
      name: "search_competitions",
      arguments: { request: { search: "vision" } }
    });
  });
});
