# @clisbot/channels-whatsapp

The WhatsApp channel vertical: a WhatsApp account joined as a linked device
through [Baileys](https://github.com/WhiskeySockets/Baileys), the same SDK and
version OpenClaw uses. Ported from `extensions/whatsapp/src` at OpenClaw
`v2026.9.2` (`3928bad9bad`).

- Outside `src/fusion/` and `src/lifecycle/`: upstream's files, at upstream's
  paths. Do not reformat or rename them; `upstream-sync.json` records which are
  verbatim and why the adapted ones differ.
- `src/fusion/`: the boundaries where upstream depended on the OpenClaw host —
  the encrypted auth directory, Hub admission, the reconnect loop without the
  agent, the QR verbs.
- How the Hub drives it: [HUB-WIRING.md](HUB-WIRING.md).

## Licensing

The npm package includes `LICENSE` for the repository license, `NOTICE` for
the pinned OpenClaw attribution and MIT terms, and the unchanged upstream
`THIRD_PARTY_NOTICES.md`. Keep these files in the package allowlist when syncing
upstream; inspect the actual tarball before publishing. Dependency licenses are
separate from these source notices.

## Checks

```sh
npm run build --workspace=@clisbot/channels-whatsapp
cd packages/channels/whatsapp && npx vitest run src/<file>.test.ts
OPENCLAW_UPSTREAM_DIR=<openclaw checkout with 3928bad9bad> npm run channels:sync:check -- --pkg whatsapp
```

The live QR start needs no phone: the vertical's `startQrLogin` returns a code
from WhatsApp's servers. Linking and messaging need a spare number and a human
to scan the code.
