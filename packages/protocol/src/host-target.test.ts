import { expect, test } from "vitest";
import { parseHostTarget } from "./host-target.js";

test.each([
  ["127.0.0.1:6868", "tcp://127.0.0.1:6868"],
  ["4321", "tcp://127.0.0.1:4321"],
  ["[::1]:4321", "tcp://[::1]:4321"],
  ["unix:///tmp/clisbot.sock", "unix:///tmp/clisbot.sock"],
  ["pipe://\\\\.\\pipe\\clisbot", "pipe://\\\\.\\pipe\\clisbot"],
  ["wss://example.com/custom?token=secret", "wss://example.com"],
  ["tcp://example.com:6868?password=secret", "tcp://example.com:6868"],
])(
  "the shared connector accepts %s and exposes only safe display text",
  (connection, description) => {
    expect(parseHostTarget(connection).description).toBe(description);
  },
);
test("SSH daemon credentials are separate from SSH authentication and excluded from display text", () => {
  expect(parseHostTarget("ssh://deploy@build-box:2222?daemonPort=7777&password=secret")).toEqual({
    kind: "ssh",
    ssh: { host: "deploy@build-box", sshPort: 2222, daemonPort: 7777 },
    password: "secret",
    description: "ssh://build-box:2222 (daemon port 7777)",
  });
});
test.each([
  "",
  "ssh://-bad",
  "ssh://user:secret@host",
  "ssh://host?unknown=secret",
  "unix://",
  "tcp://host:0",
  "C:\\Users\\socket",
  "alice:example-secret@localhost:6868",
  "not-a-scheme://localhost:6868",
  "localhost/path:6868",
  "localhost?password=example-secret:6868",
  "localhost#example-secret:6868",
  "tcp://localhost/path:6868",
  "relay://alice:example-secret@localhost:6868/server?key=private",
])("invalid target syntax is rejected without echoing %s", (connection) => {
  expect(() => parseHostTarget(connection)).toThrow("Invalid host connection");
});

test("SSH aliases and DNS names retain their connection semantics", () => {
  expect(parseHostTarget("build-box.example.:6868").description).toBe(
    "tcp://build-box.example.:6868",
  );
  expect(parseHostTarget("ssh://deploy@my_ssh-alias")).toMatchObject({
    kind: "ssh",
    ssh: { host: "deploy@my_ssh-alias" },
  });
});

test("encoded SSH usernames cannot leak into the target description", () => {
  expect(parseHostTarget("ssh://alice%3Aexample-secret@my-alias").description).toBe(
    "ssh://my-alias (daemon port 6868)",
  );
});

test("pairing offers cannot publish a credential-bearing or malformed relay authority", () => {
  for (const endpoint of [
    "alice:example-secret@localhost:6868",
    "localhost/path:6868",
    "localhost?token=example-secret:6868",
  ]) {
    const offer = {
      v: 2,
      serverId: "srv_test",
      daemonPublicKeyB64: "private-key",
      relay: { endpoint, useTls: false },
    };
    const url = `https://app.clisbot.com/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
    expect(() => parseHostTarget(url)).toThrow("Invalid host connection");
  }
});
