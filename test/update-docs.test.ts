import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const updateGuidePaths = [
  "docs/updates/update-guide.md",
  "docs/langs/vi/updates/update-guide.md",
  "docs/langs/ko/updates/update-guide.md",
];

describe("update docs", () => {
  test("keep install/update guides scoped away from publish recovery", () => {
    const forbidden = [
      "Wrong Publish Recovery",
      "publish nhầm",
      "잘못 배포한 버전 복구",
      "version was published by mistake",
      "npm login",
      "EOTP",
      "--otp",
    ];

    for (const filePath of updateGuidePaths) {
      const content = readFileSync(filePath, "utf8");
      for (const text of forbidden) {
        expect(content).not.toContain(text);
      }
    }
  });
});
