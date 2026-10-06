import { describe, expect, it } from "vitest";
import { mergeAccountCarrier, resolveWhatsAppDriveAccount } from "./account-config.js";
import { whatsAppAuthDirFor } from "./auth-fs.js";

describe("fusion account config", () => {
  it("pins the auth directory to the encrypted store, even over an authored path", () => {
    const cfg = mergeAccountCarrier(
      { channels: { whatsapp: { accounts: { a: { authDir: "/home/me/.wa", mediaMaxMb: 5 } } } } } as never,
      "a",
    );
    expect(cfg.channels?.whatsapp?.accounts?.["a"]).toMatchObject({ authDir: whatsAppAuthDirFor("a"), mediaMaxMb: 5 });
  });

  it("lets the Connection's label win over the authored one", () => {
    const { account } = resolveWhatsAppDriveAccount({
      accountId: "a",
      account: { accountId: "a", name: "Sales line" },
      cfg: { channels: { whatsapp: { accounts: { a: { name: "authored" } } } } },
    } as never);
    expect(account).toMatchObject({ accountId: "a", name: "Sales line", authDir: whatsAppAuthDirFor("a"), isLegacyAuthDir: false });
  });
});
