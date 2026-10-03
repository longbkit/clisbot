import { describe, expect, it } from "vitest";
import { visibleEmail, withEmail } from "./account-email";

describe("account email display", () => {
  it("hides the Personal Hub owner's placeholder address", () => {
    const placeholder = "63e5b142-4b73-4e8d-90a3-13370ff0ed8b@personal.clisbot.invalid";
    expect(visibleEmail(placeholder)).toBeNull();
    expect(withEmail("Local owner", placeholder)).toBe("Local owner");
  });

  it("keeps a real address", () => {
    expect(withEmail("Ada", "ada@example.com")).toBe("Ada · ada@example.com");
  });
});
