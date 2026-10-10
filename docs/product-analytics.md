# Product analytics

Optional usage analytics belongs to the clients, not the daemon or agent providers.
App analytics is enabled by default with a visible Privacy control and a short
non-blocking explanation on Welcome. An explicit opt-out is always preserved.
Website analytics still requires cookie acceptance. No changes to RPC, pairing, relay encryption or
account authorization. No user ID, email, prompts, transcripts, code, paths,
project/Host names or raw application URLs are sent.

## Collection

One GA4 property: **Clisbot (clisbot.com), 556929300**, Vietnam timezone.
Firebase project: **clisbot-analytics**, Spark plan, linked to that same property.

| Surface                   | Stream                                        | Integration                                             |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Website + app.clisbot.com | Clisbot Web / 15911147403 / G-YB48G0QD0C      | Google tag, manual page views                           |
| Android / com.clisbot.app | Clisbot Android / 15912043584                 | React Native Firebase Analytics                         |
| iOS / com.clisbot.app     | Clisbot iOS / 15911576270                     | React Native Firebase Analytics without advertising ID  |
| Electron                  | Clisbot Electron / 15911062575 / G-V91TM1TD18 | Bounded Cloudflare collector → GA4 Measurement Protocol |

Website and web app share a stream to preserve browser journeys. `surface`
distinguishes `website` and `app`. Native app streams share the property but
have SDK-managed app-instance IDs. Electron has a random installation ID
created only after consent; a session expires after 30 minutes of inactivity.
Anonymous identities are **not** merged across devices. There is no official
native Electron Analytics SDK: Measurement Protocol reports manually supplied
events, without the complete native SDK attribution/install lifecycle.
GA4 event-scoped custom dimensions **Surface** (`surface`) and **Client platform**
(`client_platform`) are registered for reports and explorations.

| App event   | Data                                       | Adapter behavior                                                           |
| ----------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| app_open    | surface, platform, version where available | Startup/foreground after consent                                           |
| screen_view | Allowlisted screen enum                    | Native screen_view; web/Electron page_view with a synthetic public URL     |
| engagement  | Active usage duration                      | Native/web SDKs own duration; Electron sends a bounded 30-second heartbeat |

Screen labels come from Expo route **templates**, never dynamic IDs or titles.
Web app locations and referrers are overridden to prevent leaking route IDs.
Enhanced measurement is off, ads consent is denied, and Google signals are off
in browser tag configuration. Native SDK automatic screen reporting, IDFA,
IDFV, advertising ID and SSAID collection are disabled. Basic SDK device/app
lifecycle metrics may be collected while native analytics is enabled.

## Ownership and controls

- Implementation: `packages/app/src/clisbot/analytics/`; the root mounts one
  observer and General settings mounts one consent control.
- App choice: Settings → General → Privacy → Share usage analytics, stored
  locally as `clisbot:product-analytics-consent:v1`. New installs default on;
  stored opt-outs stay off. No replay of events discarded while disabled.
  Revocation stops app event dispatch immediately and resets local identifiers.
  A failed save pauses collection and displays a retry message.
- Website: Cookie preferences, editable from the footer. Google tag is loaded
  only after acceptance (basic consent), and `_ga` cookies are cleared on revoke.
- Build kill switch: `EXPO_PUBLIC_CLISBOT_ANALYTICS=0`. Development and F-Droid builds are
  disabled; Firebase native dependencies are excluded from autolinking there.
- Native files stay in ignored `packages/app/.secrets/`. Supply both production
  Google config files via the existing `GOOGLE_SERVICES_FILE_PROD` and
  `GOOGLE_SERVICE_INFO_PLIST_PROD` build inputs. Native SDK changes require a
  fresh native build; Expo Go and an OTA-only update cannot add this SDK.
  Both inputs are stored as EAS secret files for production and preview on
  `@lbk-company/clisbot`; development builds do not use them.
  When enabled, leave Firebase's React Native platform configuration intact:
  Expo replaces a project's `platforms` override rather than merging the
  library's CMake paths and iOS script phases into it.
- Electron collector: `/api/analytics/desktop`, maximum 1 KB, exact field and
  screen allowlists, IP rate limit 120/minute per Cloudflare location. No event
  content is logged or persisted. CORS is an origin filter, not authentication;
  this public endpoint can still receive fabricated usage events.
- `GA4_DESKTOP_API_SECRET` lives only in the `clisbot-website` Worker secret.
  Never put it in an Expo public environment variable, desktop bundle or git.
  Missing secret/limiter disables collection (503). Errors never block the app.

## Self-hosted Electron analytics

This setup is optional. Hosting a daemon, Hub or relay does not require a GA4
secret. Configure it only when you deploy your own Electron analytics collector
and want its events in your own GA4 property. The official clients use the
Clisbot collector; adding a secret to a daemon's environment does not redirect
those clients or configure their analytics.

### Create the GA4 values

