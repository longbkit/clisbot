---
title: Bots and Group chats
description: Create a durable Bot, work with several specialist Bots in one Chat, and share a Bot through its Project.
nav: Bots and Group chats
order: 14
category: Using Clisbot
---

# Bots and Group chats

A **Bot** is a named persona with instruction files, memory, a home Project/Workspace and default Agent controls on one Host. A **Chat** is your conversation with one or more Bots. Each Bot uses its own agent session and home; returning to the Chat resumes that session.

Use a Bot for recurring work such as maintaining notes or reviewing changes. Use a Group chat to bring a researcher and reviewer into the same discussion, each with its own role and provider/model. Choose those roles yourself; templates do not guarantee expertise or results.

## Create a Bot

Choose **New… → New bot**, or the **+** beside **Bots** in the sidebar.

1. Enter a **Name** and **Role**.
2. Choose the **Personal** or **Team** template for its initial instruction files.
3. Review **AI configuration**: Host, Model, Permissions and Thinking. The provider must be ready on that Host; see [Providers](/docs/supported-providers).
4. Create the Bot and select its sidebar row to chat.

Templates seed files on the Host; choosing Team does not grant anyone access. Existing files are kept unless you explicitly choose replacements. Changing a Bot's display name keeps its home path.

On a managed Host, creating a Bot needs Owner/Administrator authority or Full access on the Host, within its Project folder policy. Editing or archiving an existing Bot needs management access on its Project. If Bots are absent, ask the Host operator to check its version and Bots setting.

For an existing Project, **Create bot from project** in its options menu reuses that Project and gives the Bot its own Workspace. It starts without a template. If you select one, review the file preview and keep or replace each existing file deliberately.

## Put several Bots in one Chat

Choose **New… → New group chat**, or the **+** beside **Group chats**.

1. Choose a Host. All members must be Bots on that same Host.
2. Search **Members** by name or Role and add the Bots you can use.
3. Enter a **Group name** and choose **Who replies?**

By default, an unaddressed message starts a discussion with every Bot, one at a time. Mention a Bot with `@slug` to address it; `@everyone` addresses the room. **Mention-only** requires you to address a Bot or the room. Bots can pass when they have nothing to add; discussion stops at the configured round limit.

A one-Bot group is a separate topic thread with that Bot. In **Chat options → Group settings**, change the name, members and reply policy. The last member cannot be removed.

## Inspect the work

Open files and changes beside **Messages**. In a group, choose the source Bot before inspecting its files or Git state. **Open in cowork** opens that Bot's underlying session for detailed work; **Back to chat** returns to the conversation. These views use the same session.

Send `/new` alone, without attachments, to reset every Bot's session in this app Chat. Finish or stop running turns first. Home files and the transcript remain. Channel commands have their own [invocation and context rules](/docs/hub/channels/commands).

## Share a Bot or connect a channel

Share the Bot's **Project** with a Member or Team through [Managed access](/docs/hub/managed-access). They use the owner's Host with their own access ticket and allowed Agent configuration.

Your Chat record/transcript belongs to you. Its underlying sessions and the Bot's memory/files follow Project access and can be visible to others with that access. Keep shared Bot files suitable for everyone granted the Project.

For external messaging, an Organization Admin chooses **Connect to a channel…** from the Bot menu. Its Host must be enrolled in that Hub. Configure the Connection, Route audience and Replies in [Channels](/docs/hub/channels). Route settings copy the Bot's launch defaults when saved; later Bot edits do not update the Route automatically.

Group chats here are one user with same-Host Bots. Cross-Host groups, several-human app Chats and exporting an app group onto a channel are not part of this workflow.
