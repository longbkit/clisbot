import { afterEach, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { persistHostRegistry } from "./provider-cache-pressure";

const registryKey = "@clisbot:daemon-registry";
const legacyKey = '@paseo/provider-snapshot/v2:["fixture","hash","old"]';
const cacheKey = '@clisbot/provider-snapshot/v2:["fixture","hash","current"]';
const fixtureKeys = [
  registryKey,
  legacyKey,
  cacheKey,
  "@clisbot:fixture-auth",
  "@paseo:fixture-history",
  "fixture-external-data",
];

afterEach(() => {
  for (const key of fixtureKeys) localStorage.removeItem(key);
});

/** Fill the browser's actual quota, without guessing its size or intercepting setItem. */
function fillQuota(key: string): number {
  let value = "";
  for (let step = 1024 * 1024; step >= 64; step = Math.floor(step / 2)) {
    while (true) {
      const next = value + "x".repeat(step);
      try {
        localStorage.setItem(key, next);
        value = next;
      } catch (error) {
        expect((error as DOMException).name).toBe("QuotaExceededError");
        break;
      }
    }
  }
  return value.length;
}

it("saves all 14 existing direct preferences under real browser quota and preserves them in a reloaded document", async () => {
  const original = Array.from({ length: 14 }, (_, index) => ({
    serverId: `fixture-${index}`,
    label: `Host ${index}`,
    password: `fixture-secret-${index}`,
    management: { hubId: "fixture-hub", daemonId: `fixture-${index}` },
    connections: [
      { id: `direct-${index}`, type: "directTcp", endpoint: `offline-${index}:443` },
      { id: `relay-${index}`, type: "relay", endpoint: "fixture" },
    ],
    preferredConnectionId: `relay-${index}`,
  }));
  const selected = original.map((host, index) => ({
    ...host,
    preferredConnectionId: `direct-${index}`,
  }));
  localStorage.setItem(registryKey, JSON.stringify(original));
  localStorage.setItem("@clisbot:fixture-auth", "preserve authentication exactly");
  localStorage.setItem("@paseo:fixture-history", "preserve history exactly");
  const filledChars = fillQuota(legacyKey);
  expect(filledChars).toBeGreaterThan(1_000_000);
  const value = JSON.stringify(selected) + " ".repeat(1024);
  // Prove the pre-fix primitive fails, not merely that cleanup ran.
  expect(() => localStorage.setItem(registryKey, value)).toThrow();
  await persistHostRegistry(AsyncStorage, registryKey, value);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  expect(localStorage.getItem("@clisbot:fixture-auth")).toBe("preserve authentication exactly");
  expect(localStorage.getItem("@paseo:fixture-history")).toBe("preserve history exactly");
  const frame = document.createElement("iframe");
  frame.src = window.location.origin + "/favicon.ico";
  // Reload an independent same-origin document: this validates storage durability,
  // not Host connectivity or a full app navigation timing claim.
  document.body.append(frame);
  await new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  const restored = JSON.parse(frame.contentWindow!.localStorage.getItem(registryKey)!);
  expect(restored).toEqual(selected);
  frame.remove();
  console.info(
    JSON.stringify({
      case: "legacy-quota-recovery",
      filledChars,
      hosts: restored.length,
      preferredDirect: restored.filter((host: { preferredConnectionId: string }) =>
        host.preferredConnectionId.startsWith("direct-"),
      ).length,
    }),
  );
});

it("reclaims current disposable cache on quota, but refuses unsavable writes without touching auth or preferences", async () => {
  localStorage.setItem(registryKey, "old saved preference");
  localStorage.setItem("@clisbot:fixture-auth", "keep auth");
  const filledChars = fillQuota(cacheKey);
  await persistHostRegistry(AsyncStorage, registryKey, "new saved preference".repeat(100));
  expect(localStorage.getItem(cacheKey)).toBeNull();
  fillQuota("fixture-external-data");
  const saved = localStorage.getItem(registryKey);
  await expect(
    persistHostRegistry(AsyncStorage, registryKey, "unsavable".repeat(100_000)),
  ).rejects.toThrow("Could not save Host connections");
  expect(localStorage.getItem(registryKey)).toBe(saved);
  expect(localStorage.getItem("@clisbot:fixture-auth")).toBe("keep auth");
  expect(localStorage.getItem("fixture-external-data")).not.toBeNull();
  console.info(
    JSON.stringify({
      case: "current-cache-quota-and-refusal",
      filledChars,
      durableDataPreserved: true,
    }),
  );
});
