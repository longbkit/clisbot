import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { z } from "zod";

export const GoogleSignInInputSchema = z
  .object({
    clientId: z.string().regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
    transactionId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  })
  .strict();
export type GoogleSignInInput = z.infer<typeof GoogleSignInInputSchema>;

export function googleSignInUrl(input: GoogleSignInInput, redirectUri: string): string {
  const url = new URL("https://app.clisbot.com/hub-google-auth.html");
  url.hash = new URLSearchParams({
    ...GoogleSignInInputSchema.parse(input),
    mode: "redirect",
    redirectUri,
  }).toString();
  return url.href;
}

/** The token arrives in a fragment, then same-origin POST; never URL queries/logs. */
export async function openGoogleAuthCallback(transactionId: string, timeoutMs = 300_000) {
  const callbackPath = `/hub-google/callback/${randomBytes(32).toString("base64url")}`;
  let settle!: (value: { transactionId: string; idToken: string }) => void;
  let fail!: (error: Error) => void;
  const result = new Promise<{ transactionId: string; idToken: string }>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Attach before opening the browser so cancellation never causes unhandled rejection.
  void result.catch(() => undefined);
  let origin = "";
  let completed = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    const pathname = request.url;
    if (
      request.headers.host !== new URL(origin).host ||
      (pathname !== callbackPath && pathname !== `${callbackPath}/complete`)
    ) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET" && pathname === callbackPath) {
      const nonce = randomBytes(24).toString("base64url");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      );
      response.end(
        `<!doctype html><meta charset="utf-8"><title>Clisbot sign-in</title><p id="status">Returning to Clisbot…</p><script nonce="${nonce}">const data=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));history.replaceState(null,"",location.pathname);fetch(location.pathname+"/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)}).then(r=>{document.getElementById("status").textContent=r.ok?"Sign-in complete. You can close this window.":"Sign-in failed. Return to Clisbot and retry.";if(r.ok)window.close()}).catch(()=>{document.getElementById("status").textContent="Return to Clisbot and retry."});</script>`,
      );
      return;
    }
    if (
      request.method !== "POST" ||
      pathname !== `${callbackPath}/complete` ||
      request.headers.origin !== origin ||
      request.headers["content-type"] !== "application/json"
    ) {
      response.writeHead(403).end();
      return;
    }
    if (completed) {
      response.writeHead(409).end();
      return;
    }
    let body = "";
    try {
      for await (const bytes of request) {
        body += bytes.toString();
        if (Buffer.byteLength(body) > 20_000) {
          response.writeHead(413).end();
          return;
        }
      }
      const value = z
        .object({
          transactionId: z.literal(transactionId),
          idToken: z.string().min(1).max(16384),
        })
        .strict()
        .parse(JSON.parse(body));
      if (completed) {
        response.writeHead(409).end();
        return;
      }
      completed = true;
      response.writeHead(204).end();
      settle(value);
    } catch {
      response.writeHead(400).end();
    }
  });
  server.maxConnections = 8;
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Sign-in callback unavailable");
  }
  origin = `http://127.0.0.1:${address.port}`;
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  const timer = setTimeout(() => {
    fail(new Error("Google sign-in timed out; retry from Clisbot"));
    close();
  }, timeoutMs);
  return {
    redirectUri: `${origin}${callbackPath}`,
    result,
    close: () => {
      clearTimeout(timer);
      close();
    },
  };
}
