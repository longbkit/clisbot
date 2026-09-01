import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  daemonLink,
  daemonLoginCommand,
  DaemonHandoffView,
  organizationTriggersRoute,
  type DaemonLink,
} from "./handoff.js";
import type { BrowserDaemon, BrowserDaemonList } from "./functions.js";

const NOOP = (): void => {};

function daemon(overrides: Partial<BrowserDaemon> = {}): BrowserDaemon {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "workshop",
    status: "active",
    presence: "connected",
    connectedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    registeredAt: "2026-01-01T00:00:00.000Z",
    permissions: ["hub.execute"],
    ...overrides,
  };
}

function listing(daemons: readonly BrowserDaemon[]): { status: "ok"; data: BrowserDaemonList } {
  return { status: "ok", data: { daemons: [...daemons], canManage: true } };
}

function markup(link: DaemonLink, command = "paseo hub login http://localhost:4173"): string {
  return renderToStaticMarkup(
    <DaemonHandoffView link={link} command={command} onRetry={NOOP} onContinue={NOOP} />,
  );
}

describe("the daemon login command", () => {
  it("names the address the operator is looking at, exactly", () => {
    assert.equal(
      daemonLoginCommand("http://localhost:4173"),
      "paseo hub login http://localhost:4173",
    );
    assert.equal(
      daemonLoginCommand("https://hub.internal.example:8443"),
      "paseo hub login https://hub.internal.example:8443",
    );
  });

  it("omits the argument only on the Hub the CLI already defaults to", () => {
    assert.equal(daemonLoginCommand("https://hub.paseo.sh"), "paseo hub login");
    // A look-alike is still somebody else's Hub and has to be named.
    assert.equal(
      daemonLoginCommand("https://hub.paseo.sh.example.com"),
      "paseo hub login https://hub.paseo.sh.example.com",
    );
  });
});

describe("where onboarding ends", () => {
  it("opens the organization's trigger list", () => {
    assert.equal(organizationTriggersRoute("paseo-hub-1a2b3c4d"), "/o/paseo-hub-1a2b3c4d/triggers");
  });
});

describe("what the operator is waiting on", () => {
  it("waits while the organization has no connected daemon", () => {
    assert.deepEqual(daemonLink({ isPending: true, isError: false, data: undefined }), {
      state: "checking",
    });
    assert.deepEqual(daemonLink({ isPending: false, isError: false, data: listing([]) }), {
      state: "waiting",
    });
  });

  it("counts only a live daemon this organization still has", () => {
    assert.deepEqual(
      daemonLink({
        isPending: false,
        isError: false,
        data: listing([daemon({ presence: "offline", connectedAt: null })]),
      }),
      { state: "waiting" },
    );
    assert.deepEqual(
      daemonLink({
        isPending: false,
        isError: false,
        data: listing([daemon({ status: "revoked" })]),
      }),
      { state: "waiting" },
    );
    assert.deepEqual(
      daemonLink({ isPending: false, isError: false, data: listing([daemon({ slug: "laptop" })]) }),
      { state: "linked", slug: "laptop" },
    );
  });

  it("reports a refused check with the server's own words, and a lost one in its own", () => {
    assert.deepEqual(
      daemonLink({
        isPending: false,
        isError: false,
        data: { status: "error", error: { message: "Your session has expired." } },
      }),
      { state: "failed", message: "Your session has expired." },
    );
    const lost = daemonLink({ isPending: false, isError: true, data: undefined });
    assert.equal(lost.state, "failed");
    assert.match(lost.state === "failed" ? lost.message : "", /connection/u);
  });

  it("never takes a connection back because the next check failed", () => {
    assert.deepEqual(daemonLink({ isPending: false, isError: true, data: listing([daemon()]) }), {
      state: "linked",
      slug: "workshop",
    });
  });
});

describe("the daemon handoff screen", () => {
  it("gives the operator one command and one way to skip", () => {
    const screen = markup({ state: "waiting" });

    assert.match(screen, /Connect a daemon/u);
    assert.ok(screen.includes("paseo hub login http://localhost:4173"));
    assert.match(screen, /Waiting for a daemon to connect/u);
    assert.match(screen, /Do this later/u);
    assert.match(screen, /starter workflow/u);
  });

  it("says it is still looking before the first answer arrives", () => {
    const screen = markup({ state: "checking" });

    assert.match(screen, /Checking for daemons/u);
    assert.doesNotMatch(screen, /Waiting for a daemon/u);
  });

  it("offers another check when one fails, without taking the command away", () => {
    const screen = markup({ state: "failed", message: "Hub did not answer." });

    assert.match(screen, /Hub couldn&#x27;t check for daemons/u);
    assert.match(screen, /Hub did not answer\./u);
    assert.match(screen, /Check again/u);
    assert.ok(screen.includes("paseo hub login http://localhost:4173"));
    // A failed check is not a reason to strand the operator here.
    assert.match(screen, /Do this later/u);
  });

  it("names the daemon that connected and moves on", () => {
    const screen = markup({ state: "linked", slug: "workshop" });

    assert.match(screen, /Daemon connected/u);
    assert.match(screen, /workshop is connected to this Hub/u);
    assert.match(screen, /Continue/u);
    // Nothing left to run: the command would only invite a second login.
    assert.ok(!screen.includes("paseo hub login"));
  });
});
