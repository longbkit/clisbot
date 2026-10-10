# Organization name

[User guide](../README.md) · [Setup and sign-in](setup-and-sign-in.md) · [Profile](profile.md)

Everything you do on the Hub (Hosts, Channels, Automations, invitations, permissions) belongs to the **selected organization**. The organization name shows in three places:

- **Top of the sidebar**, above the navigation items. Click it to open **Settings → Account**.
- **Top of the Account screen**, with the **Organization ID** (slug) and your role.
- **The Approve CLI login screen**, with the Organization ID, the approving account and what the CLI may do in the organization. Check it is the right organization before you click **Approve for \<organization name\>**.

## Rename

Only the **Owner** can rename.

1. Go to **Settings → Account**.
2. On the organization card at the top of the screen, click **Rename**.
3. Enter the new name (1–100 characters) and click **Save name**.

The new name shows for every member. Renaming does not affect permissions, connected Hosts or CLI sign-ins: the CLI and Hosts attach to the organization by a fixed identifier (slug), and the slug does not follow the name.

Admins and Members do not see the **Rename** button. If you call the API directly, the Hub returns `organization_owner_required`.

Organizations created automatically from a domain (for example `acme.com`) can be renamed too. People who later register with an email on that domain still join this organization.
