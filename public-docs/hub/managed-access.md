---
title: Managed access and Teams
description: Share Hosts, Projects and Bots with Members and Teams, choose Agent limits, and review effective access.
nav: Managed access
order: 65
category: Hub
---

# Managed access and Teams

Use Managed access when several people work on your Hosts. Hub grants access to Members or named **Teams**; the daemon checks their Hub access tickets. A Team can hold one grant for everyone in that working group, including people added later.

## Check the Host first

Enroll the machine with [Hub](/docs/hub/daemons), then open **Settings → Hosts → [Host] → Managed access**. Ordinary daemons default to `external`: ticket checks begin after Hub enrollment. `hub start --personal` creates a new personal daemon with this setting off and paired-device access without account login. Existing installations keep their policy. For team sharing, the Owner enables **Require Hub access externally**. The app reconnects with a ticket; other open tabs can need a reload. Changing this setting requires no daemon restart.

In `off` mode, ordinary paired sessions have owner rights; Hub Project grants do not restrict them. Managed access covers external TCP connections, including localhost, LAN, Tailscale, SSH tunnels and relay. The machine's local socket/pipe remains an admin/recovery path.

## Invite a working group

Open your Hub's **Settings → People & access**.

1. In **Teams**, choose **New Team** and name the working group.
2. Choose **Invite people**, enter Member names or email addresses, select the Team, and review the preview before sending.
3. New people accept the invitation and sign in to the same Hub. Check their membership in **Members**.

A new Member gets no resource access until granted, directly or through a Team. Organization Admins manage configuration and people but still need Host/Project grants to use agents. Organization Owners have full access.

## Grant one Project or a whole Host

In **Access**, select the Team or Member, then **Grant access…**. Choose the resource, level and allowed Agent configurations; review the confirmation and save.

| Resource | Scope                                                        |
| -------- | ------------------------------------------------------------ |
| Host     | Every current and future Project on that Host                |
| Project  | That Project and its Workspaces/worktrees                    |
| Bot      | Grant on its Project; shown under Bots in the Project picker |

For one Project, the person also needs **Connect** on its Host. The Project-sharing form adds Connect when needed. A Host work level already includes it. **Also apply to** grants several Projects on that same Host; it does not cover future Projects.

| Level         | Choose it for                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| Connect       | Reaching a Host; no Project work by itself                                                  |
| Office worker | Using agents in prepared Workspaces; no shell or command approvals                          |
| Developer     | Creating Workspaces/worktrees and approving tools in granted Projects; shell off by default |
| Full access   | Developer plus managing Projects/Workspaces; shell on by default, switchable                |
| Administrator | Operating the entire Host, with every Project and provider/model                            |

Only **Full access on a Host**, Owner or Administrator can create new Projects. Full access follows the Host's allowed Project folders. Full access on one Project cannot create another Project. Developer needs the current `workspace.create` grant to create Workspaces; update older daemons and re-save old assignments with that level if needed.

## Agent limits and sharing

Choose providers, models and Thinking in **Allowed Agent configurations**. **All available** includes future models. Fast mode is a separate opt-in. **Terminal (shell)** and allowed **Terminal profiles** are separate choices. **Can share** lets the person grant on that resource, up to their own authority.

Grants add together: direct grants, Team grants, Host grants and Project grants. A narrower Project grant cannot remove a model granted on the Host. Review each source before reducing or revoking access.

Provider/model limits apply to Clisbot-managed Project-mode sessions. Owners and Host Administrators bypass them. Shells, command approvals and Terminal-profile CLI features can reach beyond those limits using the daemon's OS account. These controls provide neither OS isolation nor a spending budget; use separate OS users/containers and credentials when required. See [Security](/docs/hub/security).

After saving, reconnect with the Member's account and verify the visible Projects and allowed models. An Owner account cannot prove those limits. To revoke fully, check both direct grants and every Team.

## Link your chat account

To use your Member grants from a channel, open **Account → Chat accounts** in the app while signed in to that Hub. Choose **Where you chat**, generate a code, then send the displayed `/link <code>` command from your own chat account to the indicated bot. Use the code once before its displayed expiry; verify the linked account appears in the app. In a group, address the bot using that channel's [command form](/docs/hub/channels/commands#channel-invocation).

Linking identifies you; it grants no access. Unlinked senders use **Guest**, which has no default grants. Linked Members use their own and Team grants, without Guest grants. Route audience rules still decide whether your conversation is admitted.
