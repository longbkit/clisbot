# Favicon coverage

This page records the pre-replacement baseline. All product favicons below now
use Flow / Ocean 02 on the Fusion test branch; see
[production artifacts](production-artifacts.md) for installed assets and checks.

**Yes: favicons are included in the branding inventory.** There are 15 standalone
product favicon assets and one inline Hub favicon definition. The three PWA/touch
icons are separate assets, also included in the 34-logo-asset count.

## App: 13 files

Folder: `packages/app/assets/images/`.

| Variant             | PNG                                                                                            | SVG                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Default web favicon | [favicon.png](../../../packages/app/assets/images/favicon.png)                                 | —                                                                                              |
| Dark, idle          | [favicon-dark.png](../../../packages/app/assets/images/favicon-dark.png)                       | [favicon-dark.svg](../../../packages/app/assets/images/favicon-dark.svg)                       |
| Dark, running       | [favicon-dark-running.png](../../../packages/app/assets/images/favicon-dark-running.png)       | [favicon-dark-running.svg](../../../packages/app/assets/images/favicon-dark-running.svg)       |
| Dark, attention     | [favicon-dark-attention.png](../../../packages/app/assets/images/favicon-dark-attention.png)   | [favicon-dark-attention.svg](../../../packages/app/assets/images/favicon-dark-attention.svg)   |
| Light, idle         | [favicon-light.png](../../../packages/app/assets/images/favicon-light.png)                     | [favicon-light.svg](../../../packages/app/assets/images/favicon-light.svg)                     |
| Light, running      | [favicon-light-running.png](../../../packages/app/assets/images/favicon-light-running.png)     | [favicon-light-running.svg](../../../packages/app/assets/images/favicon-light-running.svg)     |
| Light, attention    | [favicon-light-attention.png](../../../packages/app/assets/images/favicon-light-attention.png) | [favicon-light-attention.svg](../../../packages/app/assets/images/favicon-light-attention.svg) |

[app.config.js](../../../packages/app/app.config.js#L160) selects the default;
[use-favicon-status.ts](../../../packages/app/src/hooks/use-favicon-status.ts#L13)
selects the six status PNGs. The SVGs contain the same butterfly geometry but
were not directly referenced by runtime imports at the audited commits.

## Website: two files

- [favicon.ico](../../../packages/website/public/favicon.ico)
- [favicon.svg](../../../packages/website/public/favicon.svg)

Both are configured in
[the website root](../../../packages/website/src/routes/__root.tsx#L70).
The SVG is also advertised as the website's Apple touch icon.

## Hub: one inline definition

[packages/hub/src/routes/\_\_root.tsx](../../../packages/hub/src/routes/__root.tsx#L17)
embeds an SVG data URL drawing P. There is no standalone favicon file to find
by filename. The separate P glyph in
[auth-layout.tsx](../../../packages/hub/src/components/app/auth-layout.tsx#L91)
also needs attention when the Hub identity changes.

## PWA and browser notifications

- [apple-touch-icon.png](../../../packages/app/public/apple-touch-icon.png)
- [pwa-icon-192.png](../../../packages/app/public/pwa-icon-192.png)
- [pwa-icon-512.png](../../../packages/app/public/pwa-icon-512.png)
- [notification-icon.png](../../../packages/app/assets/images/notification-icon.png)

Consumers: [index.html](../../../packages/app/public/index.html#L16),
[manifest.json](../../../packages/app/public/manifest.json#L13),
[os-notifications.ts](../../../packages/app/src/utils/os-notifications.ts#L106),
and the Expo notification plugin in
[app.config.js](../../../packages/app/app.config.js#L70).

The two additional `favicon.png` files under `packages/expo-two-way-audio/examples/`
are Expo sample assets. They are recorded in the complete media inventory and
excluded from the product-brand replacement count.

## Review after choosing a concept

Check the selected mark at 16, 32, and 48 px; light/dark backgrounds; idle,
running, and attention states; browser tab, installed PWA, notification, and Hub.
Preserve the existing meanings of status colors. Concept-board thumbnail samples
are visual proposals, not verified exported favicon files.
