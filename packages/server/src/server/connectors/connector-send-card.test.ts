import { describe, expect, it } from "vitest";
import { sendCardFields } from "./connector-send-card.js";

describe("sendCardFields", () => {
  it("shows a send's arguments as labelled lines, people by their address", () => {
    expect(
      sendCardFields({
        recipient_email: "boss@co",
        subject: "Sync",
        startDateTime: "2026-10-13T17:00:00Z",
        attendees: [{ email: "a@b.co" }, "c@d.co"],
        cc: [],
        body: "",
      }),
    ).toEqual([
      { label: "Recipient email", value: "boss@co" },
      { label: "Subject", value: "Sync" },
      { label: "Start date time", value: "2026-10-13T17:00:00Z" },
      { label: "Attendees", value: "a@b.co, c@d.co" },
    ]);
  });

  it("numbers the lines of several sends", () => {
    expect(
      sendCardFields({
        sends: [
          { tool: "GMAIL_SEND_EMAIL", arguments: { to: "boss@co" } },
          { tool: "GMAIL_SEND_EMAIL", arguments: { to: "someone@else" } },
        ],
      }),
    ).toEqual([
      { label: "1 · To", value: "boss@co" },
      { label: "2 · To", value: "someone@else" },
    ]);
  });
});
