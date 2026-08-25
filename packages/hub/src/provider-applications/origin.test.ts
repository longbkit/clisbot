import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveCallbackOrigin } from "./index.js";

describe("provider application callback origin", () => {
  it("accepts an authenticated browser origin only when the HTTP adapter corroborates it", () => {
    const request = new Request("http://attacker.test/apps?origin=https://body.test", {
      headers: {
        origin: "https://hub.test",
        host: "attacker.test",
        "x-forwarded-host": "also-attacker.test",
        "x-forwarded-proto": "https",
        "x-paseo-trusted-request-origin": "https://hub.test",
      },
    });

    assert.equal(resolveCallbackOrigin(request), "https://hub.test");
  });

  it("rejects callback-origin tampering and never falls back to Host", () => {
    assert.throws(
      () =>
        resolveCallbackOrigin(
          new Request("https://attacker.test/apps", {
            headers: {
              origin: "https://hub.test",
              host: "hub.test",
              "x-paseo-trusted-request-origin": "https://attacker.test",
            },
          }),
        ),
      /origin/u,
    );
    assert.throws(
      () =>
        resolveCallbackOrigin(
          new Request("https://hub.test/apps", {
            headers: { origin: "https://hub.test", host: "hub.test" },
          }),
        ),
      /origin/u,
    );
  });

  it("honors the explicit app URL only for a browser opened at that origin", () => {
    const request = new Request("http://internal/apps", {
      headers: { origin: "https://hub.example.com" },
    });
    assert.equal(
      resolveCallbackOrigin(request, "https://hub.example.com/base"),
      "https://hub.example.com",
    );
    assert.throws(() => resolveCallbackOrigin(request, "https://different.example.com"), /origin/u);
  });
});
