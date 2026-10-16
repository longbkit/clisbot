import { expect, it, vi } from "vitest";
import { createReceiveCodecSelector, type NativeReceiveModule } from "./receive-codec-adapter";

const probeResult = () => ({
  nonce: Uint8Array.from({ length: 24 }, (_, i) => i + 32),
  plaintext: "codec 😀\0",
});
function module() {
  return {
    openText: vi.fn<NativeReceiveModule["openText"]>(async () => probeResult()),
    openBinary: vi.fn<NativeReceiveModule["openBinary"]>(async (_key, frame) =>
      frame.byteLength === 54
        ? {
            nonce: probeResult().nonce,
            plaintext: new TextEncoder().encode("\uFEFFcodec 😀\0"),
          }
        : { nonce: new Uint8Array(24), plaintext: new Uint8Array([1, 2]) },
    ),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("chooses once before admission using a real known-answer open, including text semantics", async () => {
  const native = module();
  const select = createReceiveCodecSelector(native);
  const [first, second] = await Promise.all([select(), select()]);
  expect(first).toBe(second);
  expect(first).toBeDefined();
  expect(native.openText).toHaveBeenCalledTimes(1);
  expect(native.openBinary).toHaveBeenCalledTimes(1);
  expect(native.openBinary.mock.calls[0]?.[1]).toHaveLength(54);
  expect(native.openText.mock.calls[0]?.[0]).toEqual(Uint8Array.from({ length: 32 }, (_, i) => i));
});
it("uses existing JS when module is unavailable or known-answer semantics differ", async () => {
  expect(await createReceiveCodecSelector(null)()).toBeUndefined();
  const native = module();
  native.openText.mockResolvedValue({ ...probeResult(), plaintext: "\uFEFFcodec 😀\0" });
  expect(await createReceiveCodecSelector(native)()).toBeUndefined();
});
it("serializes all channel workers and skips queued work for a closed channel", async () => {
  const native = module();
  const codec = (await createReceiveCodecSelector(native)())!;
  const gate = deferred<Awaited<ReturnType<NativeReceiveModule["openText"]>>>();
  native.openText.mockImplementationOnce(() => gate.promise);
  const first = codec.open(new Uint8Array(32), "first", false);
  const abort = new AbortController();
  const second = codec.open(new Uint8Array(32), "second", false, abort.signal);
  const rejected = expect(second).rejects.toThrow("closed");
  await Promise.resolve();
  expect(native.openText).toHaveBeenCalledTimes(2);
  abort.abort();
  gate.resolve(probeResult());
  await first;
  await rejected;
  expect(native.openText).toHaveBeenCalledTimes(2);
});
it.each(["ERR_CODEC_MAC", "ERR_CODEC_PROTOCOL"])(
  "does not let %s disable native capability or retry the failed frame",
  async (code) => {
    const native = module();
    const select = createReceiveCodecSelector(native);
    const codec = (await select())!;
    native.openText.mockRejectedValueOnce(Object.assign(new Error("invalid"), { code }));
    await expect(codec.open(new Uint8Array(32), "bad", false)).rejects.toThrow("invalid");
    expect(await select()).toBe(codec);
    expect(native.openText).toHaveBeenCalledTimes(2);
  },
);
it("disables infrastructure failure for the next fresh channel, never retries the current frame", async () => {
  const native = module();
  const select = createReceiveCodecSelector(native);
  const codec = (await select())!;
  native.openText.mockRejectedValueOnce(
    Object.assign(new Error("link"), { code: "ERR_CODEC_INFRA" }),
  );
  await expect(codec.open(new Uint8Array(32), "valid", false)).rejects.toThrow("link");
  expect(await select()).toBeUndefined();
  expect(native.openText).toHaveBeenCalledTimes(2);
});
it("returns binary without guessing text and rejects queue overflow before native copies", async () => {
  const native = module();
  const codec = (await createReceiveCodecSelector(native)())!;
  const result = await codec.open(new Uint8Array(32), new Uint8Array([5]).buffer, true);
  expect(result.plaintext).toEqual(new Uint8Array([1, 2]).buffer);
  await expect(
    codec.open(new Uint8Array(32), "x".repeat(32 * 1024 * 1024 + 1), false),
  ).rejects.toThrow("capacity");
  expect(native.openText).toHaveBeenCalledTimes(1);
});

it("rejects binary known-answer conversion failures before channel admission", async () => {
  const native = module();
  native.openBinary.mockResolvedValue({
    nonce: probeResult().nonce,
    plaintext: new Uint8Array([1]),
  });
  const select = createReceiveCodecSelector(native);
  expect(await select()).toBeUndefined();
  expect(await select()).toBeUndefined();
  expect(native.openBinary).toHaveBeenCalledTimes(1);
});
