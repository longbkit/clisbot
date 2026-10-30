# desktop

Electron desktop app for Clisbot.

Build installers from the repository root with `npm run build:desktop -- --publish never`.
This exports the renderer with `CLISBOT_WEB_PLATFORM=electron`, then builds and packages
the desktop application. A generic web export selects browser fallbacks and cannot
be reused as the desktop renderer.

Packaging verifies the Electron export receipt and every exported file before packing
and again in the packaged resources. Missing or stale receipts fail the build. Calling
the desktop workspace build directly requires an unchanged renderer previously prepared
by the root build. Installer acceptance must also open the packaged application and
exercise an embedded browser tab; a successful build alone does not verify that flow.
