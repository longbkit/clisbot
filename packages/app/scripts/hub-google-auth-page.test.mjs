import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/hub-google-auth.html", import.meta.url), "utf8");
const request = {
  clientId: "test.apps.googleusercontent.com",
  nonce: "n".repeat(32),
  transactionId: "t".repeat(32),
};

function open(params) {
  let initialize;
  const messages = [];
  const dom = new JSDOM(html, {
    url: `https://app.clisbot.com/hub-google-auth.html#${new URLSearchParams({ ...request, ...params })}`,
    runScripts: "dangerously",
    beforeParse(window) {
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

test("Google nonce is preserved and popup returns once to the exact official origin", async () => {
  const page = open({ mode: "popup", returnOrigin: "https://app.clisbot.com" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(page.initialize.nonce, request.nonce);
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
