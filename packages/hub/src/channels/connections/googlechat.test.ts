// The Hub-side Google Chat service-account probe, pinned against the vertical's
// own validator. The Hub restates the validation because its production code
// never imports a channel vertical; the differential case below runs BOTH over
// the same documents and requires them to accept and refuse the same ones — a
// document the Hub stores but the vertical rejects would be an account that can
// never start, and the operator would learn it at start instead of at create.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { resolveValidatedGoogleChatCredentials } from "@getpaseo/channels-googlechat/dist/google-auth.runtime.js";
import { createMemoryDatabase } from "../../db/memory.js";
import {
  configureGoogleChatConnection,
  MAX_SERVICE_ACCOUNT_BYTES,
  parseGoogleChatServiceAccount,
  probeGoogleChatServiceAccount,
  readServiceAccountFile,
  SERVICE_ACCOUNT_DIRECTORY_VARIABLE,
} from "./googlechat.js";
import { ChannelCredentialProbeError } from "./probe.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function serviceAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "service_account",
    project_id: "fusion-chat",
    client_email: "chat-bot@fusion-chat.iam.gserviceaccount.com",
    private_key: PRIVATE_KEY_PEM,
    token_uri: "https://oauth2.googleapis.com/token",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:
      "https://www.googleapis.com/robot/v1/metadata/x509/chat-bot%40fusion-chat.iam.gserviceaccount.com",
    universe_domain: "googleapis.com",
    ...overrides,
  };
}

/** The documents the two validators must classify identically. */
const DIFFERENTIAL_DOCUMENTS: [label: string, document: Record<string, unknown>][] = [
  ["a well-formed document", serviceAccount()],
  ["a user-credential document", serviceAccount({ type: "authorized_user" })],
  ["a document with no private key", serviceAccount({ private_key: "" })],
  ["a document with no client email", serviceAccount({ client_email: "" })],
  ["a redirected token_uri", serviceAccount({ token_uri: "https://evil.example.com/token" })],
  ["a redirected auth_uri", serviceAccount({ auth_uri: "https://evil.example.com/auth" })],
  [
    "a redirected cert url",
    serviceAccount({ auth_provider_x509_cert_url: "https://evil.example.com/certs" }),
  ],
  [
    "a redirected client cert url",
    serviceAccount({ client_x509_cert_url: "https://evil.example.com/x509/bot" }),
  ],
  ["a foreign universe domain", serviceAccount({ universe_domain: "evil.example.com" })],
];

const originalFetch = globalThis.fetch;
const temporaryDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env[SERVICE_ACCOUNT_DIRECTORY_VARIABLE];
});

/** A file under a fresh directory that is also allowlisted as the secrets
 * mount, so the FILE form behaves the way a real `/run/secrets` mount does. */
function temporaryFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hub-googlechat-"));
  temporaryDirs.push(dir);
  process.env[SERVICE_ACCOUNT_DIRECTORY_VARIABLE] = realpathSync(dir);
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

/** Google's token endpoint: an access token for a signed assertion. */
function stubGoogle(status = 200): { assertions: string[] } {
  const assertions: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    const params = new URLSearchParams(String(init?.body ?? ""));
    assertions.push(params.get("assertion") ?? "");
    if (status !== 200) {
      return Response.json({ error: "invalid_grant" }, { status });
    }
    return Response.json({ access_token: "ya29.fusion", expires_in: 3599 });
  }) as typeof fetch;
  return { assertions };
}

