import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { SponsorClisbotSection } from "~/components/sponsorship";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/sponsor")({
  head: () =>
    pageMeta("Sponsor Clisbot", "Sponsorship options for Clisbot are being set up.", "/sponsor"),
  component: Sponsor,
});

function Sponsor() {
  return (
    <SiteShell width="default">
      <SponsorClisbotSection />
    </SiteShell>
  );
}
