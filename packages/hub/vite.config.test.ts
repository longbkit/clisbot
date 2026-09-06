import { describe, expect, it } from "vitest";
import { resolveAllowedHosts } from "./vite-allowed-hosts";

describe("resolveAllowedHosts", () => {
  it("allows the hostname from the configured public Hub URL", () => {
    expect(
      resolveAllowedHosts({
        PASEO_HUB_APP_URL: "https://sandbox.taile33b14.ts.net:8444",
      }),
    ).toEqual(["sandbox.taile33b14.ts.net"]);
  });

  it("does not broaden the allowlist without a valid configured URL", () => {
    expect(resolveAllowedHosts({})).toEqual([]);
    expect(resolveAllowedHosts({ PASEO_HUB_APP_URL: "not a URL" })).toEqual([]);
  });
});
