import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveHubSidebarAccountPresentation } from "./sidebar-account-presentation";

describe("Hub sidebar account presentation", () => {
  it("renders nothing without Hub support or an active account", () => {
    assert.equal(
      resolveHubSidebarAccountPresentation({
        enabled: false,
        account: { id: "member-1", name: "Ada", email: "ada@example.com" },
      }),
      null,
    );
    assert.equal(resolveHubSidebarAccountPresentation({ enabled: true, account: null }), null);
  });

  it("uses a stable two-letter member avatar", () => {
    assert.deepEqual(
      resolveHubSidebarAccountPresentation({
        enabled: true,
        account: {
          id: "member-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
      }),
      {
        accessibilityLabel: "Hub account: Ada Lovelace",
        color: "#388068",
        initials: "AL",
        tooltip: "Ada Lovelace",
      },
    );
  });

  it("falls back to the email for an account without a display name", () => {
    const presentation = resolveHubSidebarAccountPresentation({
      enabled: true,
      account: {
        id: "",
        name: "  ",
        email: "member@example.com",
      },
    });

    assert.equal(presentation?.initials, "M");
    assert.equal(presentation?.tooltip, "member@example.com");
    assert.equal(presentation?.accessibilityLabel, "Hub account: member@example.com");
  });
});
