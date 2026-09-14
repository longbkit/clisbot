import { expect, it } from "vitest";
import { DownloadTokenStore } from "./token-store.js";
const file = {
  path: "file.txt",
  absolutePath: "/workspace/file.txt",
  fileName: "file.txt",
  mimeType: "text/plain",
  size: 1,
};
it("rejects overload without evicting an issued token and releases admission on consume", () => {
  const store = new DownloadTokenStore({ ttlMs: 1000, maxTokens: 1 });
  const first = store.issueToken(file);
  expect(() => store.issueToken(file)).toThrow("budget");
  expect(store.consumeToken(first.token)?.absolutePath).toBe(file.absolutePath);
  expect(store.issueToken(file).token).toBeTruthy();
});
it("prunes expired tokens before admission and releases the byte reservation on expiry", () => {
  let now = 0;
  const store = new DownloadTokenStore({ ttlMs: 10, maxTokens: 1, maxBytes: 1024, now: () => now });
  const first = store.issueToken(file);
  now = 11;
  const second = store.issueToken(file);
  expect(store.consumeToken(first.token)).toBeNull();
  now = 22;
  expect(store.consumeToken(second.token)).toBeNull();
  expect(store.issueToken(file).token).toBeTruthy();
});
it("rejects oversized token metadata before storing it and retains prior live tokens", () => {
  const store = new DownloadTokenStore({ ttlMs: 1000, maxBytes: 1024 });
  const first = store.issueToken(file);
  expect(() => store.issueToken({ ...file, path: "x".repeat(1024) })).toThrow("budget");
  expect(store.consumeToken(first.token)?.path).toBe(file.path);
});