1. Create or select your own GA4 property, then create a **Web** data stream for
   desktop analytics. The collector sends web Measurement Protocol payloads
   (`client_id`), so use a Web stream even though the client is Electron.
2. Copy that stream's **Measurement ID** (`G-...`). This is the public value for
   `GA4_DESKTOP_MEASUREMENT_ID`; it is not the numeric property or stream ID.
3. In GA4, open **Admin → Data streams → your desktop Web stream → Measurement
   Protocol API secrets → Create**. Give it a nickname, then copy the **Secret
   value** into private storage. Use the value, not its nickname or numeric ID,
   for `GA4_DESKTOP_API_SECRET`.

The Measurement ID and API secret must belong to the same stream. See
[Google's Measurement Protocol setup](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events).

### Configure your collector Worker

Before deploying a fork, change `packages/website/wrangler.toml` to your own
Worker name, Cloudflare account, routes and KV namespace. Set
`vars.GA4_DESKTOP_MEASUREMENT_ID` to your stream's `G-...` value. Keep the
`DESKTOP_ANALYTICS_LIMITER` binding configured; the collector returns `503`
without the limiter, Measurement ID or API secret.

Deploy your configured website Worker, then add the secret through its
interactive prompt:

```bash
cd packages/website
npm run deploy
npx wrangler secret put GA4_DESKTOP_API_SECRET
npx wrangler secret list
```

Confirm Wrangler targets your own account and Worker before running these
commands. `secret put` deploys a new Worker version; `secret list` shows names,
not values. You can also add a **Secret** named `GA4_DESKTOP_API_SECRET` under
your Worker's **Settings → Variables and Secrets**. See
[Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

For local development, use the
[Worker example](../packages/website/.dev.vars.example):

```bash
cd packages/website
cp -n .dev.vars.example .dev.vars
chmod 600 .dev.vars
# Fill the two values in .dev.vars, preferably using a separate test stream.
npm run dev
```

The root `.env` is for CLI/onboarding configuration; it does not populate this
Worker's bindings. Local `.dev.vars` does not upload secrets to production.
Filled `.dev.vars` files are ignored by Git. Keep the secret out of Wrangler
`[vars]`, `VITE_*`, `EXPO_PUBLIC_*` and client bundles.

### Point your Electron build at the collector

In `packages/app/src/clisbot/analytics/config.ts`, change `DESKTOP_COLLECTOR` to
`https://your-website.example/api/analytics/desktop`, then rebuild your desktop
app. The URL is currently a source constant, not an environment override.
Leave the API secret on the Worker; Electron sends events to the collector,
which authenticates the outgoing Google request.

This guide configures Electron collection. Website/web Measurement IDs and
origin checks are separate source settings; native apps use their own Firebase
configuration files. Use your own identifiers when building those surfaces.
To disable app analytics in a custom build, set
`EXPO_PUBLIC_CLISBOT_ANALYTICS=0` in its build environment and rebuild.

Verify a consented event appears in your own GA4 reports. A collector `204`
alone does not prove Google accepted the event; missing configuration returns
`503`. Settings → General → Privacy still controls client consent.

## Verification and rollout

Focused tests cover opt-in, immediate revoke, failed storage/SDK, sanitized
screens and collector validation/rate limiting. Typecheck both packages and
export a production web bundle. Inspect native prebuild output for Firebase
configuration and denied-by-default metadata; verify F-Droid/dev autolinking
contains no Firebase modules.

In a production browser, verify rejection loads no Google tag/cookies; accept,
navigate, and confirm the matching page_view in GA4 Realtime. Test revoke and
reload. Native verification additionally needs a fresh Android/iOS binary and
Firebase DebugView; desktop needs a packaged production renderer and collector
receipt. Do not equate a successful build or HTTP 204 alone with report receipt.
Before releasing native binaries, update the App Store privacy disclosures and
Google Play Data safety answers to include the actual Analytics SDK collection.

2026-10-01 verification: website page views appeared in GA4 Realtime. The web
app is deployed at `app.clisbot.com`; its Google tag stays unloaded when
disabled, and emitted page locations contain only allowlisted screen labels.
Native prebuild generated Firebase configuration; dev/F-Droid autolinking
excluded the SDK. Electron payloads passed Google's strict validation server
with no validation messages, and the production collector returned 204.
Native/packaged Electron receipt still needs verification with fresh binaries;
Electron Realtime receipt has not yet been confirmed.

Rollback: turn off the build feature, redeploy the web app/rebuild native
clients, and remove the Worker secret to disable Electron ingestion. Consent
controls remain off; a user can always revoke in the current app.

References: [Expo Firebase integration](https://docs.expo.dev/guides/using-firebase/),
[basic consent](https://developers.google.com/tag-platform/security/concepts/consent-mode),
[Measurement Protocol scope](https://developers.google.com/analytics/devguides/collection/protocol/ga4).
