import { describe, expect, it } from "vitest";
import { publicAccessRoutes } from "./access-overview";

describe("Access overview projections", () => {
  it("projects public Routes from the published Channel configuration without creating assignments", () => {
    expect(
      publicAccessRoutes([
        {
          channel: "slack",
          accountId: "support",
          enabled: false,
          routes: [
            {
              audience: [{ who: { roles: ["member"] }, where: { conversations: ["private"] } }],
              agent: "internal",
            },
            {
              audience: [
                { who: { roles: ["owner"] }, where: { dm: true } },
                { who: { anyone: true }, where: { conversations: ["C1"] } },
              ],
              workflow: "support",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "slack:support:1",
        account: "slack · support",
        enabled: false,
        conversations: "C1",
        target: "support",
      },
    ]);
  });
});
