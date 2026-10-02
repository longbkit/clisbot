# Clisbot brand kit

Approved direction: **B1-A Flow, primary version with the open curved gap, Ocean 02**.
The fused version remains a concept backup in the branding audit; it is not an
interchangeable production logo.

Open [PREVIEW.html](PREVIEW.html) to review the kit. [manifest.json](manifest.json)
lists every export, its SHA-256, and the repository paths that receive it.

## Masters and colors

- [source/mark.svg](source/mark.svg): clean vector construction from the selected concept.
- [source/mark-small.svg](source/mark-small.svg): wider gap and titlebar opening for small icons.
- [source/wordmark.svg](source/wordmark.svg): outlined lowercase wordmark, Manrope Bold.
- Ocean background: `#153B43`; seafoam mark: `#A1DFD4`; paper: `#F6F4EF`.
- Dark/light and black/white variants share the primary geometry. Preserve the gap.
- App tiles use a 62% mark width. Android foreground uses 50% of the layer width
  to fit the 66/108 safe circle; PWA/touch images use 54% and an opaque full bleed background.
- The native store icon has opaque square corners; the platform applies its mask.
- Running remains blue `#3B82F6`; attention remains green `#22C55E`, matching the
  existing application semantics.
- Website and web app favicons use the Ocean background and seafoam mark in both
  system themes. The app keeps its running and attention dots; light artwork
  remains available in the kit for other surfaces. The visual application script
  also updates the app's runtime selector after an upstream sync.

The wordmark is outlined so SVG consumers do not need to install the font.
The variable Manrope font and a generated 700-weight instance are included under
[SIL OFL](fonts/OFL.txt), sourced from the
[Google Fonts Manrope directory](https://github.com/google/fonts/tree/main/ofl/manrope).
Original Clisbot artwork and modifications: Long Luong, 2026. See [LICENSE](LICENSE)
for project licensing and preserved upstream notices.

## Export groups

| Folder                   | Contents                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| `exports/logos/`         | SVG and transparent PNG marks and horizontal lockups; outlined wordmark         |
| `exports/icons/`         | Ocean/light sizes 16–1024, store, PWA/touch, desktop development icon           |
| `exports/favicons/`      | Light/dark idle, running and attention; SVG/PNG                                 |
| `exports/desktop/`       | ICO with 16/24/32/48/64/128/256 frames; ICNS through 1024                       |
| `exports/android/`       | Adaptive foreground, background and monochrome layer                            |
| `exports/notifications/` | White alpha glyphs for Android; colored browser notification icon               |
| `exports/splash/`        | Light/dark transparent splash marks                                             |
| `exports/social/`        | 1200×630 Open Graph card, SVG with outlined text and PNG                        |
| `exports/marketing/`     | Desktop/mobile marketing renders, phone variants and Android storefront mockups |

Marketing images are rendered from the repository's existing website mockup
components, with Clisbot branding. They are not captures of a running daemon or
a native release build. Check storefront images against the release UI before
publishing. Historical audit and plugin-example evidence is preserved separately.

## Rebuild and apply

From the Fusion checkout, with workspace dependencies and Google Chrome installed:

```sh
npm run branding:apply
npm run branding:build
npm run branding:apply
npm run branding:check
node scripts/branding/preview.mjs --screenshot
npm run branding:pack
```

Apply the checked-in kit before building so marketing captures use the current
Clisbot mark; apply again after rebuilding to install the new exports.
The build uses checked-in SVG/font sources and local browser renders. It makes
no image-generation requests and needs no API key. PNG/SVG/container outputs are
deterministic; browser screenshots can vary with browser/font rasterizer versions.
The ZIP is a local delivery artifact and is gitignored; sources and exports are tracked.

For transformed upstream, invoke the same script and kit from Fusion:

```sh
node /path/to/fusion/scripts/branding/apply.mjs --root /path/to/transformed-upstream
node /path/to/fusion/scripts/branding/apply.mjs --root /path/to/transformed-upstream --apply
node /path/to/fusion/scripts/branding/apply.mjs --root /path/to/transformed-upstream --check
```

Run the text/path rebrand first. The visual script plans every edit before writing,
checks export hashes, rejects unknown upstream logo geometry, and skips Hub only
when that package does not exist. Existing asset paths are retained for mergeability,
including the two legacy `butterfly-*.svg` filenames; their contents are Clisbot.
Fastlane's three upstream screenshot symlinks become regular files: Android
mockups must not overwrite the website's iPhone mockups through those links.

For an upstream version with different UI, rebuild marketing renders against that
version before release. This kit's fixed renders are the current Fusion reference.
See the [upstream playbook](../../../docs/guides/developer-guide/upstream-sync-and-contribution.md)
and the [branding audit](../../../docs/audits/2026-09-30-clisbot-branding/README.md).
