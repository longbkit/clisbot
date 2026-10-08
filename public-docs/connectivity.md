---
title: Connectivity
description: Connect a Clisbot client to your daemon through SSH, the relay, or Tailscale.
nav: Connectivity
order: 4
category: Getting started
---

# Connectivity

Your Clisbot app connects to the daemon running on your computer or server. Clisbot Desktop and the CLI can tunnel through SSH. A phone or browser pairs with the daemon: open **Pair a device** on the computer, then scan the QR code or paste the pairing link. The link carries every route the daemon offers, and the app tries Tailscale first and falls back to the relay.

This is client-to-daemon transport. If you are looking for the service that starts agents from GitHub, Slack, and Discord events, that is [Hub](/docs/hub).

- [SSH](#ssh)
- [Clisbot relay](#clisbot-relay)
- [Tailscale](#tailscale)

## SSH

SSH transport connects to an existing daemon through your local OpenSSH client. It does not install, start, or configure Clisbot on the remote host.

Before connecting:

1. Start the Clisbot daemon on the remote host.
2. Confirm `ssh user@host` works with a key or SSH agent. Clisbot uses non-interactive SSH and follows your OpenSSH config.

The CLI accepts an SSH URI as its host:

```bash
clisbot --host ssh://user@host ls -a
```

The daemon is expected at `127.0.0.1:6868` on the remote host. The port in the SSH URL is the SSH server port:

```bash
clisbot --host ssh://user@host:2222 ls -a
```

Set a different remote daemon port with `daemonPort`:

```bash
clisbot --host 'ssh://user@host?daemonPort=7777' ls -a
```

Put `--host` before the command. `clisbot daemon status` observes the default local home; use `clisbot --host ssh://user@host daemon status` to query a remote daemon. `clisbot --host ssh://user@host run --cwd /path/on/remote ...` requires a working directory that exists on the remote host.

In Clisbot Desktop, open **Settings → Add host → Remote SSH** and enter the same `ssh://` destination, including `:port` or `?daemonPort=` when those differ from the defaults.

If the remote daemon has a password, enter it in **Daemon password**; it is stored with the host and sent on every connection, the same as a direct connection's password. SSH login itself stays key-based — Clisbot never prompts for an SSH password.

## Clisbot relay

The relay works without Tailscale, port forwarding, or network configuration. Traffic is end-to-end encrypted.

Relay is disabled until you enable it.

### Enable relay from Clisbot Desktop

1. Open **Settings → your host → Pair a device**.
2. Select **Enable relay**.
3. Scan the QR code with Clisbot on your phone, or copy the pairing link and paste it into the phone app.

### Enable relay from the CLI

Run:

```bash
clisbot daemon pair
```

Confirm when prompted. Clisbot prints a QR code and pairing link. Scan the QR code with Clisbot on your phone, or choose **Paste pairing link** in the phone app.

## Tailscale

Tailscale is the fastest route: your phone reaches the daemon directly over your tailnet. Install [Tailscale](https://tailscale.com/download) on the daemon machine and on your phone, and sign in to the same tailnet on both.

### Set up Tailscale from Clisbot Desktop

1. Open **Settings → your host → Pair a device**.
2. Under **Ways to connect**, select **Set up** on the **Tailscale** row. Clisbot puts the daemon behind `tailscale serve` and shows its `*.ts.net` address when the row reads **On**.
3. Scan the QR code with Clisbot on your phone, or choose **Paste pairing link** in the phone app. The QR code lists the routes it carries, for example **Contains: Tailscale · Relay**.

The Tailscale row shows one action for each state:

| State         | What to do                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Not installed | Select **Get Tailscale**, install it on the daemon machine, then return.                          |
| Signed out    | Sign in to Tailscale on the daemon machine, then select **Retry**.                                |
| Not running   | Start Tailscale on the daemon machine, then select **Retry**.                                     |
| HTTPS off     | Select **Enable on tailnet**. A tailnet admin turns on HTTPS certificates. Then select **Retry**. |

Setting up Tailscale does not turn the relay on or off.

### Set up Tailscale from the CLI

Run on the daemon machine:

```bash
clisbot daemon pair --transport tailscale
```

Clisbot maps the daemon through Tailscale Serve and prints a QR code and pairing link with the Tailscale route. Add `--https-port <port>` to use another HTTPS port.

### Connect without pairing

To connect over Tailscale without a pairing link, make the daemon listen on its Tailscale IP and add it by address.

1. Find the daemon machine's Tailscale IP:

   ```bash
   tailscale ip -4
   ```

   The example below uses `100.101.102.103`.

2. Open `~/.clisbot/config.json` and set `daemon.listen` to that IP:

   ```json
   {
     "$schema": "https://clisbot.com/schemas/clisbot.config.v1.json",
     "version": 1,
     "daemon": {
       "listen": "100.101.102.103:6868"
     }
   }
   ```

   Keep the other settings in the file. If it has a `daemon` object, add `listen` inside it. To restrict access with a password, see [Password authentication](/docs/configuration#password-authentication).

3. Restart the daemon with `clisbot daemon restart`, or **Settings → your host → Overview → Restart daemon** when Clisbot Desktop manages it.
4. On the phone, connect Tailscale, open Clisbot and go to **Settings → Add host → Direct connection**. Enter the Tailscale IP in **Host** and `6868` in **Port**, leave **Use SSL** off and select **Connect**.

If the host was already paired through the relay, Clisbot adds the direct connection to the same host.

## Troubleshooting

- **SSH authentication failed:** Run `ssh user@host` in a terminal and fix the key, agent, host key, or `~/.ssh/config` entry there. Clisbot does not prompt for SSH passwords.
- **SSH connects but Clisbot is refused:** Run `clisbot daemon status` on the remote host. SSH transport does not start the daemon.
- **SSH connects but Clisbot reports "Password required":** The remote daemon is password-protected. Remove the SSH connection from the host and add it again, this time entering the daemon password in **Daemon password**.
- **Connection timed out:** Check that Tailscale is connected on both devices and that you used the daemon machine's Tailscale IP.
- **Connection refused:** Run `clisbot daemon status` and confirm the daemon is running on the configured IP and port.
- **Config change has no effect:** Run `clisbot reload`. `daemon.listen` is a startup setting, so restart when the command reports it.
