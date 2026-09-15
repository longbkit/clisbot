import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applyClisbotEnvDefaults } from "../env-alias.js";
import { readGoogleAuthConfig } from "./google-sign-in.js";
import { emailDomain, readInstanceAuthPolicy } from "./instance-policy.js";

describe("registration policy configuration", () => {
  it("defaults to invitation-only with no allowlisted domain", () => {
    const policy = readInstanceAuthPolicy({});
    assert.equal(policy.registrationMode, "invite_only");
    assert.deepEqual(policy.allowedDomains, []);
  });

  it("normalizes, deduplicates, and exactly matches allowlisted domains", () => {
    const policy = readInstanceAuthPolicy({
      PASEO_REGISTRATION_MODE: "domain_self_registration",
      PASEO_REGISTRATION_ALLOWED_DOMAINS: " Acme.com, acme.com ,eng.acme.com",
    });
    assert.deepEqual(policy.allowedDomains, ["acme.com", "eng.acme.com"]);
    assert.equal(emailDomain("Person@ACME.com"), "acme.com");
  });

  it("rejects invalid, public, or missing domains at startup", () => {
    const domainMode = { PASEO_REGISTRATION_MODE: "domain_self_registration" };
    assert.throws(() => readInstanceAuthPolicy(domainMode), /at least one domain/u);
    assert.throws(
      () =>
        readInstanceAuthPolicy({ ...domainMode, PASEO_REGISTRATION_ALLOWED_DOMAINS: "gmail.com" }),
      /public email domain/u,
    );
    assert.throws(
      () =>
        readInstanceAuthPolicy({ ...domainMode, PASEO_REGISTRATION_ALLOWED_DOMAINS: "*.acme.com" }),
      /invalid domain/u,
    );
    assert.throws(
      () => readInstanceAuthPolicy({ PASEO_REGISTRATION_MODE: "domain" }),
      /must be one of/u,
    );
  });

  it("enables Google only with both client credentials", () => {
    assert.equal(readGoogleAuthConfig({}), undefined);
    assert.deepEqual(
      readGoogleAuthConfig({
        PASEO_GOOGLE_AUTH_CLIENT_ID: "id.apps.googleusercontent.com",
        PASEO_GOOGLE_AUTH_CLIENT_SECRET: "secret",
      }),
      { clientId: "id.apps.googleusercontent.com", clientSecret: "secret" },
    );
    assert.throws(
      () => readGoogleAuthConfig({ PASEO_GOOGLE_AUTH_CLIENT_ID: "id" }),
      /supplied together/u,
    );
  });

  it("reads the CLISBOT_ operator names through the environment alias", () => {
    const environment: Record<string, string | undefined> = {
      CLISBOT_REGISTRATION_MODE: "domain_self_registration",
      CLISBOT_REGISTRATION_ALLOWED_DOMAINS: "acme.com",
      CLISBOT_GOOGLE_AUTH_CLIENT_ID: "id",
      CLISBOT_GOOGLE_AUTH_CLIENT_SECRET: "secret",
    };
    applyClisbotEnvDefaults(environment);
    assert.deepEqual(readInstanceAuthPolicy(environment).allowedDomains, ["acme.com"]);
    assert.equal(readGoogleAuthConfig(environment)?.clientId, "id");
  });
});
