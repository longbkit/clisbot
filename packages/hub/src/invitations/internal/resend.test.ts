import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createResendInvitationMailer, readResendConfig } from "./resend.js";

describe("optional Resend invitation delivery", () => {
  it("is absent when RESEND_API_KEY is absent or blank", () => {
    assert.equal(readResendConfig({}), undefined);
    assert.equal(readResendConfig({ RESEND_API_KEY: "   " }), undefined);
  });

  it("requires a valid key and explicit sender when enabled", () => {
    assert.throws(
      () => readResendConfig({ RESEND_API_KEY: "not-a-key", RESEND_FROM: "invites@example.com" }),
      /RESEND_API_KEY is invalid/,
    );
    assert.throws(
      () => readResendConfig({ RESEND_API_KEY: "re_test_abc123" }),
      /RESEND_FROM is required/,
    );
    assert.deepEqual(
      readResendConfig({
        RESEND_API_KEY: " re_test_abc123 ",
        RESEND_FROM: " Paseo <invites@example.com> ",
      }),
      { apiKey: "re_test_abc123", from: "Paseo <invites@example.com>" },
    );
  });

  it("sends an escaped text and HTML invitation through Resend", async () => {
    let request: { input: string; init: RequestInit } | undefined;
    const mailer = createResendInvitationMailer(
      { apiKey: "re_test_abc123", from: "Paseo <invites@example.com>" },
      (input, init = {}) => {
        let inputUrl: string;
        if (typeof input === "string") inputUrl = input;
        else if (input instanceof URL) inputUrl = input.toString();
        else inputUrl = input.url;
        request = { input: inputUrl, init };
        return Promise.resolve(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
      },
    );

    await mailer.send({
      id: "invite-1",
      email: "person@example.com",
      inviterName: "Alice & Bob",
      organizationName: "Acme <Labs>",
      role: "admin",
      link: "https://hub.example/?invitation=one&next=two",
      expiresAt: new Date("2026-08-31T12:00:00.000Z"),
    });

    assert.ok(request !== undefined);
    assert.equal(request.input, "https://api.resend.com/emails");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(request.init.headers, {
      Authorization: "Bearer re_test_abc123",
      "Content-Type": "application/json",
      "Idempotency-Key": "paseo-invitation-invite-1",
    });
    const bodyText = request.init.body;
    assert.ok(typeof bodyText === "string");
    const body = z
      .object({ subject: z.string(), text: z.string(), html: z.string() })
      .parse(JSON.parse(bodyText));
    assert.equal(body.subject, "Join Acme <Labs> on Paseo");
    assert.match(body.text, /Alice & Bob invited you/);
    assert.match(body.html, /Alice &amp; Bob/);
    assert.match(body.html, /Acme &lt;Labs&gt;/);
    assert.match(body.html, /invitation=one&amp;next=two/);
  });

  it("rejects unsuccessful Resend responses without exposing the response body", async () => {
    const mailer = createResendInvitationMailer(
      { apiKey: "re_test_abc123", from: "invites@example.com" },
      () => Promise.resolve(new Response("secret provider detail", { status: 422 })),
    );

    await assert.rejects(
      () =>
        mailer.send({
          id: "invite-1",
          email: "person@example.com",
          inviterName: "Alice",
          organizationName: "Acme",
          role: "member",
          link: "https://hub.example/?invitation=one",
          expiresAt: new Date("2026-08-31T12:00:00.000Z"),
        }),
      /^Error: Resend rejected invitation email with status 422$/,
    );
  });
});
