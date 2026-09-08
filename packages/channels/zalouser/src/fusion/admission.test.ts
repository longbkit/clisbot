// Durable admission (D-ZU-014): the envelope inspection upstream's `ingress.ts`
// owns, and the four-way result contract the listener session depends on —
// nothing is let go before the Hub queue has the event, and a handoff failure
// is NOT an accounted message.

import { describe, expect, it, vi } from "vitest";
import {
  createZalouserAdmission,
  inspectZalouserIngressMessage,
  isZalouserAuthenticationFailure,
  ZalouserIngressPayloadError,
} from "./admission.js";
import { createZcaMessage } from "./test-support.js";

describe("inspectZalouserIngressMessage", () => {
  it("keys a direct message on msgId with a per-sender lane", () => {
    expect(inspectZalouserIngressMessage(createZcaMessage({}))).toEqual({
      eventId: "msg-1",
      laneKey: "direct:111",
    });
  });

  it("keys a group message on msgId with a per-group lane", () => {
    expect(
      inspectZalouserIngressMessage(createZcaMessage({ type: 1, data: { idTo: "g5" } })),
    ).toEqual({ eventId: "msg-1", laneKey: "group:g5" });
  });

  it("refuses an envelope with no data, no msgId or an unknown thread type", () => {
    expect(() => inspectZalouserIngressMessage({})).toThrow(ZalouserIngressPayloadError);
    expect(() =>
      inspectZalouserIngressMessage(createZcaMessage({ data: { msgId: "" } })),
    ).toThrow(/missing data.msgId/);
    expect(() => inspectZalouserIngressMessage(createZcaMessage({ type: 7 }))).toThrow(
      /unsupported thread type/,
    );
  });
});

describe("isZalouserAuthenticationFailure", () => {
  it("finds a 401/403 anywhere in the error graph", () => {
    expect(isZalouserAuthenticationFailure(Object.assign(new Error("x"), { status: 401 }))).toBe(
      true,
    );
    expect(
      isZalouserAuthenticationFailure(
        new Error("outer", { cause: Object.assign(new Error("inner"), { statusCode: 403 }) }),
      ),
    ).toBe(true);
    expect(isZalouserAuthenticationFailure(new Error("plain"))).toBe(false);
  });
});

describe("createZalouserAdmission", () => {
  it("queues the normalized event and reports durable", async () => {
    const seen: unknown[] = [];
    const handleInbound = vi.fn(async (event: unknown) => {
      seen.push(event);
      return { dispatched: true };
    });
    const admission = createZalouserAdmission({ accountId: "acct", handleInbound });

    const result = await admission.receive(createZcaMessage({}));

    expect(result).toEqual({ kind: "durable" });
    expect(handleInbound).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({
      channel: "zalouser",
      externalMessageId: "msg-1:cli-1",
      externalConversationId: "111",
      body: "hello",
    });
  });

  it("does NOT queue an invalid envelope and never retries it", async () => {
    const handleInbound = vi.fn(async () => ({ dispatched: true }));
    const admission = createZalouserAdmission({ accountId: "acct", handleInbound });

    const result = await admission.receive(createZcaMessage({ type: 7 }));

    expect(result.kind).toBe("invalid");
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("reports a well-formed non-turn message as ignored, not as a fault", async () => {
    const handleInbound = vi.fn(async () => ({ dispatched: true }));
    const admission = createZalouserAdmission({
      accountId: "acct",
      ownUserId: "111",
      handleInbound,
    });

    const result = await admission.receive(createZcaMessage({}));

    expect(result).toEqual({ kind: "ignored", reason: "own-message" });
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it("carries the processor's own drop through as ignored", async () => {
    const handleInbound = vi.fn(async () => ({ dispatched: false, reason: "duplicate" }));
    const admission = createZalouserAdmission({ accountId: "acct", handleInbound });

    expect(await admission.receive(createZcaMessage({}))).toEqual({
      kind: "ignored",
      reason: "duplicate",
    });
  });

  it("THROWS when the handoff fails, so the caller must not consider it handled", async () => {
    const handleInbound = vi.fn(async () => {
      throw new Error("queue write failed");
    });
    const admission = createZalouserAdmission({ accountId: "acct", handleInbound });

    await expect(admission.receive(createZcaMessage({}))).rejects.toThrow(/queue write failed/);
  });
});
