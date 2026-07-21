import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { RootRegistry } from "./services/root-registry.js";
import { loadKaggleTools } from "./services/kaggle-mcp-proxy.js";
import { createMcpServer, SERVER_VERSION } from "./register.js";
import { toolCatalog } from "./tools/catalog.js";
import type { RuntimeContext } from "./runtime/context.js";
import { buildMcpRoutePatterns, isAuthorizedMcpPath, sanitizeMcpRouteForAudit } from "./runtime/mcp-routes.js";
import {
  createRequestId,
  agentIdFromSessionId,
  requestAudit,
  withRequestTelemetry,
  type RequestTelemetryContext
} from "./runtime/telemetry.js";

const port = Number(process.env.PORT ?? 8787);
const configPath = process.env.GPT_REPO_CONFIG ?? process.env.REPO_READER_CONFIG;
const publicPathToken = process.env.GPT_REPO_PUBLIC_PATH_TOKEN ?? process.env.REPO_READER_PUBLIC_PATH_TOKEN;
const httpBodyLimit = process.env.GPT_REPO_HTTP_BODY_LIMIT ?? process.env.REPO_READER_HTTP_BODY_LIMIT ?? "50mb";
const useJsonTransportResponses = (process.env.GPT_REPO_MCP_JSON_RESPONSE ?? "true") !== "false";

const registry = configPath
  ? await RootRegistry.fromFile(configPath)
  : await RootRegistry.fromConfig({ repos: [], limits: {} });
const context: RuntimeContext = { registry };
const kaggleTools = await loadKaggleTools();

function logRuntimeError(event: "unhandled_rejection" | "uncaught_exception", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", event, message: message.slice(0, 300) }));
}

process.on("unhandledRejection", (reason) => {
  logRuntimeError("unhandled_rejection", reason);
});

process.on("uncaughtExceptionMonitor", (error) => {
  logRuntimeError("uncaught_exception", error);
});

const app = express();
app.use(express.json({ limit: httpBodyLimit }));
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!isHttpBodyParseError(error)) {
    next(error);
    return;
  }

  const requestId = createRequestId();
  requestAudit({
    event: "mcp_request_error",
    request_id: requestId,
    http_method: req.method,
    route: sanitizeMcpRouteForAudit(req.path),
    status_code: error.status,
    duration_ms: 0,
    mcp_session: typeof req.headers["mcp-session-id"] === "string" ? "present" : "missing",
    mcp_method: "parse"
  });
  res.status(error.status).json({
    jsonrpc: "2.0",
    error: {
      code: error.status === 413 ? -32000 : -32700,
      message: error.status === 413 ? "Request body too large" : "Parse error: invalid JSON request body"
    },
    id: null
  });
});

const transports: Record<string, StreamableHTTPServerTransport> = {};
const mcpRoutePatterns = buildMcpRoutePatterns(publicPathToken);

app.get("/health", (_req, res) => {
  const memory = process.memoryUsage();
  res.json({
    ok: true,
    name: "gpt-repo-mcp",
    version: SERVER_VERSION,
    core_tool_count: toolCatalog.length,
    kaggle_tool_count: kaggleTools.length,
    uptime_seconds: Math.floor(process.uptime()),
    sessions: Object.keys(transports).length,
    rss_mb: Math.round(memory.rss / 1024 / 1024)
  });
});

function isHttpBodyParseError(error: unknown): error is { status: number } {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { status?: unknown; type?: unknown };
  return typeof candidate.status === "number"
    && (candidate.type === "entity.parse.failed" || candidate.type === "entity.too.large");
}

function createTransport(): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: useJsonTransportResponses,
    onsessioninitialized: (newSessionId) => {
      transports[newSessionId] = transport;
      requestAudit({
        event: "mcp_request_start",
        request_id: createRequestId(),
        http_method: "MCP",
        route: "/mcp",
        mcp_session: "present",
        agent_id: agentIdFromSessionId(newSessionId),
        mcp_method: "session_initialized"
      });
    },
    onsessionclosed: (closedSessionId) => {
      delete transports[closedSessionId];
    }
  });

  transport.onclose = () => {
    const closedSessionId = transport.sessionId;
    if (closedSessionId) {
      delete transports[closedSessionId];
    }
  };
  transport.onerror = (error) => {
    requestAudit({
      event: "mcp_request_error",
      request_id: createRequestId(),
      http_method: "MCP",
      route: "/mcp",
      status_code: 500,
      mcp_session: transport.sessionId ? "present" : "missing",
      agent_id: transport.sessionId ? agentIdFromSessionId(transport.sessionId) : undefined,
      mcp_method: "transport_error",
      mcp_tool: error.message.slice(0, 80)
    });
  };

  return transport;
}

