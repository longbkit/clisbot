import { describe, expect, it } from "vitest";
import { parseHostReturnTo, withHostReturnTo } from "./host-return-to";

describe("host return-to", () => {
  it("accepts in-app Host routes and names their Host", () => {
    expect(parseHostReturnTo("/h/server-1/agent/abc")).toEqual({
      path: "/h/server-1/agent/abc",
      serverId: "server-1",
    });
    expect(parseHostReturnTo("/h/server-1")).toEqual({ path: "/h/server-1", serverId: "server-1" });
  });

  it.each(["https://evil.test/h/x", "//evil.test/h/x", "/welcome", "/h/", "/h\\\\x", undefined, 3])(
    "rejects %s",
    (value) => {
      expect(parseHostReturnTo(value)).toBeNull();
    },
  );

  it("appends an encoded return target only when it is a Host route", () => {
    expect(withHostReturnTo("/open-project", "/h/s/agent/a")).toBe(
      "/open-project?returnTo=%2Fh%2Fs%2Fagent%2Fa",
    );
    expect(withHostReturnTo("/welcome?stay=1", "/h/s")).toBe("/welcome?stay=1&returnTo=%2Fh%2Fs");
    expect(withHostReturnTo("/welcome", "/settings")).toBe("/welcome");
    expect(withHostReturnTo("/welcome", null)).toBe("/welcome");
  });
});
