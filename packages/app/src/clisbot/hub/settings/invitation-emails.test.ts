import { describe, expect, it } from "vitest";
import { parseInvitationEmails, sendInvitations } from "./invitation-emails";

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

describe("sendInvitations", () => {
  it("continues past a refused address and reports it", async () => {
    const sent: string[] = [];
    const failures = await sendInvitations(["a@x.com", "b@x.com", "c@x.com"], async (email) => {
      if (email === "b@x.com") throw new Error("Hub account request failed (409).");
      sent.push(email);
    });
    expect(sent).toEqual(["a@x.com", "c@x.com"]);
    expect(failures).toEqual([{ email: "b@x.com", message: "already a Member, or no free seat" }]);
  });
});