function createMcpRequestContext(req: Request): RequestTelemetryContext {
  const method = typeof req.body?.method === "string" ? req.body.method : undefined;
  const tool =
    method === "tools/call" && typeof req.body?.params?.name === "string"
      ? req.body.params.name
      : undefined;
  const sessionId = typeof req.headers["mcp-session-id"] === "string" ? req.headers["mcp-session-id"] : undefined;

  return {
    request_id: createRequestId(),
    http_method: req.method,
    route: sanitizeMcpRouteForAudit(req.path),
    mcp_session: sessionId ? "present" : "missing",
    ...(sessionId ? { agent_id: agentIdFromSessionId(sessionId) } : {}),
    mcp_method: method,
    mcp_tool: tool
  };
}

function attachMcpRequestAuditing(res: Response, context: RequestTelemetryContext, startedAt: number): void {
  res.on("finish", () => {
    requestAudit({
      event: "mcp_request_finish",
      request_id: context.request_id,
      http_method: context.http_method ?? "UNKNOWN",
      route: context.route ?? "/mcp",
      status_code: res.statusCode,
      duration_ms: Date.now() - startedAt,
      mcp_session: context.mcp_session,
      agent_id: context.agent_id,
      mcp_method: context.mcp_method,
      mcp_tool: context.mcp_tool
    });
  });
}

function rejectUnauthorizedMcpPath(req: Request, res: Response): boolean {
  if (isAuthorizedMcpPath(req.path, publicPathToken)) {
    return false;
  }
  res.status(404).send("Not found");
  return true;
}

app.post(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const startedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, startedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "POST",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      agent_id: requestContext.agent_id,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (typeof sessionId === "string" && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = createTransport();
        await createMcpServer(context, kaggleTools).connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid MCP session" },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch {
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "POST",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - startedAt,
        mcp_session: requestContext.mcp_session,
        agent_id: requestContext.agent_id,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });
});

app.get(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const startedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, startedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "GET",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      agent_id: requestContext.agent_id,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId !== "string" || !transports[sessionId]) {
        res.status(400).send("Invalid or missing MCP session id");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    } catch {
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "GET",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - startedAt,
        mcp_session: requestContext.mcp_session,
        agent_id: requestContext.agent_id,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });
});

app.delete(mcpRoutePatterns, async (req: Request, res: Response) => {
  const requestContext = createMcpRequestContext(req);
  const startedAt = Date.now();
  attachMcpRequestAuditing(res, requestContext, startedAt);

  return withRequestTelemetry(requestContext, async () => {
    requestAudit({
      event: "mcp_request_start",
      request_id: requestContext.request_id,
      http_method: requestContext.http_method ?? "DELETE",
      route: requestContext.route ?? "/mcp",
      mcp_session: requestContext.mcp_session,
      agent_id: requestContext.agent_id,
      mcp_method: requestContext.mcp_method,
      mcp_tool: requestContext.mcp_tool
    });

    if (rejectUnauthorizedMcpPath(req, res)) {
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      if (typeof sessionId !== "string" || !transports[sessionId]) {
        res.status(400).send("Invalid or missing MCP session id");
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    } catch {
      requestAudit({
        event: "mcp_request_error",
        request_id: requestContext.request_id,
        http_method: requestContext.http_method ?? "DELETE",
        route: requestContext.route ?? "/mcp",
        duration_ms: Date.now() - startedAt,
        mcp_session: requestContext.mcp_session,
        agent_id: requestContext.agent_id,
        mcp_method: requestContext.mcp_method,
        mcp_tool: requestContext.mcp_tool
      });
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });
});

const httpServer = app.listen(port, () => {
  const localPath = publicPathToken ? "/t/[token]/mcp" : "/mcp";
  console.error(`gpt-repo-mcp listening on http://localhost:${port}${localPath}`);
});

httpServer.requestTimeout = 0;
httpServer.keepAliveTimeout = 120_000;
httpServer.headersTimeout = 130_000;
