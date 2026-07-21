import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const CONFIG_PATH = "./config.local.json";
const PORT = "8787";
const NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels";
const MCP_HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const BUILT_SERVER_PATH = "dist/server.js";
const HEALTH_INTERVAL_MS = positiveIntEnv("GPT_REPO_CONNECT_HEALTH_INTERVAL_MS", 30000);
const MCP_FAILURES_BEFORE_RESTART = positiveIntEnv("GPT_REPO_CONNECT_MCP_FAILURES_BEFORE_RESTART", 3);
const TUNNEL_FAILURES_BEFORE_RESTART = positiveIntEnv("GPT_REPO_CONNECT_TUNNEL_FAILURES_BEFORE_RESTART", 3);
const ACTIVE_HEALTH_RESTART = process.env.GPT_REPO_CONNECT_ACTIVE_HEALTH_RESTART === "true";
const USE_DEV_SERVER = process.env.GPT_REPO_CONNECT_USE_DEV === "true";
const SKIP_BUILD = process.env.GPT_REPO_CONNECT_SKIP_BUILD === "true";
const NGROK_DOMAIN = process.env.GPT_REPO_NGROK_DOMAIN ?? process.env.NGROK_DOMAIN;
const publicPathToken =
  process.env.GPT_REPO_PUBLIC_PATH_TOKEN ??
  process.env.REPO_READER_PUBLIC_PATH_TOKEN ??
  randomBytes(16).toString("hex");

const children = new Set();
let shuttingDown = false;
let mcpRestartCount = 0;
let tunnelRestartCount = 0;
let mcpChild;
let tunnelChild;
let mcpHealthFailures = 0;
let tunnelHealthFailures = 0;
let lastAnnouncedPublicUrl;
let supervisorTimer;

function positiveIntEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function prefixOutput(stream, label) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`[${label}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      process.stdout.write(`[${label}] ${buffer}\n`);
    }
  });
}

function terminateChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

async function ensureConfigExists() {
  try {
    await access(CONFIG_PATH, constants.F_OK);
  } catch {
    globalThis.console.error("Missing config.local.json. Run: cp config.example.json config.local.json");
    process.exit(1);
  }
}

async function ensureBuiltServerReady() {
  if (USE_DEV_SERVER || SKIP_BUILD) {
    return;
  }

  try {
    await access(BUILT_SERVER_PATH, constants.F_OK);
  } catch {
    globalThis.console.log("[connect] Built server missing. Running npm run build before starting MCP.");
    await runBuild();
    return;
  }

  globalThis.console.log("[connect] Refreshing built server with npm run build.");
  await runBuild();
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const build = spawn("npm", ["run", "build"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    prefixOutput(build.stdout, "build");
    prefixOutput(build.stderr, "build");
    build.once("error", reject);
    build.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm run build failed (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
  });
}

function ensureNgrokAvailable() {
  const checker = spawn("ngrok", ["version"], { stdio: "ignore" });
  checker.once("error", () => {
    globalThis.console.error("ngrok not found. Install ngrok or run npm run mcp and use another tunnel.");
    process.exit(1);
  });
  checker.once("exit", (code) => {
    if (code !== 0) {
      globalThis.console.error("ngrok not found. Install ngrok or run npm run mcp and use another tunnel.");
      process.exit(1);
    }
    void startProcesses().catch((error) => {
      globalThis.console.error(`[connect] startup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function printChatGptUrl(publicUrl) {
  lastAnnouncedPublicUrl = publicUrl;
  const normalized = publicUrl.replace(/\/$/, "");
  globalThis.console.log(`ChatGPT MCP URL: ${normalized}/t/${publicPathToken}/mcp`);
  globalThis.console.log("After an MCP upgrade, refresh or recreate the ChatGPT connector before opening a new chat; ChatGPT may otherwise retain old tool schemas.");
  globalThis.console.log(
    "This is guess-resistance only, not authentication. Anyone with the full URL can reach the endpoint while the tunnel is running. Stop with Ctrl+C when done."
  );
  if (!NGROK_DOMAIN) {
    globalThis.console.log("For a stable URL across ngrok restarts, set GPT_REPO_NGROK_DOMAIN to a reserved ngrok domain before running npm run connect.");
  }
  if (!ACTIVE_HEALTH_RESTART) {
    globalThis.console.log("Health monitor is passive: live MCP/ngrok processes are not restarted unless they exit.");
  }
}

