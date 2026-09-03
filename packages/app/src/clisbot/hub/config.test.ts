import { describe, expect, it } from "vitest";
import { parseHubConfiguration } from "./config";

describe("Hub configuration", () => {
  it("accepts HTTPS and loopback HTTP origins", () => {
    expect(parseHubConfiguration({ origin: "https://hub.example.com" })).toEqual({
      origin: "https://hub.example.com",
    });
    expect(parseHubConfiguration({ origin: "http://127.0.0.1:6868" })).toEqual({
      origin: "http://127.0.0.1:6868",
    });
  });

  it("rejects plaintext remote origins before credentials or requests are created", () => {
    expect(parseHubConfiguration({ origin: "http://100.64.0.10:6868" })).toBeNull();
  });
});
