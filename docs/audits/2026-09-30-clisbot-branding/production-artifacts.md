# Flow / Ocean 02 production artifacts

**2026-09-30 — applied in `rebrand/clisbot-fusion-test`.**

Approved artwork: B1-A Flow's first version, with the open curved gap between
workspace and chat. The solid joined version remains a concept backup.
The [kit README](../../../assets/branding/clisbot/README.md) owns palette,
master files, font licensing, export formats and rebuild commands.

## Deliverables

- [Visual preview](../../../assets/branding/clisbot/PREVIEW.html) and
  [preview PNG](../../../assets/branding/clisbot/preview.png).
- [94 exports and 55 installation destinations](../../../assets/branding/clisbot/manifest.json),
  with SHA-256 hashes. Formats include SVG, PNG, WebP, ICO and ICNS.
- [Source masters](../../../assets/branding/clisbot/source/mark.svg), small-size
  artwork and an outlined Manrope wordmark; font files and OFL notice included.
- Local ZIP: `assets/branding/clisbot/clisbot-brand-kit.zip`, recreated with
  `npm run branding:pack` and excluded from Git. The pack includes masters,
  fonts, exports, preview, manifest, README and project LICENSE.
- [Repeatable application script](../../../scripts/branding/apply.mjs).
  The [upstream playbook](../../guides/developer-guide/upstream-sync-and-contribution.md#visual-branding-transform)
  places this step after the text/path rename and checks it again after a merge.

## Replacement coverage

Against Fusion baseline `17566cab8`: **66 product paths**, comprising 55 asset
destinations and 11 source/configuration files. Four assets are new; 62 paths
already existed. This covers all 34 original logo assets, all six inline logo
consumers, and all 17 product screenshot/preview paths from the
[baseline inventory](inventory.md).

| Folder             | Assets | Source/config | Total paths | Text lines added | Text lines removed |
| ------------------ | -----: | ------------: | ----------: | ---------------: | -----------------: |
| `packages/app`     |     25 |             4 |          29 |               26 |                 41 |
| `packages/desktop` |      8 |             0 |           8 |                0 |                  0 |
| `packages/hub`     |      0 |             2 |           2 |                4 |                  7 |
| `packages/website` |     18 |             5 |          23 |               18 |                 18 |
| `fastlane`         |      4 |             0 |           4 |                0 |                  0 |
| **Total**          | **55** |        **11** |      **66** |           **48** |             **66** |

Line counts are Git added/deleted lines in text source and SVG files, excluding
binary image contents, kit sources, scripts and docs. They do not measure image
complexity. Three Fastlane paths also change from symlinks to regular PNG files.

The four new destinations are Android's monochrome layer, the dark splash,
a separate colored browser notification image, and the website's Apple touch
PNG. Android notifications use a white alpha mask; browsers keep a colored icon.
The web startup splash uses an independent CSS mask, and the Hub favicon is an
inline data URL; replacing image files alone would miss both.

Existing paths are retained to reduce upstream conflicts. In particular,
`butterfly-green.svg` and `butterfly-white.svg` now contain the Flow mark.
Fastlane's upstream symlinks pointed into the website's phone images; atomic
replacement of the directory entry keeps Android and iPhone renders separate.

## Verification

| Check                                                           | Result                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Export hashes and image decoding                                | All 94 exports passed                                                             |
| Store/PWA opacity, white notification mask, Android safe circle | Passed; foreground radius 0.30083 of layer width, below 33/108                    |
| ICO and ICNS containers                                         | Seven decoded frames each; macOS `iconutil` accepted ICNS                         |
| Marketing render                                                | 16 captures; no page errors, broken images, or old brand text; styled UI verified |
| Current checkout `branding:check`                               | Passed; zero pending replacements                                                 |
| Fusion snapshot replay                                          | 66 changed paths, then zero on repeat                                             |
| Raw upstream v0.10.1 replay after text rename                   | 64 changed paths, then zero on repeat; Hub absent                                 |
| Unknown upstream logo                                           | Rejected before writes, including a deliberately stale image                      |
| Rename-protected matching script and font license               | Preserved byte for byte                                                           |
| `npm run typecheck`                                             | Passed across workspaces                                                          |
| `node --test scripts/rebrand-clisbot.test.mjs`                  | 8 passed                                                                          |
| Lint on branding scripts and rename script                      | Zero errors or warnings                                                           |
| Full repository lint                                            | Existing baseline remains: 166 errors, 8 warnings                                 |

[Replay evidence](evidence/production-replay.json) records exact commits and
folder counts. Each replay copied only the tracked branding consumers/assets
into a disposable Git repository, ran text rename and visual application, then
checked idempotency and failure behavior. It did not perform a Git merge or
build the full application. The upstream annotated tag object is `2abbca32b`;
its peeled source commit is `c5236c00d8575cdc4423407dd4cb9f111135564e`.

## Release boundary

Website and storefront images are marketing mockups rendered from the existing
website UI components. Compare them with the actual native release before store
submission. Native installation, splash behavior on devices and store upload
have not been tested by this asset task.

Historical audit images, plugin documentation examples, provider logos, portraits
and testimonials remain outside this replacement. The inventory identifies these
separately; publication identity and testimonial claims still need their own
review. Do not treat this kit as a claim that every old name in repository history
or every inherited publication destination has been removed.

Changes are confined to the Fusion test checkout. The real transformed-upstream
branch, original Fusion branch and `main` have not received this kit. Their
merge and promotion remain subject to the user's existing confirmation steps.