async function readNgrokHttpsUrl() {
  const response = await globalThis.fetch(NGROK_API_URL);
  if (!response.ok) {
    return undefined;
  }
  const payload = await response.json();
  const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
  const httpsTunnel = tunnels.find((tunnel) =>
    typeof tunnel?.public_url === "string"
    && tunnel.public_url.startsWith("https://")
    && tunnelTargetsLocalMcpPort(tunnel)
  );
  return httpsTunnel?.public_url;
}

function tunnelTargetsLocalMcpPort(tunnel) {
  const rawAddr = typeof tunnel?.config?.addr === "string" ? tunnel.config.addr : "";
  if (!rawAddr) {
    return false;
  }
  const normalized = rawAddr
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return normalized === `localhost:${PORT}`
    || normalized === `127.0.0.1:${PORT}`
    || normalized.endsWith(`:${PORT}`);
}

async function waitForLocalHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await globalThis.fetch(MCP_HEALTH_URL);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry while the dev server starts or restarts.
    }
    await sleep(500);
  }
  return false;
}

async function isLocalMcpHealthy() {
  try {
    const response = await globalThis.fetch(MCP_HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function announceNgrokUrl() {
  const healthy = await waitForLocalHealth();
  if (!healthy) {
    globalThis.console.warn(`[connect] MCP health check did not pass yet at ${MCP_HEALTH_URL}; keeping tunnel startup alive.`);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const publicUrl = await readNgrokHttpsUrl();
      if (publicUrl) {
        if (publicUrl !== lastAnnouncedPublicUrl) {
          printChatGptUrl(publicUrl);
        }
        return;
      }
    } catch {
      // Retry while ngrok initializes its local API.
    }
    await sleep(500);
  }

  globalThis.console.log(
    `Could not auto-detect ngrok URL. Open http://127.0.0.1:4040 or look for the HTTPS forwarding URL in [tunnel] output and append /t/${publicPathToken}/mcp.`
  );
}

function trackChild(child) {
  children.add(child);
  child.once("exit", () => {
    children.delete(child);
  });
}

function restartDelay(count) {
  return Math.min(1000 * 2 ** Math.max(0, count - 1), 10000);
}

function startMcpProcess() {
  const command = USE_DEV_SERVER ? "npm" : process.execPath;
  const args = USE_DEV_SERVER ? ["run", "dev"] : [BUILT_SERVER_PATH];
  const mcp = spawn(command, args, {
    env: {
      ...process.env,
      GPT_REPO_CONFIG: CONFIG_PATH,
      REPO_READER_CONFIG: CONFIG_PATH,
      PORT,
      GPT_REPO_PUBLIC_PATH_TOKEN: publicPathToken,
      REPO_READER_PUBLIC_PATH_TOKEN: publicPathToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  mcpChild = mcp;
  trackChild(mcp);
  prefixOutput(mcp.stdout, "mcp");
  prefixOutput(mcp.stderr, "mcp");
  mcp.once("spawn", () => {
    mcpHealthFailures = 0;
  });
  mcp.once("error", (error) => {
    globalThis.console.error(`[mcp] spawn error: ${error.message}`);
  });
  mcp.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (mcpChild === mcp) {
      mcpChild = undefined;
    }
    mcpRestartCount += 1;
    const delay = restartDelay(mcpRestartCount);
    globalThis.console.error(`[mcp] exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Restarting in ${delay}ms.`);
    globalThis.setTimeout(() => {
      if (!shuttingDown) {
        startMcpProcess();
      }
    }, delay);
  });
}

function startTunnelProcess() {
  const ngrokArgs = ["http", PORT, "--log=stdout"];
  if (NGROK_DOMAIN) {
    ngrokArgs.push(`--domain=${NGROK_DOMAIN}`);
  }
  const tunnel = spawn("ngrok", ngrokArgs, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  tunnelChild = tunnel;
  trackChild(tunnel);
  prefixOutput(tunnel.stdout, "tunnel");
  prefixOutput(tunnel.stderr, "tunnel");
  tunnel.once("error", (error) => {
    globalThis.console.error(`[tunnel] spawn error: ${error.message}`);
  });
  tunnel.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (tunnelChild === tunnel) {
      tunnelChild = undefined;
    }
    tunnelRestartCount += 1;
    const delay = restartDelay(tunnelRestartCount);
    globalThis.console.error(`[tunnel] exited (code=${code ?? "null"}, signal=${signal ?? "null"}). Restarting in ${delay}ms.`);
    globalThis.setTimeout(() => {
      if (!shuttingDown) {
        startTunnelProcess();
        void announceNgrokUrl();
      }
    }, delay);
  });
}

function restartMcp(reason) {
  if (shuttingDown) {
    return;
  }
  globalThis.console.error(`[connect] Restarting MCP server: ${reason}`);
  const child = mcpChild;
  if (child && !child.killed) {
    child.kill("SIGTERM");
    globalThis.setTimeout(() => {
      if (mcpChild === child && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 1500);
    return;
  }
  startMcpProcess();
}

function restartTunnel(reason) {
  if (shuttingDown) {
    return;
  }
  globalThis.console.error(`[connect] Restarting ngrok tunnel: ${reason}`);
  const child = tunnelChild;
  if (child && !child.killed) {
    child.kill("SIGTERM");
    globalThis.setTimeout(() => {
      if (tunnelChild === child && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 1500);
    return;
  }
  startTunnelProcess();
}

function startSupervisor() {
  if (supervisorTimer) {
    return;
  }
  supervisorTimer = globalThis.setInterval(() => {
    void superviseOnce();
  }, HEALTH_INTERVAL_MS);
}

async function superviseOnce() {
  if (shuttingDown) {
    return;
  }

  if (await isLocalMcpHealthy()) {
    mcpHealthFailures = 0;
    mcpRestartCount = 0;
  } else {
    mcpHealthFailures += 1;
    globalThis.console.error(`[connect] MCP health check failed (${mcpHealthFailures}/${MCP_FAILURES_BEFORE_RESTART}).`);
    if (mcpHealthFailures >= MCP_FAILURES_BEFORE_RESTART) {
      mcpHealthFailures = 0;
      if (ACTIVE_HEALTH_RESTART) {
        restartMcp("local /health did not respond");
      } else {
        globalThis.console.error("[connect] MCP health restart skipped; process is still supervised by exit handler.");
      }
    }
  }

  try {
    const publicUrl = await readNgrokHttpsUrl();
    if (publicUrl) {
      tunnelHealthFailures = 0;
      tunnelRestartCount = 0;
      if (lastAnnouncedPublicUrl && publicUrl !== lastAnnouncedPublicUrl) {
        globalThis.console.warn("[connect] ngrok public URL changed. Update the ChatGPT connector if calls start failing.");
        printChatGptUrl(publicUrl);
      } else if (!lastAnnouncedPublicUrl) {
        printChatGptUrl(publicUrl);
      }
      return;
    }
  } catch {
    // Count below.
  }

  tunnelHealthFailures += 1;
  globalThis.console.error(`[connect] ngrok tunnel check failed (${tunnelHealthFailures}/${TUNNEL_FAILURES_BEFORE_RESTART}).`);
  if (tunnelHealthFailures >= TUNNEL_FAILURES_BEFORE_RESTART) {
    tunnelHealthFailures = 0;
    if (ACTIVE_HEALTH_RESTART) {
      restartTunnel("no healthy ngrok tunnel to local MCP port");
    } else {
      globalThis.console.error("[connect] ngrok health restart skipped; process is still supervised by exit handler.");
    }
  }
}

async function startProcesses() {
  globalThis.console.log("Use the HTTPS ngrok URL with the printed /t/<token>/mcp path in ChatGPT Developer Mode.");

  await ensureBuiltServerReady();
  startMcpProcess();
  startSupervisor();

  try {
    await waitForLocalHealth();
    const existingTunnel = await readNgrokHttpsUrl();
    if (existingTunnel) {
      globalThis.console.log("Reusing existing ngrok tunnel.");
      printChatGptUrl(existingTunnel);
      return;
    }
  } catch {
    // No reusable tunnel detected yet.
  }

  startTunnelProcess();
  void announceNgrokUrl();
}

function handleShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  globalThis.console.log(`Received ${signal}. Shutting down MCP server and tunnel.`);
  if (supervisorTimer) {
    globalThis.clearInterval(supervisorTimer);
  }
  terminateChildren("SIGTERM");
  globalThis.setTimeout(() => terminateChildren("SIGKILL"), 1500);
  globalThis.setTimeout(() => process.exit(0), 1700);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

await ensureConfigExists();
ensureNgrokAvailable();
