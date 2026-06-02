import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type ApiHttpListener = {
  host: string;
  port: number;
  stop(force?: boolean): Promise<void>;
};

export type ApiHttpHandler = (
  request: Request,
  remoteAddress?: string | null,
) => Promise<Response>;

const FORCE_CLOSE_TIMEOUT_MS = 1_000;

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value != null) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestUrl(request: IncomingMessage, host: string) {
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const requestHost = request.headers.host ?? host;
  return `${Array.isArray(protocol) ? protocol[0] : protocol}://${requestHost}${request.url ?? "/"}`;
}

async function toWebRequest(request: IncomingMessage, host: string) {
  const method = request.method ?? "GET";
  const bodyAllowed = method !== "GET" && method !== "HEAD";
  return new Request(requestUrl(request, host), {
    method,
    headers: requestHeaders(request),
    body: bodyAllowed ? await readRequestBody(request) : undefined,
  });
}

async function writeWebResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => {
    target.setHeader(key, value);
  });
  if (!response.body) {
    target.end();
    return;
  }
  target.end(Buffer.from(await response.arrayBuffer()));
}

function closeServer(server: Server, force: boolean) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    if (!server.listening) {
      if (force) {
        server.closeAllConnections?.();
      }
      finish();
      return;
    }
    server.close((error) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ERR_SERVER_NOT_RUNNING") {
        finish();
        return;
      }
      if (error) {
        finish(error);
      } else {
        finish();
      }
    });
    if (force) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      timeout = setTimeout(() => finish(), FORCE_CLOSE_TIMEOUT_MS);
      timeout.unref?.();
    }
  });
}

export async function startApiHttpListener(params: {
  host: string;
  port: number;
  handle: ApiHttpHandler;
}): Promise<ApiHttpListener> {
  const server = createServer(async (request, response) => {
    try {
      await writeWebResponse(
        await params.handle(
          await toWebRequest(request, params.host),
          request.socket.remoteAddress,
        ),
        response,
      );
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        error: "api_listener_failed",
        detail: error instanceof Error ? error.message : String(error),
      }, null, 2));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, params.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    host: params.host,
    port: typeof address === "object" && address ? address.port : params.port,
    stop: async (force = false) => {
      await closeServer(server, force);
    },
  };
}
