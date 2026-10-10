# Invite Members, create Teams, and grant Access

[User guide](../README.md) · [Permission levels](permissions.md) · [Q&A](../help/faq.md)

Do this as an Owner/Admin who can manage the organization. The daemon must be in [external](../hosts/managed-access.md) mode for these permissions to apply to app connections.

## Create a Team and invite people

Open Settings → **People & access**. The page has four tabs: **Members** (everyone in the organization, with role, Teams, and linked chat accounts), **Teams**, **Invitations** (pending invitations), and **Access** (who can use what). The counters above each tab are filters: click **No Team** to see who is in no Team, **Expiring soon** to see invitations about to expire.

1. On the **Teams** tab, click **New Team** and name it after the working group, for example `Product` or `AI Team`.
2. Click **Invite people** (on every tab; opened from inside a Team, that Team is preselected). The **People** field takes existing Member names and new emails, separated by commas or new lines; `Name <email>` also works. Choose **Teams**; for new emails also choose a role: **Member** for someone who only needs to work on resources, **Admin** when they need to manage the organization.
3. Read the preview line, for example `2 Members join Ops, BMS now · 1 invitation will be sent`, then click the send button. Existing Members join the Team right away; new emails get an invitation and join those Teams when they sign in. Rejected emails (already a Member, no seats left) stay in the field so you can send again; the others were sent.
4. The invitee joins as shown in the table below. Then check on the **Members** tab that they are there and in the right Team.

| Invitee                                                  | Do they need to open the invitation link?                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No account, signs in with **Continue with Google**       | No. The first sign-in accepts the latest unexpired invitation sent to that email, with its role and Teams.                                               |
| No account, signs up with **Email me a sign-up link**    | No. Same as Google, because the link in the email proves the email. Works only for emails in a domain the Hub allows.                                    |
| No account, types an email and password                  | Yes. A typed password does not prove ownership of the email, so only the form opened from the invitation link can create an account with the invitation. |
| Already has a Hub account (even in another organization) | Yes. Invitations do not apply to existing accounts on their own; open the invitation link while signed in and click **Accept invitation**.               |

Invitations expire after **48 hours**; Resend restarts the 48 hours from the time you send. If the person signs in after expiry, the invitation is no longer accepted automatically: on a `domain_self_registration` Hub, an email in the domain joins the organization tied to that domain (if there is none, one is created and the person becomes Owner), without Teams; emails outside the domain are rejected. Expired invitations no longer show on the **Invitations** tab; invite that email again with **Invite people**.

To add an existing Member to a Team: open the Team → **Add people** and type a name or email, or click the button in the Teams column of the Member's row, or **Edit Teams** in the Teams section of the Member's details (**Add to a Team** when they have no Team, **Edit Teams** when they have one). The **Teams for …** dialog lets you add several Teams at once or untick a Team to take them out of it; then **Save**. The dialog lists only Teams you manage; other Teams they belong to are listed below it. When an organization Owner or Admin types the name of a Team that does not exist into the Teams field (here or in **Invite people**), they see **Create Team "…"**: choosing it creates the Team and ticks it. Team Admins can pick only existing Teams. A Team's **Members** tab lists who is in the Team; click **Remove** to take someone out. The **Admin** role in a Team (Team Admin) lets that person add, remove, and invite people to this Team, and make others Team Admin. A Team Admin who opens People sees the Teams they belong to or manage; in Teams they manage they get **Add people**, **Remove**, the Team role field, and a read-only **Access** tab (editing the Team's permissions stays with the organization Owner/Admin). When a Team Admin invites, the Teams field has only the Teams they manage and the role is always **Member**; their **Invitations** tab lists only those invitations, and they can resend or cancel them.

Change the organization role on the Member's row (Member / Admin; Owner shows only to Owners and needs confirmation). The last Owner cannot demote themselves; an Admin cannot change an Owner's role. Click a Member's name to open the detail page: **Details** (role, status), **Teams** (only the Teams that person is in; **Add to Team…** to add, the row's **…** menu to remove), **Access**, and **Chat accounts**. **Remove Member** is in the **…** menu next to the name; it is locked when the Hub would refuse, with the reason under **Status** (an Admin cannot remove an Owner, nobody can remove the last Owner). The Team page has **Members** and **Access** tabs; renaming and deleting a Team are in the **…** menu next to the Team name. On the **Invitations** tab, **Resend** sends again (the invitation gets a fresh 48 hours), and **Cancel invitation** is in the row's menu.

A new Member cannot use any resource until granted. If they join a Team that has Access, they get the Team's permissions.

## Grant work on one fixed Project

For example, to let AI Team work on Project `longluongbrain` on Host `sandbox`:

