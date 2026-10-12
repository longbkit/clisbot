import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/hub-auth-callback.html", import.meta.url), "utf8");
function open(url, opener = true) {
  const messages = [];
  const channels = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    beforeParse(window) {
      window.opener = opener ? { postMessage: (...args) => messages.push(args) } : null;
      window.BroadcastChannel = class {
        constructor(name) {
          this.name = name;
        }
        postMessage(data) {
          channels.push({ name: this.name, url: data.url });
        }
        close() {}
      };
    },
  });
  return { dom, messages, channels };
}

test("callback clears the authorization code and returns only to the originating app attempt", () => {
  const state = "s".repeat(43);
  const url = `https://app.clisbot.com/hub-auth-callback?state=${state}&iss=https%3A%2F%2Fwork.test&code=one-use-code`;
  for (const hasOpener of [true, false]) {
    const page = open(url, hasOpener);
    assert.equal(page.dom.window.location.search, "");
    assert.deepEqual(page.channels, [{ name: `clisbot-hub-login:${state}`, url }]);
    assert.equal(page.messages.length, hasOpener ? 1 : 0);
    if (hasOpener) assert.equal(page.messages[0][1], "https://app.clisbot.com");
    page.dom.window.close();
  }
});

test("invalid state or a copied callback on another origin sends nothing", () => {
  for (const url of [
    "https://app.clisbot.com/hub-auth-callback?state=guessable&code=code",
    `https://hostile.test/hub-auth-callback?state=${"s".repeat(43)}&code=code`,
  ]) {
    const page = open(url);
    assert.deepEqual(page.channels, []);
    assert.deepEqual(page.messages, []);
    assert.equal(page.dom.window.location.search, "");
    page.dom.window.close();
  }
});
