import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getpaseo",
              accountLogin: "getpaseo",
              accountType: "Organization",
              repositories: ["longbkit/clisbot"],
            },
          ],
          slack: [{ slug: "clisbot", teamName: "Clisbot" }],
          discord: [{ slug: "clisbot-discord", guildName: "Clisbot Discord" }],
          daemons: [],
          linear: [],
        },
        "longbkit/clisbot",
      ),
    ).toEqual([
      {
        id: "github:longbkit/clisbot",
        label: "GitHub — longbkit/clisbot",
        provider: "github",
        filters: { connection: "github-getpaseo", repo: "longbkit/clisbot" },
      },
      {
        id: "slack:clisbot",
        label: "Slack — Clisbot",
        provider: "slack",
        filters: { connection: "clisbot" },
      },
      {
        id: "discord:clisbot-discord",
        label: "Discord — Clisbot Discord",
        provider: "discord",
        filters: { connection: "clisbot-discord" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getpaseo",
              accountLogin: "getpaseo",
              accountType: "Organization",
              repositories: ["getpaseo/hub"],
            },
          ],
          slack: [],
          discord: [],
          daemons: [],
          linear: [],
        },
        "longbkit/clisbot",
      ),
    ).toEqual([]);
  });
});
