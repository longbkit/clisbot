import { describe, expect, it } from "vitest";
import { parseInvitationEmails } from "./invitation-emails";

describe("parseInvitationEmails", () => {
  it("splits on commas, semicolons, spaces, and new lines, lower-cased and de-duplicated", () => {
    expect(
      parseInvitationEmails(
        "A@example.test, b@example.test;c@example.test\n a@example.test  d@example.org",
      ),
    ).toEqual({
      emails: ["a@example.test", "b@example.test", "c@example.test", "d@example.org"],
      invalid: [],
    });
  });
  it("reads the Name <address> form mail clients copy", () => {
    expect(
      parseInvitationEmails("Alice Example <alice@example.test>, Bob Example <bob@example.test>"),
    ).toEqual({ emails: ["alice@example.test", "bob@example.test"], invalid: [] });
  });
  it("reports malformed addresses", () => {
    expect(parseInvitationEmails("ok@example.test bad@example, @x.com")).toEqual({
      emails: ["ok@example.test"],
      invalid: ["bad@example", "@x.com"],
    });
  });
});
