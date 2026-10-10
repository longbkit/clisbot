# Managed Access: off or external?

[User guide](../README.md) · [Permission levels](../access/permissions.md) · [Q&A](../help/faq.md)

Managed Access is a **per-daemon** setting. It decides whether the daemon forces app connections through Hub permission checks.

Clisbot defaults to `external` from the first run, with no environment variable or flag. The daemon asks for a ticket only once it belongs to a Hub: before enrollment no Hub issues tickets, so you connect, sign in, and run `clisbot hub connect` as usual. After enrollment, the daemon closes sessions without a ticket, and from then on every connection needs one. Losing the Hub (revoked, or in the middle of disconnecting) keeps the ticket requirement; the daemon stops asking for tickets only after the Owner finishes disconnecting. Setting `daemon.managedAccess.mode` in `config.json` overrides the default.

|                                         | `off`                                               | `external`                                           |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| App connection                          | The ordinary trusted Clisbot flow                   | Needs an access ticket issued by the Hub             |
| Hub Connect                             | Controls whether the Hub hands out connection info  | Required to request a daemon connection ticket       |
| Daemon permissions after connecting     | The trusted session has the daemon's owner rights   | Follow the signed-in person, their Teams, and grants |
| Project limits in the Hub               | Not enforced by the daemon for this trusted session | The daemon checks the granted Projects and actions   |
| Upstream app without Hub ticket support | Can use the ordinary pairing flow                   | Cannot connect from outside through that flow        |

## Does off mean anyone can connect?

No. Knowing the daemon is not enough: you still need a valid connection path, pairing info, and whatever authentication the endpoint requires. But anyone with a valid pairing link/QR/connection info can use a compatible Clisbot app without signing in to the Hub.

With `off`, being a Member or having only Connect on the Hub **does not turn the daemon session into a Project-limited session**. Do not use this mode to split access among several people through the Hub.

## Turn external back on

You need this only if the Owner turned it off earlier.

1. Check that the Owner can connect with an app that supports Managed Access.
2. The Owner goes to Settings → **Hosts → [Host] → Managed access**.
3. Turn on **Require Hub access externally** and confirm.
4. The app shows **Turning on managed access…**: the Host closes every session without a Hub ticket, including your device's. The app requests a ticket from the Hub and reconnects on its own; you do nothing.
5. When you see **Managed access is on** and the **Managed access** badge, you are done. Also check with a Member granted only one Project.

If it has not reconnected after 30 seconds, the app shows an error: click **Reconnect** in **Settings → Hosts**, or check the daemon with the command shown on the card. Other tabs that already had the app open need a reload to get a ticket.

Mode changes apply immediately, **with no daemon restart**. Outside connections without a ticket are closed and must reconnect through the Hub. If you updated the source/binary, you still restart to load the new version; that is separate from changing the mode.

`external` covers localhost TCP, LAN, Tailscale, SSH tunnels, and relay. The OS local socket/pipe is a separate admin/recovery path; the Hub service connection has its own identity and permissions.

## CLI on a Host in external mode

The CLI follows the same path as the app: when the daemon asks for a ticket, the CLI uses your `clisbot hub login` session to request a ticket from the Hub the daemon is connected to, then reconnects. The ticket carries the rights of the account that approved the CLI sign-in, so the Host connection ticket alone gives no more than that person has. **The `hub login` credential also carries separate admin Public API permissions beyond requesting tickets**; read [scope and lifecycle](../../../hub.md#advanced-cli-login) before using it.

**This is CLI access to a Host that is already managed, not onboarding. To add a new Host, use only `hub connect <Hub-URL>`.** If you operate on the daemon machine itself, prefer the local socket/pipe where it fits, so you do not need to grant a CLI admin credential.

- Not signed in to that Hub: the CLI tells you to run `clisbot hub login` and try again.
- `clisbot hub connect` runs before the daemon belongs to a Hub, while the daemon does not ask for tickets yet. The daemon returns the enrollment result before closing that session.
- A Host enrolled with `--api-key` on a machine without a `clisbot hub login` session: the CLI cannot get a ticket (an API key does not represent a person). Use `clisbot hub login`, or the local socket/pipe.

## Turn external off

The Owner turns it off with the same switch. Back in `off`, the Hub's Member/Project limits no longer protect ordinary paired sessions. In this mode, revoking Access on the Hub does not replace revoking old trusted paths.

The app shows the switch only to the Owner. But **a Daemon Administrator has backend authority over daemon configuration**, including Managed Access; hiding the switch does not narrow that authority. See [Administrator scope](../access/daemon-administrator.md).