1. Open **Access**. In **Team or Member**, search for and choose `AI Team` in the Teams group.
2. Choose the Host resource `sandbox`, level **Connect**, and confirm the grant.
3. Choose Project `longluongbrain` on that same Host.
4. Choose **Office worker** or **Developer**; choose the allowed Agent configuration, approval rights, and Fast mode as needed; save.
5. Sign in as a Member of the Team, check that only the allowed Project shows, and try creating a session.

With Office worker, the Owner/Administrator prepares the Workspaces in advance. With Developer, the Member can create Workspaces/worktrees in that Project. You do not need Daemon Administrator for this.

Each **Agent configuration** row is one provider, with **several Models** and **several Thinking** levels at once: open the field and tick each item; the list stays open while you choose. **All available** is the first item and also covers models added later. A finished row collapses to a one-line summary; click `▸` to edit it. For different Thinking per model, add a second row for the same provider. Changing the Models list resets Thinking to all.

The search field suggests as you type, grouped by Teams/Members or resource type. Search Members by email to avoid duplicate names; when choosing a Project, check the Host shown with it. The list caps the results shown per group, so type something more specific if you do not see what you need.

## Grant every Project on a Host

Use this when a Team needs to work on all Projects on a Host but stay limited to certain providers/models:

1. Choose the Team/Member, then choose the **Host** itself as the resource (Hosts group).
2. Choose **Office worker**, **Developer**, or **Full access** if they need to add new Projects. Do not choose Administrator if you want to keep provider/model limits.
3. Choose the Agent configuration; save.

This grant applies to every existing Project and every Project added later, including Projects the daemon is temporarily not reporting. You do not need a separate Connect grant. Each person has one assignment per Host, so saving a new level **replaces** the old one on that Host: changing Administrator to Developer removes Administrator.

## Grant several Projects at once

Choose one Project as the resource, then choose more under **Also apply to**. Only Projects on the **same Host** show; each Project is saved as its own assignment with the same choices, in one save.

- This field has no "all" option. For every Project, including Projects added later, grant on the Host.
- If the person already has a grant on any Project in the list, the old grant is **replaced**, including its Agent configuration. The confirmation lists the replaced Projects; read it before you agree.

## Can share: let others grant on

On a Host or Project, under the level field, there is a **Can share** switch: the grantee can add, edit, or remove people on that same Host/Project, **up to their own level**. There is one rule: you can grant only what you hold.

| Level         | Can share                        |
| ------------- | -------------------------------- |
| Connect       | None                             |
| Office worker | Off by default, can be turned on |
| Developer     | Off by default, can be turned on |
| Full access   | On by default, can be turned off |
| Administrator | Always on                        |

- Someone with Can share at Office worker can grant only Office worker; on a Host they can grant every Project on that Host. In **Access** they see only resources they can share; levels above their own do not show in the picker (an "Above your own level" line shows instead), and higher grants show **Locked** and cannot be edited or removed.
- For a Project, the grantee still needs **Connect** on the Host. Even if you cannot share that Host, the form grants Connect (and only Connect) on the Host along with it; if the grantee can already reach the Host, the Hub keeps their Host grant as it is.
- Each grant shows **by \<name>** (who granted it; **by Hub** when the Hub wrote it) and **Can share** if set, on the Access page and in the Access section of a person or Team, so you can revoke quickly.
- For Teams, Connections, and Automations, the matching level is called **Admin**: it manages that resource and who gets in (a Connection Admin can also appoint other Admins for that Route) (a Team Admin manages only members and does not change the Team's grants). Organization Owners/Admins are not limited by this rule.

**Warning when choosing Administrator.** Choosing this level opens a confirmation before the form takes it: that person controls the daemon (restart, install plugins, use every Model, see every Project). Every organization Admin is notified with the granter's name and a link to that grant on the Access page; Owners/Admins review it under **Access events** at the bottom of the Access page and click **Revoke** to revoke it at once. This section also lists Automations the Hub paused because their author lost access.

## Grant to Guest

**Guest** is everyone who sends messages on a Channel without a linked Member account, not one person. Granting Developer to Guest on a Host means every such person can approve destructive commands and run Agents without approval prompts on every Project of that Host. The confirmation repeats this scope.

## Grant to an individual

Same steps, but choose a person in the **Members** group. Prefer Team grants for shared work; use individual grants for exceptions, for example one person getting a second Project.

Grants **add up**: direct grants plus grants from every Team, and grants on the Host plus grants on each Project. A smaller grant never restricts another: a Project grant that allows only Claude does **not** remove Codex granted on the Host. To limit a Project, grant less on the Host.

## Edit or revoke

In **Access**, find the assignment, then **Edit** or **Remove**. Identical assignments that differ only by Project are grouped into one row; click `▸` to edit or remove each one. Viewing **Resource · Who has access** on a Project also shows people who have access through the Host. To revoke fully, check the person's individual grants and all their Teams. Removing someone from a Team removes the access they got through that Team; other sources remain.

After editing, check with that Member's own account and a refreshed connection. Do not use an Owner account to prove access is limited, because the Owner has implicit rights across the organization.
