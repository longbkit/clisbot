# Quick start

[User guide](../README.md) · [Manage Hosts](../hosts/connect-and-manage.md) · [Q&A](../help/faq.md)

A **Host** is the machine that runs agents and holds the code. Each machine needs at least one agent CLI (Claude Code, Codex…) that is signed in.

## Your machine, with the desktop app

1. Download the app from [GitHub Releases](https://github.com/longbkit/clisbot/releases/latest) and open it.
2. The app runs a Host on the machine itself; you install nothing else.
3. Choose **Add a project**, pick a code folder, then create a session.

## Your machine, with the CLI

Requires Node.js 22.19 or later.

```bash
npm install -g clisbot
clisbot
```

The CLI asks whether to turn on voice, then how to connect:

- If the machine is signed in to Tailscale, the CLI uses Tailscale; if it cannot turn on Tailscale Serve, it falls back to the relay.
- Without Tailscale, choose **Use encrypted relay** to connect from anywhere, or **Use this machine only**.

The CLI starts the Host, then prints a QR code and a **pairing link**. A link works for one device and expires after 5 minutes.

Later, including when you need a new link or after rebooting, run `clisbot` again. It reuses the running Host (or starts it again if stopped) and prints a new link. On a relay machine, run `clisbot --relay` so the CLI does not ask how to connect again.

To run without prompts, including the first launch: `clisbot --relay --voice disable`. Without an interactive terminal, `clisbot` also skips prompts and keeps your saved voice setting (off on a fresh setup).

## Open on the web or a phone

- **Web:** open the pairing link in a browser; it opens `app.clisbot.com` and connects.
- **Phone:** scan the QR code with the camera or open the link in the phone's browser. The iOS and Android apps are not in the stores yet.
- **From the desktop app:** go to **Settings → [Host] → Pair a device** to show a QR code for your phone.

## Host on another machine (server, office machine)

1. SSH into that machine, run `npm install -g clisbot` then `clisbot`, and choose Tailscale or relay as above.
2. In the desktop app: **Add a Host → Paste pairing link**, then paste the printed link.
3. On a phone: run `clisbot` again on the Host machine to get a new link, then scan the QR code.

Each device needs its own link. Closing the terminal does not stop the Host; stop it with `clisbot daemon stop`.

## Use your organization's existing Hub

- **Members:** accept the email invitation, then in the app choose the **Clisbot Hub** tile on the Welcome screen (or **Settings → Account**) to sign in. Hosts you have access to appear in **Settings → Hosts**.
- **Add a machine to the Hub:** start the Host on that machine first, then run `clisbot hub connect https://hub.example.com` and open the printed URL. An organization Owner/Admin approves it; see [Manage Hosts](../hosts/connect-and-manage.md).
