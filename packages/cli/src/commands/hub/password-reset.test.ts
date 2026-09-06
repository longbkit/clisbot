import { createServer } from "node:http";
import { expect, it } from "vitest";
import { resetHubPassword, passwordResetCommand } from "./password-reset.js";

const masterPassword = "private-master-password-at-least-32-characters";
const credentials = {
  email: "owner@example.test",
  masterPassword,
  newPassword: "replacement-password",
};

it("sends recovery authority only in the authorization header and rejects redirects", async () => {
  const seen: Array<{ url?: string; authorization?: string; body: unknown }> = [];
  let redirect = false;
  let unexpected = false;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    seen.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(raw),
    });
    if (redirect) {
      response.writeHead(307, { location: "/must-not-follow" });
      response.end();
    } else if (unexpected) {
      response.end("<html>Not a Hub response</html>");
    } else {
      response.setHeader("content-type", "application/json");
      response.end('{"code":"password_reset"}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const input = { ...credentials, origin: `http://127.0.0.1:${address.port}` };
    await resetHubPassword(input);
    expect(seen[0]).toEqual({
      url: "/api/auth/paseo/reset-password",
      authorization: `Bearer ${masterPassword}`,
      body: { email: credentials.email, newPassword: credentials.newPassword },
    });
    unexpected = true;
    await expect(resetHubPassword(input)).rejects.toThrow("unexpected response");
    unexpected = false;
    redirect = true;
    await expect(resetHubPassword(input)).rejects.toThrow("did not confirm");
    expect(seen).toHaveLength(3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects insecure remote transport and invalid passwords before sending credentials", async () => {
  await expect(
    resetHubPassword({ ...credentials, origin: "http://hub.example.test" }),
  ).rejects.toThrow("HTTPS");
  await expect(
    resetHubPassword({ ...credentials, origin: "http://127.0.0.1:1", newPassword: "short" }),
  ).rejects.toThrow("12");
  await expect(
    resetHubPassword({ ...credentials, origin: "http://127.0.0.1:1", masterPassword: "short" }),
  ).rejects.toThrow("32");
});

it("requires explicit recovery credentials and documents existing accounts", () => {
  const command = passwordResetCommand();
  expect(command.name()).toBe("reset");
  expect(command.helpInformation()).toContain("existing account");
  expect(command.options.find((option) => option.long === "--master-password")?.mandatory).toBe(
    true,
  );
});
