import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, ClisbotLegalIdentity } from "~/components/legal-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta(
      "Privacy Policy - Clisbot",
      "What stays on your machines, what the encrypted relay can see, and how self-hosted Hubs handle their own data.",
      "/privacy",
    ),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="October 20, 2026">
      <p>
        Clisbot is local-first. Installing or using the open-source software does not send us your
        code, prompts, files, terminal output, or agent conversations. This policy explains the
        separate data boundaries for local Clisbot, the optional official relay, self-hosted Clisbot
        Hubs, and clisbot.com. Clisbot does not operate a hosted Hub service.
      </p>

      <section>
        <h2>Who is responsible</h2>
        <ClisbotLegalIdentity />
        <p>
          Long Luong is the data controller for personal data processed through the official Clisbot
          website, official relay, and product analytics. Self-hosted daemons, Hubs, and relays are
          controlled by their operators and are not covered by this policy.
        </p>
      </section>

      <section>
        <h2>Local Clisbot apps and daemons</h2>
        <p>
          Clisbot runs on your machines. Usage analytics is optional and enabled by default in
          supported production builds. You can enable or disable it in Settings → General → Privacy.
          The daemon does not send product analytics or crash reports.
        </p>
        <p>
          We use these measurements to understand feature adoption and improve Clisbot. A random
          identifier can link usage from the same installation; this is pseudonymous data, not
          guaranteed anonymity. Google processes this metadata. We reduce exposure by collecting
          only standardized screen names, excluding work content and identifying details, and
          disabling advertising identifiers and personalization. Turning analytics off stops future
          collection and resets local identifiers; it does not erase data Google has already
          processed.
        </p>
        <p>
          When enabled, the app sends Google Analytics app opens, standardized screen names, usage
          duration, app version, and platform information. Android and iOS use Firebase Analytics,
          which also collects basic device and app lifecycle information and derives coarse location
          from masked IP addresses. Electron sends these limited usage events through our Cloudflare
          collector. Analytics identifiers are pseudonymous and reset on this device when you turn
          analytics off. Advertising identifiers and personalization are disabled. Analytics never
          includes prompts, chats, code, project names, file paths, host addresses, or account email
          addresses.
        </p>
        <p>
          Packaged desktop apps check GitHub Releases for updates. GitHub receives the ordinary
          network information needed to answer that request under its own privacy policy.
        </p>
        <p>
          Agents such as Claude Code, Codex, and OpenCode communicate with their providers using
          credentials on your machine. Clisbot does not manage or intercept those provider API
          calls.
        </p>
      </section>

      <section>
        <h2>The official relay</h2>
        <p>The relay is optional. To connect your client and daemon, it processes:</p>
        <ul>
          <li>IP addresses and connection timing</li>
          <li>Session identifiers and public handshake keys</li>
          <li>Message sizes and aggregate bandwidth</li>
          <li>Temporary connection and routing state</li>
        </ul>
        <p>
          Your client and daemon encrypt application traffic end-to-end with NaCl box encryption.
          The relay carries ciphertext and cannot read your code, prompts, terminal output, or agent
          conversations. Payloads exist in relay memory only while being forwarded. We do not store
          message contents. Infrastructure may retain limited operational logs and aggregate metrics
          for security, capacity planning, and troubleshooting.
        </p>
      </section>

      <section>
        <h2>Optional push notifications</h2>
        <p>
          If you allow notifications, the mobile app obtains an Expo push token and registers it
          with your connected Host. Expo processes the device token and app/project identifiers
          needed to route notifications. Your Host sends notifications through Expo and the
          applicable Apple or Google push service.
        </p>
        <p>
          Notification payloads may contain an assistant-reply preview, permission-request text, a
          terminal name, and routing metadata such as Host, workspace, or agent identifiers and a
          working-directory path. These payloads are separate from relay traffic: they are encrypted
          in transit but are not protected by the relay&apos;s end-to-end encryption, and the
          notification delivery providers can process their contents.
        </p>
        <p>
          You can disable notifications in your device settings. Your Host operator controls stored
          push subscriptions and can remove them. Notification providers handle delivery and
          retention under their own policies; disabling notifications does not delete data they have
          already processed.
        </p>
      </section>

      <section>
        <h2>Self-hosted Clisbot Hub</h2>
        <p>
          Clisbot Hub is software that you or your organization host. Clisbot does not host Hub
          accounts, store Hub conversations, or operate Hub billing. The Hub operator controls its
          accounts, organization settings, connected-service credentials, workflow data, and logs.
        </p>
        <p>
          Connecting the app to a Hub sends the information needed for the features you use to that
          Hub. Your Hub operator determines its privacy policy, retention, access, and deletion
          procedures. Contact that operator about your Hub account and data. Hub does not provide AI
          inference; your configured AI providers process requests under their own terms.
        </p>
      </section>

      <section>
        <h2>Who controls workflow data</h2>
        <p>
          You and the operators of the Hosts, Hubs, and connected services you choose control your
          workflow data. Clisbot does not receive that data merely because you use our software.
          Product analytics excludes work content, and the official relay cannot read encrypted
          application traffic.
        </p>
      </section>

      <section>
        <h2>Why we process data</h2>
        <p>We process data to:</p>
        <ul>
          <li>Provide relay connectivity, software distribution, and support</li>
          <li>Measure app usage when analytics is enabled</li>
          <li>Prevent abuse and protect the services</li>
          <li>Maintain operational and audit records</li>
          <li>Meet accounting, tax, and other legal obligations</li>
        </ul>
        <p>
          The legal bases are performance of our contract with you, our legitimate interests in
          operating and protecting the services, and compliance with legal obligations.
        </p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>
          Google processes the usage analytics described in this policy. Firebase SDKs also process
          limited technical diagnostic information. Expo and the applicable Apple or Google push
          service process optional notification delivery as described above. Cloudflare provides our
          website and desktop analytics collector, and GitHub distributes software releases. Your
          self-hosted Hub and the services you connect have their own operators and privacy
          policies.
        </p>
        <p>We do not sell personal data or use it for advertising or to train AI models.</p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Turning app analytics off stops future collection and resets local analytics identifiers;
          it does not erase data Google has already processed. Contact us about personal data
          processed by Clisbot through the website, analytics, support, or official relay.
        </p>
        <p>
          Hub accounts and workflow records belong to your self-hosted environment. Request their
          deletion from the Hub operator. Uninstalling the mobile app does not delete data stored on
          your Host, Hub, AI provider, or connected services.
        </p>
      </section>

      <section>
        <h2>Website analytics</h2>
        <p>
          If you accept analytics cookies, clisbot.com uses Google Analytics to measure page visits
          and understand website usage. Google receives page paths, browser and device information,
          approximate location, and pseudonymous browser identifiers. We do not send code, prompts,
          files, or agent conversations through website analytics. Advertising personalization and
          Google signals are disabled.
        </p>
        <p>
          Analytics is optional and is not loaded before you accept. You can decline or withdraw
          consent using Cookie settings in the footer. Learn more in{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            Google&apos;s privacy policy
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          The marketing website stores your analytics preference locally and uses first-party Google
          Analytics cookies only if you accept. It does not use advertising cookies. Your
          self-hosted Hub may use session and security cookies under its operator&apos;s policy.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on applicable law, you may request access, correction, deletion, restriction,
          objection, or portability of your personal data. Email{" "}
          <a href="mailto:clisbot@gmail.com">clisbot@gmail.com</a>. You may also complain to the
          data protection authority responsible in your jurisdiction.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          We use access controls, encrypted transport, and limited service permissions. No online
          service can guarantee absolute security. Read Clisbot&apos;s{" "}
          <a
            href="https://github.com/longbkit/clisbot/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            security model
          </a>{" "}
          or report a vulnerability privately to{" "}
          <a href="mailto:clisbot@gmail.com">clisbot@gmail.com</a>.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          The official services are for professional developers and are not directed at children
          under 16.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We will update this page and its date when our services or data practices materially
          change.
        </p>
      </section>
    </LegalPage>
  );
}
