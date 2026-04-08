# Human Requirements

## Status

Raw human input. Preserve as given.

## Rule

Do not modify this file unless a human explicitly asks for this file to be updated.

Do not normalize, summarize, restructure, or clean up the content here on your own.

## Notes

Add raw human requirements, pasted messages, rough constraints, and direct source notes below this line.

---

2026-04-04 human brief:

AI CLI coding tools like Codex or Claude are top agentic AI tools / AI agents on the market. Plus, they have subscription models with API costs that are much cheaper, up to 20x cheaper when using GPT Pro or Claude Max subscriptions (the weekly limit is around 5x the subscription price, which is $200/month, and this weekly limit resets every week, so basically users have 4 times per month, so 4*5 = 20x). What if we can expose these tools to communication channels easily like what OpenClaw did, such as Telegram, Slack, Discord, ... and also via API (completion API compatible)? Codex and Claude both have agent SDKs, but for Claude it is unclear whether its agent SDK is allowed to be used with a subscription or not, while Codex is still good until now. So those SDKs are a good option, but do not depend on them. This project idea is based on tmux scalability and stability: each tmux session can run one AI coding CLI as an agent. These agents can talk back just by giving them a CLI tool to talk through different channels, or they can also stream full tmux content back if that is what the user wants.

What is interesting is that this should also be an experimental project about performance. We want to compare performance between TypeScript with Bun, Go, and Rust, and see how performance and stability can differ. So this project should maybe be organized as a monorepo, with different implementations. For the MVP, I want to focus on Slack WebSocket + tmux + TypeScript + Bun first. Similar to OpenClaw, each Slack channel or bot can be mapped to an agent, meaning a tmux session. So when a user tags the Slack bot, send the direct message to the corresponding tmux session (maybe mapped by tmux session name). Each tmux session should live inside a workspace folder, similar to OpenClaw, which could be `~/.muxbot/workspace/` as a default workspace.

For the MVP, I want you to support `~/.muxbot/muxbot.json` with a similar structure to an OpenClaw-style config template, so that I can start sending messages from Slack when tagging the bot, and the bot in the tmux CLI receives the prompt, executes it, and streams the result back on the go.

Invoke high-skill teams to work on this autonomously for high output quality, and make sure it is well tested with the Slack bot info in `.env`.

You can use the `slack-cli` skill to test yourself whether the message is sent correctly and stably or not.

Autonomous, long session, prefer high quality, completeness, no workaround mode.
