import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile, rm } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { createMcpServer } from "../src/register.js";
import { KaggleMcpProxy, kaggleMcpProxy, loadKaggleTools, type KaggleTool } from "../src/services/kaggle-mcp-proxy.js";
import { RootRegistry } from "../src/services/root-registry.js";

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

  test("registers every upstream tool as a separately callable prefixed tool", async () => {
    const tools = [
      {
        name: "search_competitions",
        description: "Search Kaggle competitions.",
        inputSchema: { type: "object", properties: { request: { type: "object" } } },
        annotations: { readOnlyHint: true }
      },
      {
        name: "submit_to_competition",
        description: "Submit to a Kaggle competition.",
        inputSchema: { type: "object", properties: { request: { type: "object" } } }
      }
    ] as KaggleTool[];
    const call = vi.spyOn(kaggleMcpProxy, "callTool").mockResolvedValue({
      content: [{ type: "text", text: "ok" }]
    });
    const registry = await RootRegistry.fromConfig({ repos: [] });
    const server = createMcpServer({ registry }, tools);
    const client = new Client({ name: "kaggle-registration-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      const search = listed.tools.find((tool) => tool.name === "kaggle_search_competitions");
      const submit = listed.tools.find((tool) => tool.name === "kaggle_submit_to_competition");
      expect(search?.description).toContain('"request"');
      expect(search?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(submit?.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });

      const result = await client.callTool({
        name: "kaggle_search_competitions",
        arguments: { request: { search: "vision" } }
      });
      expect(result.isError).toBeUndefined();
      expect(call).toHaveBeenCalledWith("search_competitions", { request: { search: "vision" } });
    } finally {
      call.mockRestore();
      await client.close();
      await server.close();
    }
  });

  test("materializes signed saved-output downloads with size and hash", async () => {
    const tools = [{
      name: "download_notebook_output",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true }
    }] as KaggleTool[];
    const remoteUrl = "https://www.kaggleusercontent.com/output/model.json";
    const call = vi.spyOn(kaggleMcpProxy, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ download_url: remoteUrl }) }]
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("artifact")));
    const registry = await RootRegistry.fromConfig({ repos: [] });
    const server = createMcpServer({ registry }, tools);
    const client = new Client({ name: "kaggle-download-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let localPath: string | undefined;

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.find((tool) => tool.name === "kaggle_download_notebook_output")?.annotations)
        .toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const result = await client.callTool({ name: "kaggle_download_notebook_output", arguments: {} });
      const artifact = (result.structuredContent as { materialized_artifact?: Record<string, unknown> }).materialized_artifact;
      localPath = artifact?.local_path as string;
      expect(artifact).toMatchObject({
        remote_artifact_url: remoteUrl,
        size_bytes: 8,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        local_path: expect.stringContaining("gpt-repo-mcp/kaggle/")
      });
      expect(await readFile(localPath, "utf8")).toBe("artifact");
    } finally {
      if (localPath) await rm(localPath, { force: true });
      call.mockRestore();
      vi.unstubAllGlobals();
      await client.close();
      await server.close();
    }
  });

  test("returns stable diagnostics when a signed URL is missing and fallback inputs are incomplete", async () => {
    const tools = [{ name: "download_notebook_output", inputSchema: { type: "object" } }] as KaggleTool[];
    const remoteUrl = "https://www.kaggleusercontent.com/output/missing.json";
    const call = vi.spyOn(kaggleMcpProxy, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ download_url: remoteUrl }) }]
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    const registry = await RootRegistry.fromConfig({ repos: [] });
    const server = createMcpServer({ registry }, tools);
    const client = new Client({ name: "kaggle-download-error-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: "kaggle_download_notebook_output",
        arguments: { ownerSlug: "owner", kernelSlug: "notebook", versionNumber: 1 }
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "KAGGLE_ARTIFACT_FALLBACK_INPUT_MISSING",
          diagnostics: { stage: "cli_fallback", owner: "owner", slug: "notebook", version: 1, http_status: 404 }
        }
      });
    } finally {
      call.mockRestore();
      vi.unstubAllGlobals();
      await client.close();
      await server.close();
    }
  });

  test("omits notebook source blobs from info responses", async () => {
    const tools = [{ name: "get_notebook_info", inputSchema: { type: "object" } }] as KaggleTool[];
    const upstream = { title: "Saved notebook", version: 1, source: "print('large source')", nested: { cells: ["large"] } };
    const call = vi.spyOn(kaggleMcpProxy, "callTool").mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(upstream) }],
      structuredContent: upstream
    });
    const registry = await RootRegistry.fromConfig({ repos: [] });
    const server = createMcpServer({ registry }, tools);
    const client = new Client({ name: "kaggle-info-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "kaggle_get_notebook_info", arguments: {} });
      expect(result.structuredContent).toEqual({ title: "Saved notebook", version: 1, nested: {} });
      expect(JSON.stringify(result.content)).not.toContain("large source");
    } finally {
      call.mockRestore();
      await client.close();
      await server.close();
    }
  });

  test("loads every upstream tools/list page", async () => {
    vi.stubEnv("GPT_REPO_KAGGLE_TOKEN", "test-token");
    vi.stubEnv("GPT_REPO_KAGGLE_TOOLS", "first,second");
    const list = vi.spyOn(kaggleMcpProxy, "listTools")
      .mockResolvedValueOnce({ tools: [{ name: "first", inputSchema: { type: "object" } }], nextCursor: "page-2" })
      .mockResolvedValueOnce({ tools: [{ name: "second", inputSchema: { type: "object" } }] });
    try {
      await expect(loadKaggleTools()).resolves.toEqual([
        expect.objectContaining({ name: "first" }),
        expect.objectContaining({ name: "second" })
      ]);
      expect(list).toHaveBeenNthCalledWith(1, undefined);
      expect(list).toHaveBeenNthCalledWith(2, "page-2");
    } finally {
      list.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  test("exposes every upstream tool by default", async () => {
    vi.stubEnv("GPT_REPO_KAGGLE_TOKEN", "test-token");
    vi.stubEnv("GPT_REPO_KAGGLE_TOOLS", "");
    const list = vi.spyOn(kaggleMcpProxy, "listTools").mockResolvedValue({ tools: [
      { name: "get_notebook_info", inputSchema: { type: "object" } },
      { name: "download_notebook_output_zip", inputSchema: { type: "object" } },
      { name: "search_competitions", inputSchema: { type: "object" } },
      { name: "submit_to_competition", inputSchema: { type: "object" } }
    ] });
    try {
      await expect(loadKaggleTools()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "get_notebook_info" }),
        expect.objectContaining({ name: "download_notebook_output_zip" }),
        expect.objectContaining({ name: "search_competitions" }),
        expect.objectContaining({ name: "submit_to_competition" })
      ]));
    } finally {
      list.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  test("supports an explicit all-tools setting", async () => {
    vi.stubEnv("GPT_REPO_KAGGLE_TOKEN", "test-token");
    vi.stubEnv("GPT_REPO_KAGGLE_TOOLS", "*");
    const tools = [
      { name: "search_competitions", inputSchema: { type: "object" } },
      { name: "submit_to_competition", inputSchema: { type: "object" } }
    ] as KaggleTool[];
    const list = vi.spyOn(kaggleMcpProxy, "listTools").mockResolvedValue({ tools });
    try {
      await expect(loadKaggleTools()).resolves.toEqual(tools);
    } finally {
      list.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
