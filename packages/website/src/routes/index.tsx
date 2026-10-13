import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Clisbot – AI agents, Bots, and team workflows",
      "Work with AI agents and specialist Bots on your machines from desktop, mobile, and chat channels. Connect eight channel integrations through Clisbot Hub, share Hosts and Projects with Managed access, and bring multiple Bots into one Chat.",
      "/",
    ),
  component: Home,
});

function Home() {
  return (
    <LandingPage
      showHubAndBots
      title={
        <>
          Your AI agents,
          <br />
          connected to your work.
        </>
      }
      subtitle={
        <>
          Build, research, and work with specialist Bots on your machines.
          <br />
          Desktop, mobile, and your team&rsquo;s chat channels.
          <br />
          Open source. Your agents run where you choose.
        </>
      }
    />
  );
}
