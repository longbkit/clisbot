# Reviewed upstream documentation archives

These files are historical source evidence, excluded from the website's `public-docs/**/*.md` import glob. They are not current Clisbot instructions.

## v0.13.0 Chinese contract fallback

The source is raw Paseo v0.13.0, revision `d34d17a9072149320ace35ec2a2e5c7dcd992cb3` in [getpaseo/paseo](https://github.com/getpaseo/paseo/tree/d34d17a9072149320ace35ec2a2e5c7dcd992cb3/public-docs). Each archive preserves the raw UTF-8 source exactly, apart from one added provenance blockquote following frontmatter. The SHA256 below hashes the raw source, with that added line removed.

All 15 translations were absent from Clisbot's premerge revision `c2dc4ad90306163dabdb060280325700cbf145f1`. Fourteen corresponding English guides remain byte-identical to that revision; `cli.md` retains its fork-owned Hub & Channel connect contract plus reviewed upstream Host/plugin/send updates. A section mismatch exposed different behavior, not merely missing translated headings. Publishing the upstream translation would teach a different product contract.

The corresponding Chinese routes intentionally show the whole current English guide, with the existing untranslated notice. This is an exact 15-path decision, added to 16 previously reviewed English fallbacks (14 Clisbot guides and two legal pages). It does not change the loader, relax orphan detection, ignore heading/anchor parity, or exempt new untranslated pages. Other reviewed translations, including `hub/api.zh-CN.md`, remain published.

### Getting started and connectivity

Clisbot installation and Host/Hub onboarding, Tailscale priority, Docker service modes, and explicit local web lifecycle differ from the inherited server-first setup.

- `public-docs/index.zh-CN.md` → `index.zh-CN.md`
- `public-docs/connectivity.zh-CN.md` → `connectivity.zh-CN.md`
- `public-docs/docker.zh-CN.md` → `docker.zh-CN.md`
- `public-docs/web-ui.zh-CN.md` → `web-ui.zh-CN.md`

### CLI

Retain the fork Hub & Channel connect/origin contract; current CLI also includes reviewed upstream Host/plugin/send improvements. The inherited Chinese heading still presents the old Hub entry.

- `public-docs/cli.zh-CN.md` → `cli.zh-CN.md`

### Hub model and access

The current product has personal/team and simultaneous Hubs, Bot-first channel setup with verified ownership, Routes/Connections/Automations, managed Host access, and a separate advanced CLI login. Upstream describes a different onboarding/resource model.

- `public-docs/hub/index.zh-CN.md` → `hub/index.zh-CN.md`
- `public-docs/hub/quickstart.zh-CN.md` → `hub/quickstart.zh-CN.md`
- `public-docs/hub/concepts.zh-CN.md` → `hub/concepts.zh-CN.md`
- `public-docs/hub/daemons.zh-CN.md` → `hub/daemons.zh-CN.md`
- `public-docs/hub/faq.zh-CN.md` → `hub/faq.zh-CN.md`

### Automation definition and output

Clisbot uses validated Automation definitions, repository bundles, explicit continuation/output grants and GitHub reply semantics. The inherited sections describe a different installer/upgrade flow or omit the reply contract.

- `public-docs/hub/configuration/index.zh-CN.md` → `hub/configuration/index.zh-CN.md`
- `public-docs/hub/configuration/hub-yml.zh-CN.md` → `hub/configuration/hub-yml.zh-CN.md`
- `public-docs/hub/triggers/github.zh-CN.md` → `hub/triggers/github.zh-CN.md`

### Activity and security

Clisbot has durable bounded channel ingress retries/dead letters and a channel-ingress trust boundary. Upstream says nothing is retried and omits that ingress boundary.

- `public-docs/hub/activity.zh-CN.md` → `hub/activity.zh-CN.md`
- `public-docs/hub/security.zh-CN.md` → `hub/security.zh-CN.md`

## Exact source manifest

| Public source removed                            | Raw SHA256                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `public-docs/index.zh-CN.md`                     | `037087364af22c5d04165e2087618d094f39393e54cccd46f0b9b7f98d09b52a` |
| `public-docs/connectivity.zh-CN.md`              | `9cefda68d9912fccef758d4bf2f8da08b30ff27ece65defd9c4f572b0a2c1990` |
| `public-docs/docker.zh-CN.md`                    | `3bd0d5f5b537106affb5de434303d8304d9f9dc321a54b56caf339e0d825cecd` |
| `public-docs/web-ui.zh-CN.md`                    | `9c4199a72d41118dfc536b8596da46cf1325b01096ffe32b6da5059260b5e779` |
| `public-docs/cli.zh-CN.md`                       | `e798126986f1816fc0f3ce521b1ff2d044eb8eac54bae6dda9113b3ea0a5d3b3` |
| `public-docs/hub/index.zh-CN.md`                 | `021fbbcaa0cc50f4895ba790087843225c979ee28a7cfcab626108c51a42c283` |
| `public-docs/hub/quickstart.zh-CN.md`            | `5bb75f9d0d10bd174ca33209232c64b49e8f3def8f0085f7cd5e4ddde36a5021` |
| `public-docs/hub/concepts.zh-CN.md`              | `9e9c22d63b4201409942390ed58bbb0ef774e860557f2f07e5914e3fab072a80` |
| `public-docs/hub/daemons.zh-CN.md`               | `f6be156975b803cd10f226e1b87df35755ec4e46ba60d981c48ff679a715b368` |
| `public-docs/hub/triggers/github.zh-CN.md`       | `98055cb2df5ae98c9d995f208f9f000f4e61d0a8b9f827ba3f2c5350e51f2db7` |
| `public-docs/hub/configuration/index.zh-CN.md`   | `fac4e56d8e7a0816477de26ba1134ac1963281836833d574464d33ad2b615013` |
| `public-docs/hub/configuration/hub-yml.zh-CN.md` | `f942bc9155bba3ea65e83181da7af7ffca57e0a5e806e9a723af3743bee2ba77` |
| `public-docs/hub/activity.zh-CN.md`              | `31282d3c4e704c55f8c1089652cc24f36e11ef6c09ee1ccb930923972e37ba70` |
| `public-docs/hub/faq.zh-CN.md`                   | `41d9354ce8892b9b8209f2f7a7d16829434bc904bf55bcee0e62868bc0cef3d0` |
| `public-docs/hub/security.zh-CN.md`              | `f4b2e057506ac441933ac055e26f219f1e60cf910d1e87770d052fdf467f92b6` |

## Future sync and replacement

`scripts/rebrand-templates/publication.mjs` maps only these 15 exact Chinese paths into this archive before product-name, port or service-claim rewrites can replace their raw source. The normal rename protection for `docs/audits/**` makes a subsequent importer check stable. The importer test verifies every reviewed path, exact raw recovery, retained unrelated/unknown translations and idempotency.

When a complete translation is reviewed against the current Clisbot contract, restore its public source and remove that exact archival rule and required-English fallback together. Until then, unknown new pages still fail translation coverage. Do not extend the list automatically when upstream introduces a page or locale.

The earlier scoped hosted-claim corrections to `cli.zh-CN.md`, `hub/index.zh-CN.md`, `hub/daemons.zh-CN.md` and `hub/configuration/index.zh-CN.md` are superseded by this whole-page English fallback; their original repair evidence remains in the integration receipts. The `hub/api.zh-CN.md` correction remains live. `hub/hosted.zh-CN.md` is separately archived because Clisbot deliberately retired that service page; it has no public fallback route.

## v0.17.4 Hub capability reconciliation

The source is raw Paseo v0.17.4, revision `2b3559b107243306986176b80beb0e779f9fe53e` in [getpaseo/paseo](https://github.com/getpaseo/paseo/tree/2b3559b107243306986176b80beb0e779f9fe53e/public-docs/hub). Archives follow the v0.13.0 format: raw UTF-8 source plus one provenance blockquote after the frontmatter, written by `scripts/rebrand-templates/publication.mjs`; the SHA256 hashes the raw source.

Upstream's Hub guides describe getpaseo/hub. The bundled Clisbot Hub (`packages/hub`, synced separately) was checked at its parsers and dispatch:

- `packages/hub/src/triggers/configuration/schema.ts` makes `on.<event>` a strict object of `connection` and `filters` (no `recurrence`) and `run` a strict object without `continuation`, `tools` or `background`; `reuse: binding` is the only continuation field.
- Trigger providers register only `slack.mention`, `discord.mention`, `linear.issue`/`linear.comment`, GitHub, `manual.run` and `channel.message` sources (`src/triggers/*/provider.ts`); `src/workflows/engine.ts` drops any other source.
- The public API manifest (`src/public-api/operation-manifest.ts`) has no webhook-secret operation, and Hub has no `/webhooks/wh_...` route.

Linear triggers are implemented (`src/triggers/linear/`, `src/providers/linear/`); their guide stays published, aligned to the Clisbot contract (Connections, no continuation, `hub.reply`).

### Unsupported upstream pages (English and Chinese)

Removed from publication; `/docs/hub/tools`, `/docs/hub/triggers/webhooks` and `/docs/hub/triggers/schedules` redirect to `/docs/hub/triggers`, whose "Not available in Clisbot Hub" section names the alternatives.

- `public-docs/hub/tools{,.zh-CN}.md` → `hub/tools{,.zh-CN}.md`
- `public-docs/hub/triggers/webhooks{,.zh-CN}.md` → `hub/triggers/webhooks{,.zh-CN}.md`
- `public-docs/hub/triggers/schedules{,.zh-CN}.md` → `hub/triggers/schedules{,.zh-CN}.md`

### Divergent Chinese guides

These upstream translations teach the fields above or a standalone Hub dashboard on its own port. The Chinese routes serve the current Clisbot English original, added to the reviewed fallback list in `packages/website/src/content-translations.test.ts`:

- `public-docs/hub/triggers/index.zh-CN.md` → `hub/triggers/index.zh-CN.md`
- `public-docs/hub/configuration/reference.zh-CN.md` → `hub/configuration/reference.zh-CN.md`
- `public-docs/hub/self-hosting/index.zh-CN.md` → `hub/self-hosting/index.zh-CN.md`

`public-docs/hub/api.zh-CN.md` was replaced by upstream's translation of a different API (webhook secrets, no legacy configuration endpoints). Its upstream text is archived; the reviewed Clisbot translation from `55398093e` is restored and updated to the current English. The upstream Chinese pages for Slack, Discord, Linear, GitHub access and the Slack, Discord and Linear app setup stay published, with the sentences that taught continuation, Integration tools or `.clisbot/triggers` deployment translated from the Clisbot English.

The `/docs/hub/workflows` and `/docs/hub/configuration/hub-yml` English pages no longer exist; both redirect to `/docs/hub/configuration/reference`, which documents Workflow documents and legacy repository bundles. The v0.13.0 `hub/configuration/hub-yml.zh-CN.md` archive remains as evidence.

| Public source removed                              | Raw SHA256                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `public-docs/hub/tools.md`                         | `98eea9700f55a8238e7ad3d546e0806e239c3922344b0d1275453537cd604941` |
| `public-docs/hub/tools.zh-CN.md`                   | `85255a02e8c788816b9ad26ac9d0206962b8d715dd1c43e82d61e7365a8efcc4` |
| `public-docs/hub/triggers/webhooks.md`             | `4d7cab967c2a7752f3b1c3afa3543a9693032caaabf618dadf44d18d3106a95b` |
| `public-docs/hub/triggers/webhooks.zh-CN.md`       | `e6a311b4d00bc33e19957fbbcffc72ac0216265f96e467a3eeb681e1f4f5b4c1` |
| `public-docs/hub/triggers/schedules.md`            | `001813aa454b010d838fd70296eeae28d365965acf8d0057c3f7b7b09dadeac3` |
| `public-docs/hub/triggers/schedules.zh-CN.md`      | `d0da7dd190dee9204b2838ee89e27b7ae4d8a22c645dbe8a06b6549ecaeddf01` |
| `public-docs/hub/api.zh-CN.md`                     | `e7924edc0a74cd8a8dd84b9d49f56f09583a0a035fe83783b7952dc8d43bcaff` |
| `public-docs/hub/triggers/index.zh-CN.md`          | `6ff4abf0b3d1c415fb9c3a4d1f52beaef8d6bded89fedf2ee5ace5b03c832e34` |
| `public-docs/hub/configuration/reference.zh-CN.md` | `cace485453504f17abbbb673494fa3c2c6672957858ae85420b4d3c7020d2392` |
| `public-docs/hub/self-hosting/index.zh-CN.md`      | `981ca81fc72e8e0565e56578255dca4c3f8914d2715a4d328fecac81242065bc` |

`scripts/rebrand-templates/publication.mjs` archives these paths on every future rebrand: the three feature guides in every locale (`unsupportedHubDoc`) and the four Chinese guides by exact path (`divergentChineseDocs`). `scripts/rebrand-clisbot.test.mjs` covers both rules, raw recovery and idempotency. When the bundled Hub implements a feature, or a translation is reviewed against the Clisbot contract, remove its rule, fallback entry and redirect together.
