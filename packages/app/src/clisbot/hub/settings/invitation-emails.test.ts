import { describe, expect, it } from "vitest";
import { parseInvitationEmails } from "./invitation-emails";

describe("parseInvitationEmails", () => {
  it("splits on commas, semicolons, spaces, and new lines, lower-cased and de-duplicated", () => {
    expect(
      parseInvitationEmails("A@vexere.com, b@vexere.com;c@vexere.com\n a@vexere.com  d@gmail.com"),
    ).toEqual({
      emails: ["a@vexere.com", "b@vexere.com", "c@vexere.com", "d@gmail.com"],
      invalid: [],
    });
  });
  it("reads the Name <address> form mail clients copy", () => {
    expect(parseInvitationEmails("Ai Tran <ai.tran@vexere.com>, Nghia <nghia@vexere.com>")).toEqual(
      { emails: ["ai.tran@vexere.com", "nghia@vexere.com"], invalid: [] },
    );
  });
  it("reports malformed addresses", () => {
    expect(parseInvitationEmails("ok@vexere.com bad@vexere, @x.com")).toEqual({
      emails: ["ok@vexere.com"],
      invalid: ["bad@vexere", "@x.com"],
    });
  });
});
