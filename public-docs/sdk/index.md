---
title: TypeScript SDK
description: Run Clisbot coding agents from a TypeScript program.
nav: Overview
order: 50
category: TypeScript SDK
---

# TypeScript SDK

`@clisbot/client` is a TypeScript library that drives a Clisbot daemon from your own program. You pick a provider and model, give an agent a prompt and a directory, and wait for the answer.

The daemon does the work: it launches the provider CLI, keeps the session alive, and streams it to the Clisbot app. Your program is a client. Agents you create show up in Clisbot next to the ones you started by hand, and they stay there after your program exits.

Use it to:

- turn an issue, alert, or webhook into a coding task;
- run several agents in parallel and collect their answers;
- hold a session open and send follow-up prompts;
- build a dashboard over your agents.

## Start a daemon

```bash
npx @clisbot/cli
```

It listens on `ws://127.0.0.1:6767/ws`.

## Run an agent

```ts
import { createClisbotClient } from "@clisbot/client";

const client = createClisbotClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

[Quickstart](/docs/sdk/quickstart) walks through this line by line and covers passwords and remote daemons.
