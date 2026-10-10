# Projects, Workspaces, worktrees, and sessions

[User guide](../README.md) · [Permission levels](../access/permissions.md) · [Q&A](../help/faq.md)

A **Project** sets a root folder on a Host. A **Workspace** belongs to a Project. **New worktree** creates a separate Git working folder in that Project, so you can work on another branch without changing the working tree you are using.

## Create a Project

1. Connect to the right Host.
2. Choose **Add Project → Browse folders on Host**. There is one path field, starting at `~/` (the home of the user running the daemon). **Enter** opens the selected folder, or goes to the path you typed or pasted; **Backspace** at the end of the path goes up to the parent. The part after the last `/` filters by name. These are folders on the Host, even when you open the app from a phone or a browser on another machine.
3. Add the folder the path field points to with the **Add** button or **⌘/Ctrl+Enter**. Enter never adds a Project. The list shows at most 100 folders at a time, and only folders you may browse. **Search for directory** works the same way: Enter opens the result in the browser, and only **Add** or ⌘/Ctrl+Enter adds it.
4. No folder yet: go back to **New directory**, browse to choose the parent folder, and name it. The GitHub clone flow also has a browser for choosing the parent folder.

Older Hosts without Browse support ask you to update; **Search for directory**, typing a path, and the Finder picker on desktop work as before. You can **Close** at any time to go back to the app; adding a Project is not a required step after connecting a Host. To create a Bot, use **Create a Bot** on the connect page or **New bot** in the sidebar; a Bot creates its own workspace.

You need one of: Organization Owner, **Administrator** on the Host, or **Full access**. Full access on a Host can create Projects in the folders the Host's folder policy allows. Full access on a Project manages that Project but creates no Projects. Developer cannot create Projects, and no Project can be created inside another Project. The app checks permission as soon as you open Add Project; the daemon makes the final decision. With Full access on a Host, the new Project is usable after you reconnect to the Host. See [consequences of granting](../access/permissions.md#4-consequences-to-know-before-granting).

## Let someone create worktrees in one Project

An Owner/Admin grants that person or Team:

1. **Connect** on the Host that holds the Project.
2. **Developer** on that Project, with `workspace.create` and an allowed Agent configuration.
3. The daemon has **external** on and runs a version that supports the new permissions.

The user chooses the Project → **New workspace** → **Isolation: New worktree**, fills in what the form asks for, and creates it. The repo must use Git, and the branch/worktree conditions must be valid.

To create a Workspace without a separate worktree, choose **Isolation: Local**. The same `workspace.create` permission allows both; there is currently no separate "worktree only" or "local only" grant. The daemon manages the worktree target inside the granted Project; it does not let you add arbitrary Project paths.

This permission does not grant renaming, archiving, or deleting Projects or Workspaces. Those lifecycle actions still need the matching daemon admin permission.

## Create or continue a session

In an existing Workspace, create an Agent session and choose a configuration Access allows. Office worker and Developer can both create sessions when the grant has `agent.create`; interacting with a session needs `agent.interact`.

If you only want people to chat and work on files, the Owner/Administrator creates the Workspace first, then grants **Connect + Office worker**.

With several Projects, always check both the Host name and the Project. Permission to create Workspaces in Project A does not allow creating them in Project B.
