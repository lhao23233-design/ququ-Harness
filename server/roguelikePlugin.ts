import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

const gameRoot = resolve(import.meta.dirname, "..", "..", "Jelly ququ Roguelike");
const maoziGameRoot = resolve(import.meta.dirname, "..", "..", "ququjiemaozi");
const heartbeatIntervalMs = 1000;
const sessionTimeoutMs = 5000;
const closeGracePeriodMs = 3000;
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

interface GameSession {
  lastSeenAt: number;
  closingAt?: number;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function serveGameFile(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  root: string,
  next: (error?: Error) => void,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(pathname.slice(1)) || "index.html";
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  const filePath = resolve(root, requestedPath);
  const relativePath = relative(root, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let resolvedRoot: string;
  let resolvedFile: string;
  try {
    [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(filePath)]);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    throw cause;
  }
  const resolvedRelativePath = relative(resolvedRoot, resolvedFile);
  if (resolvedRelativePath.startsWith("..") || isAbsolute(resolvedRelativePath)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const fileStats = await stat(resolvedFile);
  if (!fileStats.isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Length": fileStats.size,
    "Content-Type": contentTypes[extname(resolvedFile).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(resolvedFile).on("error", next).pipe(response);
}

export function roguelikePlugin(): Plugin {
  let gameServer: Server | null = null;
  let gamePort: number | null = null;
  let startPromise: Promise<void> | null = null;
  let cleanupTimer: NodeJS.Timeout | null = null;
  const sessions = new Map<string, GameSession>();

  function stopGameServer(): void {
    if (!gameServer) return;
    const server = gameServer;
    gameServer = null;
    gamePort = null;
    sessions.clear();
    server.close((error) => {
      if (error) console.error("Failed to stop the Roguelike service:", error);
    });
  }

  async function ensureGameServer(): Promise<void> {
    if (gameServer?.listening) return;
    if (startPromise) return startPromise;

    const startup = new Promise<void>((resolveStartup, rejectStartup) => {
      const server = createServer((request, response) => {
        void handleGameRequest(request, response).catch((error: unknown) => {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : new Error(String(error)));
          } else {
            sendJson(response, 500, { error: "Failed to serve the game." });
          }
        });
      });
      gameServer = server;
      server.once("error", rejectStartup);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", rejectStartup);
        const address = server.address();
        if (!address || typeof address === "string") {
          rejectStartup(new Error("The Roguelike service did not receive a TCP port."));
          return;
        }
        gamePort = address.port;
        resolveStartup();
      });
    });
    startPromise = startup;
    try {
      await startup;
    } catch (error) {
      gameServer = null;
      gamePort = null;
      throw error;
    } finally {
      startPromise = null;
    }
  }

  async function handleGameRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const sessionId = requestUrl.searchParams.get("session");
    if (requestUrl.pathname === "/__ququ/heartbeat" || requestUrl.pathname === "/__ququ/close") {
      if (!sessionId || !sessions.has(sessionId)) {
        sendJson(response, 404, { error: "Unknown game session." });
        return;
      }
      if (requestUrl.pathname === "/__ququ/heartbeat" && request.method === "POST") {
        const session = sessions.get(sessionId)!;
        session.lastSeenAt = Date.now();
        session.closingAt = undefined;
        response.writeHead(204, { "Cache-Control": "no-store" }).end();
        return;
      }
      if (requestUrl.pathname === "/__ququ/close" && request.method === "POST") {
        sessions.get(sessionId)!.closingAt = Date.now();
        response.writeHead(204, { "Cache-Control": "no-store" }).end();
        return;
      }
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/" && sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        session.lastSeenAt = Date.now();
        session.closingAt = undefined;
      }
    }
    await serveGameFile(request, response, requestUrl.pathname, gameRoot, (error) => {
      if (error) response.destroy(error);
    });
  }

  function handleHarnessRequest(
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: Error) => void,
  ): void {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (
      requestUrl.pathname === "/ququjiemaozi" ||
      requestUrl.pathname.startsWith("/ququjiemaozi/")
    ) {
      const pathname = requestUrl.pathname.slice("/ququjiemaozi".length) || "/";
      void serveGameFile(request, response, pathname, maoziGameRoot, next).catch(next);
      return;
    }
    if (requestUrl.pathname === "/api/roguelike/status" && request.method === "GET") {
      sendJson(response, 200, { active: Boolean(gameServer?.listening), sessions: sessions.size });
      return;
    }
    if (requestUrl.pathname !== "/api/roguelike/start" && requestUrl.pathname !== "/api/roguelike/launch") {
      if (requestUrl.pathname === "/roguelike" || requestUrl.pathname.startsWith("/roguelike/")) {
        const pathname = requestUrl.pathname.slice("/roguelike".length) || "/";
        void serveGameFile(request, response, pathname, gameRoot, next).catch(next);
        return;
      }
      next();
      return;
    }
    const isLaunch = requestUrl.pathname === "/api/roguelike/launch";
    if ((isLaunch && request.method !== "GET") || (!isLaunch && request.method !== "POST")) {
      response.writeHead(405, { Allow: isLaunch ? "GET" : "POST" }).end();
      return;
    }
    void (async () => {
      await ensureGameServer();
      const sessionId = randomUUID();
      sessions.set(sessionId, { lastSeenAt: Date.now() });
      const gameUrl = `http://127.0.0.1:${gamePort}/?session=${sessionId}`;
      if (isLaunch) {
        response.writeHead(302, { Location: gameUrl, "Cache-Control": "no-store" }).end();
      } else {
        sendJson(response, 200, { url: gameUrl });
      }
    })().catch(next);
  }

  function attachShutdown(server: ViteDevServer | PreviewServer): void {
    server.httpServer?.once("close", () => {
      if (cleanupTimer) clearInterval(cleanupTimer);
      cleanupTimer = null;
      stopGameServer();
    });
  }

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      const closeRequestedAndStale = session.closingAt !== undefined &&
        now - session.closingAt >= closeGracePeriodMs;
      const heartbeatExpired = now - session.lastSeenAt >= sessionTimeoutMs;
      if (closeRequestedAndStale || heartbeatExpired) sessions.delete(sessionId);
    }
    if (gameServer?.listening && sessions.size === 0) stopGameServer();
  }, heartbeatIntervalMs);
  cleanupTimer.unref();

  return {
    name: "ququ-roguelike",
    configureServer(server) {
      server.middlewares.use(handleHarnessRequest);
      attachShutdown(server);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleHarnessRequest);
      attachShutdown(server);
    },
  };
}
