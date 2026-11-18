import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/hub-google-auth.html", import.meta.url), "utf8");
const request = {
  clientId: "test.apps.googleusercontent.com",
  transactionId: "t".repeat(32),
  hubId: "hub-one",
  hubKey: "aHViLW9uZS1lMmVlLXB1YmxpYy1rZXktZml4dHVyZTA=",
};
// Independent copy of googleSignInNonce (@clisbot/device-access/proof), which the Hub verifies.
const boundNonce = ({ hubId, hubKey, transactionId }) =>
  createHash("sha512")
    .update(JSON.stringify(["clisbot-google-nonce-v2", hubId, hubKey, transactionId]))
    .digest("base64url");
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

function open(params) {
  let initialize;
  const messages = [];
  const dom = new JSDOM(html, {
    url: `https://app.clisbot.com/hub-google-auth.html#${new URLSearchParams({ ...request, ...params })}`,
    runScripts: "dangerously",
    beforeParse(window) {
      // jsdom lacks WebCrypto digest and TextEncoder; browsers provide both on HTTPS pages.
      if (!window.crypto?.subtle)
        Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
      if (!window.TextEncoder) window.TextEncoder = TextEncoder;
      window.opener = {
        postMessage: (...args) => messages.push(JSON.parse(JSON.stringify(args))),
      };
      window.close = () => {};
      window.google = {
        accounts: {
          id: {
            initialize: (options) => {
              initialize = options;
            },
            renderButton: () => {},
          },
        },
      };
    },
  });
  return {
    dom,
    messages,
    get initialize() {
      return initialize;
    },
  };
}

test("managed Google page rejects arbitrary HTTPS token destinations", async () => {
  const page = open({
    mode: "popup",
    returnOrigin: "https://attacker.example",
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(page.initialize, undefined);
    assert.match(page.dom.window.document.getElementById("status").textContent, /Clisbot app/);
    assert.equal(page.dom.window.location.hash, "");
    assert.deepEqual(page.messages, []);
  } finally {
    page.dom.window.close();
  }
});

test("CB-04: Google nonce is derived from the pinned Hub identity, never taken from the fragment", async () => {
  // A Hub that relays another Hub's transaction cannot choose the nonce: any supplied nonce is
  // ignored, and the derived one binds the token to the Hub the app pinned.
  const page = open({
    mode: "popup",
    returnOrigin: "https://app.clisbot.com",
    nonce: "target-hub-nonce-relayed-verbatim",
  });
  try {
    await settle();
    assert.equal(page.initialize.nonce, boundNonce(request));
    assert.notEqual(page.initialize.nonce, "target-hub-nonce-relayed-verbatim");
    assert.equal(page.initialize.client_id, request.clientId);
  } finally {
    page.dom.window.close();
  }
  for (const missing of ["hubId", "hubKey"]) {
    const invalid = open({ mode: "popup", returnOrigin: "https://app.clisbot.com", [missing]: "" });
    try {
      await settle();
      assert.equal(invalid.initialize, undefined, missing);
      assert.match(invalid.dom.window.document.getElementById("status").textContent, /invalid/);
    } finally {
      invalid.dom.window.close();
    }
  }
});

test("Google nonce is bound and popup returns once to the exact official origin", async () => {
  const page = open({ mode: "popup", returnOrigin: "https://app.clisbot.com" });
  try {
    await settle();
    assert.equal(page.initialize.nonce, boundNonce(request));
    assert.equal(page.initialize.auto_select, false);
    page.initialize.callback({ credential: "synthetic-id-token" });
    page.initialize.callback({ credential: "replay" });
    assert.deepEqual(page.messages, [
      [
        {
          type: "clisbot.google.id-token",
          transactionId: request.transactionId,
          idToken: "synthetic-id-token",
        },
        "https://app.clisbot.com",
      ],
    ]);
    assert.equal(page.dom.window.location.search, "");
    assert.equal(page.dom.window.location.hash, "");
  } finally {
    page.dom.window.close();
  }
});

test("redirect accepts only native or random loopback callback paths", async () => {
  for (const [redirectUri, allowed] of [
    ["clisbot://hub-google", true],
    [`http://127.0.0.1:45678/hub-google/callback/${"r".repeat(43)}`, true],
    ["https://attacker.example/callback", false],
    ["http://127.0.0.1:45678/hub-google/callback/guessable", false],
    ["clisbot://hub-google?token=leak", false],
    ["clisbot://other-screen/hub-google", false],
  ]) {
    const page = open({ mode: "redirect", redirectUri });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(Boolean(page.initialize), allowed, redirectUri);
      assert.deepEqual(page.messages, []);
      assert.equal(page.dom.window.location.hash, "");
    } finally {
      page.dom.window.close();
    }
  }
});
