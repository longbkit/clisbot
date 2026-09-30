# Clisbot branding audit and concept review

**2026-09-30 — B1-A Flow / Ocean 02 production kit applied on the Fusion test branch.**

This folder groups the visual-branding inventory, evidence, and proposed Clisbot
directions. It supplements the
[rebrand decision](../2026-09-29-clisbot-rebrand-upstream-sync-decision.md) and
[upstream sync playbook](../../guides/developer-guide/upstream-sync-and-contribution.md).

Start with [production artifacts and verification](production-artifacts.md),
the [publication identity and marketing review](publication-review.md),
the [brand kit](../../../assets/branding/clisbot/README.md), or its
[visual preview](../../../assets/branding/clisbot/PREVIEW.html).
The inventory and contact sheets below preserve the pre-replacement baseline.

## Contents

| File                                                               | Purpose                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [inventory.md](inventory.md)                                       | Complete file list, source consumers, retained Paseo imagery, publication identity issues, and scope limits |
| [favicons.md](favicons.md)                                         | Explicit favicon, browser notification, PWA, and Hub coverage                                               |
| [branding-concepts.md](branding-concepts.md)                       | Three directions for review; meaning, palette, tradeoffs, and selection criteria                            |
| [images/01-icons.jpg](images/01-icons.jpg)                         | Existing app, desktop, and favicon contact sheet                                                            |
| [images/02-marketing.jpg](images/02-marketing.jpg)                 | Existing screenshots and marketing imagery                                                                  |
| [images/03-other-screenshots.jpg](images/03-other-screenshots.jpg) | Documentation, E2E, sample app, and Hub evidence                                                            |
| [evidence/baseline.json](evidence/baseline.json)                   | Branches, commits, scope, and counts at the time of the audit                                               |
| [evidence/assets.json](evidence/assets.json)                       | All 147 tracked image/video files, dimensions, sizes, and Git blob comparisons                              |
| [evidence/logo-assets.json](evidence/logo-assets.json)             | The 34 product logo assets                                                                                  |
| [evidence/references.json](evidence/references.json)               | Raw text-search candidates and source lines; the inventory filters unrelated matches                        |
| [evidence/ocr-brand-hits.json](evidence/ocr-brand-hits.json)       | Old-brand text detected in 16 of 44 inspected raster images                                                 |

## Findings at this baseline

Concept review materials: [comparison board](images/clisbot-brand-directions.png),
[generation brief and correction prompt](concept-generation.md), and
[B similarity review](concept-b-review.md).

Current decision: [B1-A Flow — primary with the open gap, Ocean 02](concept-b1-workspace-chat.md).
Palette review: [original and refined Ocean](concept-b1-workspace-chat.md#thử-tinh-chỉnh-ocean-trên-bản-chính).
Previous exploration: [B1/B2/B3 and dark app icons](concept-b-refinement.md).

- Fusion contains **40 files with product logo geometry or imagery**: 34 assets
  and six source files. The transformed upstream branch has 38; the two Hub
  source files exist only in Fusion.
- All 34 logo assets are unchanged from Paseo v0.10.1. Renamed components still
  draw Paseo's butterfly, while the Hub's two glyph definitions still draw P.
- The 17 product screenshots/previews and ten plugin documentation screenshots
  retain upstream pixels. Some contain old names, repository paths, or commands.
- Website legal identity, quotations, blog authorship, publication IDs, and
  external destinations require contextual review beyond string replacement.

The count of 147 files includes third-party provider/editor icons and historical
evidence. It is a snapshot at the recorded commits, not the number of files to
replace. This audit's contact sheets and future concept images are excluded.

## Revisit during upstream sync

1. Compare the new transformed snapshot with the last accepted release for
   added or changed assets, embedded SVG paths, screenshots, and consumers.
2. Use [the favicon list](favicons.md) and the inventory as a starting point;
   inspect new paths too. A text scan cannot detect names rendered into pixels.
3. Apply the checked-in kit using the [playbook](../../guides/developer-guide/upstream-sync-and-contribution.md#visual-branding-transform).
   Review the Clisbot artwork at app-icon and 16/32 px favicon sizes,
   in monochrome and both backgrounds. Check status dots separately.
4. Review website identity and publication destinations. Keep upstream credit
   and quotations truthful; do not convert another project's testimonials into
   Clisbot testimonials through replacement.
5. Record new counts and evidence in a dated follow-up. Keep these baseline
   observations distinguishable from later fixes and new concepts.

## Review status

- Inventory: complete within the scope stated in [inventory.md](inventory.md).
- Branding direction: see the [selected primary and backup](concept-b1-workspace-chat.md#quyết-định-lựa-chọn).
- Original concept B: retained as proposal history after similarity review.
- Refined B1/B2/B3: retained as exploration history.
- Production artwork: 94 exports; 55 installed assets and 11 source/configuration
  consumers updated on `rebrand/clisbot-fusion-test`.
- Repeatability: verified on disposable Fusion and upstream v0.10.1 snapshots.
  See [results and remaining release checks](production-artifacts.md#verification).
