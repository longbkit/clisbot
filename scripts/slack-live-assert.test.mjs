// The read-back parser of the Slack live-assertion driver. Wave 5 lost an
// assertion to this: a multi-line marker was split into one row per line, so
// the row carrying the expected text had no `UserID` and the driver reported
// `identity-mismatch` against the marker it had just posted itself.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseSlackCsv } from "./slack-live-assert.mjs";

const HEADER = "MsgID,UserID,UserName,Text,Time,FileCount\n";

describe("parseSlackCsv", () => {
  it("keeps a multi-line message in one row", () => {
    const rows = parseSlackCsv(
      `${HEADER}1788793662.128819,U08N4UZM8CF,vai,"# Tiêu đề\n\n**Đậm** and a table:\n\n| A | B |\n| 1 | 2 |",2026-09-07T14:47:42Z,0\n`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].MsgID, "1788793662.128819");
    assert.equal(rows[0].UserID, "U08N4UZM8CF");
    assert.match(rows[0].Text, /^# Tiêu đề\n/u);
    assert.ok(rows[0].Text.includes("| A | B |"));
  });

  it("does not report a foreign author for a multi-line marker", () => {
    // The wave-5 failure shape: a marker the user credential posted, followed
    // by the bot's reply. Every row must keep its own author.
    const rows = parseSlackCsv(
      `${HEADER}` +
        `1788793586.717609,U8ZTVGJJF,long.luong,"<@U08N4UZM8CF> render this:\n\n# heading\n\n| A |\n| 1 |",2026-09-07T14:46:26Z,0\n` +
        `1788793662.128819,U08N4UZM8CF,vai,"PONG-W5SL3\nrendered",2026-09-07T14:47:42Z,0\n`,
    );
    assert.deepEqual(
      rows.map((row) => row.UserID),
      ["U8ZTVGJJF", "U08N4UZM8CF"],
    );
    assert.equal(rows.filter((row) => row.UserID === undefined || row.UserID === "").length, 0);
  });

  it("handles quoted commas and doubled quotes", () => {
    const rows = parseSlackCsv(
      `${HEADER}1.1,U1,vai,"a, b and ""quoted"" text",2026-09-07T14:47:42Z,0\n`,
    );
    assert.equal(rows[0].Text, 'a, b and "quoted" text');
  });

  it("returns no rows for a header-only or empty read-back", () => {
    assert.deepEqual(parseSlackCsv(HEADER), []);
    assert.deepEqual(parseSlackCsv(""), []);
  });

  it("tolerates CRLF and a missing trailing newline", () => {
    const rows = parseSlackCsv(
      'MsgID,UserID,Text\r\n1.1,U1,"one\r\ntwo"\r\n1.2,U2,plain'.replaceAll("\r\n", "\r\n"),
    );
    assert.deepEqual(
      rows.map((row) => row.UserID),
      ["U1", "U2"],
    );
    assert.equal(rows[1].Text, "plain");
  });
});
