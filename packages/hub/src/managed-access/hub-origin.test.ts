import { expect, it } from "vitest";
import { normalizeHubOrigin } from "./hub-origin.js";

it("agrees for every shape the same Hub is configured as", () => {
  const configured = [
    "https://hub.example",
    "https://hub.example/",
    "https://hub.example/app",
    "https://hub.example/app/",
  ];
  expect(new Set(configured.map(normalizeHubOrigin))).toEqual(new Set(["https://hub.example"]));
});

it("keeps an explicit port and drops the default one", () => {
  expect(normalizeHubOrigin("http://localhost:8444/")).toBe("http://localhost:8444");
  expect(normalizeHubOrigin("https://hub.example:443/")).toBe("https://hub.example");
});
