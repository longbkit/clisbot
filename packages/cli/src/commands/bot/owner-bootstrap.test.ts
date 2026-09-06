import { describe, it, expect } from "vitest";
import { ownerBootstrapEnvironment } from "./owner-bootstrap.js";

describe("initial owner credentials", () => {
  it("resolves secret references only into the child environment without mutating its source", () => {
    const env = { TEST_PASSWORD: "private-test-password", CLISBOT_HOME: "/test/home" };
    const result = ownerBootstrapEnvironment(
      { ownerEmail: "owner@example.test", ownerPassword: "${TEST_PASSWORD}" },
      env,
    );
    expect(result.PASEO_BOOTSTRAP_OWNER_PASSWORD).toBe(env.TEST_PASSWORD);
    expect(result.PASEO_BOOTSTRAP_OWNER_EMAIL).toBe("owner@example.test");
    expect(result.PASEO_BOOTSTRAP_ORGANIZATION).toBe("Clisbot");
    expect(env).not.toHaveProperty("PASEO_BOOTSTRAP_OWNER_PASSWORD");
  });
  it("requires the owner's email and a valid password before starting processes", () => {
    expect(() => ownerBootstrapEnvironment({ ownerPassword: "long-test-password" }, {})).toThrow(
      "requires --owner-email",
    );
    expect(() =>
      ownerBootstrapEnvironment({ ownerEmail: "owner@example.test", ownerPassword: "short" }, {}),
    ).toThrow("at least 12");
  });
});
