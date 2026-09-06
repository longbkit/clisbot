import { createServer } from "node:http";
import { expect, it } from "vitest";
import { changeHubPassword } from "./password.js";

it("changes a password using an authenticated session and signs out the temporary CLI session", async () => {
  const seen: Array<{ path: string; cookie?: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    seen.push({ path: request.url!, cookie: request.headers.cookie, body: JSON.parse(raw) });
    if (request.url === "/api/auth/sign-in/email")
      response.setHeader("set-cookie", "session=test-session; HttpOnly; Path=/");
    response.setHeader("content-type", "application/json");
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    await changeHubPassword({
      origin: `http://127.0.0.1:${address.port}`,
      email: "owner@example.test",
      currentPassword: "current-private-password",
      newPassword: "new-private-password",
    });
    expect(seen.map((entry) => entry.path)).toEqual([
      "/api/auth/sign-in/email",
      "/api/auth/change-password",
      "/api/auth/sign-out",
    ]);
    expect(seen[1]?.cookie).toBe("session=test-session");
    expect(seen[1]?.body).toEqual({
      currentPassword: "current-private-password",
      newPassword: "new-private-password",
      revokeOtherSessions: true,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects a short replacement before sending credentials", async () => {
  await expect(
    changeHubPassword({
      origin: "http://127.0.0.1:1",
      email: "owner@example.test",
      currentPassword: "current-private-password",
      newPassword: "short",
    }),
  ).rejects.toThrow("at least 12");
});
