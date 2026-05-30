import { describe, expect, test } from "bun:test";
import { evaluateApiFilter, evaluateApiMapObject, readApiPath } from "../src/channels/api/mapper.ts";

const payload = {
  event: "message_created",
  account: { id: 3 },
  conversation: { id: 970 },
  sender: { id: "u123", name: "A User" },
  content: "Please help",
  "custom field": "custom value",
  labels: ["urgent", "vip"],
  attachments: [
    { id: "a1", file_name: "photo.png", content_type: "image/png" },
    { id: "a2", file_name: "log.txt", content_type: "text/plain" },
  ],
};

describe("api mapper", () => {
  test("reads bracket paths and array indexes", () => {
    expect(readApiPath('$["custom field"]', payload)).toBe("custom value");
    expect(readApiPath("$.attachments[0].file_name", payload)).toBe("photo.png");
  });

  test("maps composed strings, arrays, and projections", () => {
    expect(evaluateApiMapObject({
      eventId: "{{$.event}}:{{$.conversation.id}}",
      sender: ["$.sender.id", "$.sender.name"],
      attachments: {
        from: "$.attachments",
        map: {
          id: "@.id",
          label: "{{@.file_name}} ({{@.content_type}})",
        },
      },
    }, payload)).toEqual({
      eventId: "message_created:970",
      sender: ["u123", "A User"],
      attachments: [
        { id: "a1", label: "photo.png (image/png)" },
        { id: "a2", label: "log.txt (text/plain)" },
      ],
    });
  });

  test("evaluates in, anyIn, and nested boolean filters strictly", () => {
    expect(evaluateApiFilter({
      all: [
        { path: "$.event", in: ["message_created", "message_updated"] },
        { path: "$.labels", anyIn: ["vip"] },
        { not: { path: "$.message_type", exists: true } },
      ],
    }, payload)).toBe(true);

    expect(evaluateApiFilter({
      any: [
        { path: "$.account.id", equals: "3" },
        { path: "$.labels", anyIn: ["blocked"] },
      ],
    }, payload)).toBe(false);
  });
});
