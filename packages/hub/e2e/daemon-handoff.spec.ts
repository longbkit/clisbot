import { expect } from "@playwright/test";
import { test } from "./app.js";

// Each journey claims its own pristine embedded application: nothing here needs PostgreSQL, and
// the fixture's primary is never navigated to, so neither should cost a container.
test.describe.configure({ timeout: 150_000 });
const OPERATOR = {
  name: "Handoff Operator",
  email: "handoff-operator@example.com",
  password: "handoff-operator-password",
};

test("app setup hands off to a daemon, and the daemon that connects opens the dashboard", async ({
  hub,
}) => {
  const session = await hub.openAppSetup({ account: OPERATOR });
  const handoff = session.surface.daemonHandoff;
  try {
    const { page, origin } = session;
    await session.surface.reachDaemonHandoff("Do this later");

    // A self-hosted Hub has to be named, and the only address that is certainly reachable is the
    // one the operator is already looking at.
    await handoff.expectCommand(`paseo hub login ${origin}`);
    expect(await handoff.copyCommand()).toBe(`paseo hub login ${origin}`);
    await handoff.accessible();

    // The command sends the operator to a terminal, and the terminal sends a browser back here.
    // App onboarding is already complete, so that tab reaches CLI login instead of app setup.
    const terminal = await page.context().newPage();
    try {
      await terminal.goto(`${origin}/cli-login`);
      await expect(terminal.getByRole("heading", { name: "Log in the Paseo CLI" })).toBeVisible();
      await expect(terminal.getByLabel("Verification code")).toBeVisible();
      await expect(terminal.getByRole("heading", { name: "Set up your apps" })).toHaveCount(0);
    } finally {
      await terminal.close();
    }

    // The handoff is still waiting on this tab, and notices the daemon on its own.
    await handoff.expectWaiting();
    const slug = await session.connectDaemon();
    await handoff.expectConnected(slug);

    // Onboarding ends at the organization trigger list. There is no project to select or create.
    await handoff.leave("Continue");
    await expect(page.getByRole("heading", { name: "Triggers", level: 1 })).toBeVisible();
  } finally {
    await session.close();
  }
});

test("an operator with no daemon yet does it later and stays out of onboarding", async ({
  hub,
}) => {
  const session = await hub.openAppSetup({ account: OPERATOR });
  const handoff = session.surface.daemonHandoff;
  try {
    const { page } = session;
    await session.surface.reachDaemonHandoff("Do this later");
    // Skipping arrives where connecting does. Nothing about the daemon was needed to get here.
    await handoff.leave("Do this later");
    await expect(page.getByRole("heading", { name: "Triggers", level: 1 })).toBeVisible();

    // Skipping is as final as connecting: the phase lived in the tab, never in the database.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Triggers", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect a daemon" })).toHaveCount(0);
  } finally {
    await session.close();
  }
});
