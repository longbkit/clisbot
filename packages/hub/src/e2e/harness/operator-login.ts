import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import { sourceEnvironment, type SourceClisbotPaths } from "./source-clisbot.js";

// Machine enrollment and CLI operator approval are separate Hub flows. Use the
// disposable organization's own member so the CLI obtains ordinary access tickets.
export async function loginFixtureOperator(
  origin: string,
  database: DatabaseRuntime,
  paths: SourceClisbotPaths,
): Promise<void> {
  const email = `operator-${randomUUID()}@clisbot.test`;
  const password = randomUUID();
  const headers = new Headers({ origin, "content-type": "application/json" });
  async function post(path: string, body: Record<string, string>): Promise<Response> {
    const response = await fetch(new URL(path, origin), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Fixture operator ${path} returned ${response.status}`);
    return response;
  }

  await post("/api/auth/sign-up/email", { name: "Fixture operator", email, password });
  const membership = await database.query(
    `insert into member (id, organization_id, user_id, role)
       select $1, 'hub-e2e', id, 'owner' from "user" where email = $2 returning id`,
    [randomUUID(), email],
  );
  if (membership.rows.length !== 1) throw new Error("Fixture operator was not provisioned");
  const session = await post("/api/auth/sign-in/email", { email, password });
  headers.set(
    "cookie",
    session.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  );
  await post("/api/auth/clisbot/select-organization", { organizationId: "hub-e2e" });

  const cli = spawn(
    join(paths.packagesRoot, "node_modules/.bin/clisbot"),
    ["hub", "login", origin, "--json"],
    {
      env: sourceEnvironment(paths),
      cwd: paths.clisbotHome,
      timeout: 60_000,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const closed = new Promise<number | null>((resolve, reject) => {
    cli.once("error", reject);
    cli.once("close", resolve);
  });
  const lines = createInterface({ input: cli.stderr });
  async function approve(): Promise<void> {
    for await (const line of lines) {
      const code = /^Code \(if asked\): (\S+)$/u.exec(line)?.[1];
      if (!code) continue;
      await post("/api/auth/clisbot/cli-authorizations/decision", {
        userCode: code,
        decision: "approve",
        organizationId: "hub-e2e",
      });
      return;
    }
    throw new Error("Packed CLI exited without requesting operator approval");
  }
  try {
    const [exit] = await Promise.all([closed, approve()]);
    if (exit !== 0) throw new Error("Packed CLI operator login failed");
  } finally {
    lines.close();
    if (cli.exitCode === null && cli.signalCode === null) cli.kill();
    await closed;
  }
}