describe("Google Chat service-account probe", () => {
  it("mints one access token from a signed assertion", async () => {
    const { assertions } = stubGoogle();
    const identity = await probeGoogleChatServiceAccount(JSON.stringify(serviceAccount()));
    assert.equal(identity.id, "chat-bot@fusion-chat.iam.gserviceaccount.com");
    assert.equal(identity.username, "fusion-chat");
    const [header, claims] = (assertions[0] ?? "").split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header ?? "", "base64url").toString()), {
      alg: "RS256",
      typ: "JWT",
    });
    const decoded = JSON.parse(Buffer.from(claims ?? "", "base64url").toString()) as {
      scope: string;
      aud: string;
    };
    assert.equal(decoded.scope, "https://www.googleapis.com/auth/chat.bot");
    assert.equal(decoded.aud, "https://oauth2.googleapis.com/token");
  });

  it("stores the document inline and the file form as a path", async () => {
    stubGoogle();
    const database = createMemoryDatabase({ organizationIds: ["org", "org2"] });
    const document = JSON.stringify(serviceAccount());
    const inline = await configureGoogleChatConnection(database, {
      organizationId: "org",
      accountId: "workspace",
      serviceAccount: document,
    });
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "googlechat",
        connectionId: inline.connectionId,
      }),
      { serviceAccount: document },
    );

    const path = temporaryFile("service-account.json", document);
    const mounted = await configureGoogleChatConnection(database, {
      organizationId: "org2",
      accountId: "workspace",
      serviceAccountFile: path,
    });
    // The file stays where the operator's secret mount put it; the envelope
    // records only where to read it.
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org2",
        channel: "googlechat",
        connectionId: mounted.connectionId,
      }),
      { serviceAccountFile: path },
    );
  });

  it("refuses a service-account file above the 64 KiB cap", async () => {
    stubGoogle();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const path = temporaryFile("huge.json", "x".repeat(MAX_SERVICE_ACCOUNT_BYTES + 1));
    await assert.rejects(
      () =>
        configureGoogleChatConnection(database, {
          organizationId: "org",
          accountId: "workspace",
          serviceAccountFile: path,
        }),
      /must be a readable JSON document/u,
    );
  });

  // The FILE form is operator input read with the Hub's privileges. Every
  // refusal has to be the same sentence, or the difference between them is a
  // filesystem oracle for whoever can call the management API.
  it("reads only inside the allowlisted secrets directory, with one refusal", async () => {
    const document = JSON.stringify(serviceAccount());
    const mounted = temporaryFile("service-account.json", document);
    const mount = process.env[SERVICE_ACCOUNT_DIRECTORY_VARIABLE] as string;
    assert.equal(await readServiceAccountFile(mounted), document);

    const outside = temporaryFile("outside.json", document);
    // `temporaryFile` moved the allowlist to the new directory; point it back.
    process.env[SERVICE_ACCOUNT_DIRECTORY_VARIABLE] = mount;
    const escape = join(mount, "escape.json");
    symlinkSync(outside, escape);
    const refusals = [
      outside,
      escape,
      join(mount, "absent.json"),
      mount,
      `${mount}/../${basename(mount)}-other/service-account.json`,
      "/etc/shadow",
    ];
    const messages = new Set<string>();
    for (const path of refusals) {
      await assert.rejects(() => readServiceAccountFile(path), ChannelCredentialProbeError);
      messages.add(await readServiceAccountFile(path).catch((error: Error) => error.message));
    }
    assert.equal(messages.size, 1, [...messages].join(" | "));
  });

  it("refuses both credential forms at once, and neither", async () => {
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    for (const input of [
      { serviceAccount: "{}", serviceAccountFile: "/tmp/x.json" },
      {},
    ] as const) {
      await assert.rejects(
        () =>
          configureGoogleChatConnection(database, {
            organizationId: "org",
            accountId: "workspace",
            ...input,
          }),
        /exactly one/u,
      );
    }
  });

  it("reports a rejected service account as rejected, an unreachable Google as transient", async () => {
    stubGoogle(400);
    const rejected = await probeGoogleChatServiceAccount(serviceAccount()).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(rejected instanceof ChannelCredentialProbeError);
    assert.equal(rejected.rejected, true);

    globalThis.fetch = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    const transient = await probeGoogleChatServiceAccount(serviceAccount()).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(transient instanceof ChannelCredentialProbeError);
    assert.equal(transient.rejected, false);
  });

  it("accepts and refuses exactly the documents the vertical's validator does", async () => {
    for (const [label, document] of DIFFERENTIAL_DOCUMENTS) {
      const mine = ((): string | null => {
        try {
          parseGoogleChatServiceAccount(document);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })();
      const theirs = await resolveValidatedGoogleChatCredentials({
        credentialSource: "inline",
        credentials: document,
      } as never).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      assert.equal(
        mine === null,
        theirs === null,
        `${label}: hub ${mine === null ? "accepted" : `refused (${mine})`} but the vertical ${
          theirs === null ? "accepted" : `refused (${theirs})`
        }`,
      );
      // The refusals carry the vertical's own wording, so the operator reads the
      // same sentence whichever side refused.
      if (mine !== null && theirs !== null && theirs.includes("must be")) {
        assert.equal(mine, theirs, label);
      }
    }
  });
});
