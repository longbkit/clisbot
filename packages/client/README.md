# @clisbot/client

TypeScript SDK for building integrations on top of a Clisbot daemon.

```bash
npm install @clisbot/client
```

```ts
import { createClisbotClient } from "@clisbot/client";

const client = createClisbotClient({ url: "ws://127.0.0.1:6868/ws" });
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

The public API is the package root. Imports under `@clisbot/client/internal/*` are unsupported implementation details used by Clisbot's own packages.

Read the [SDK documentation](https://clisbot.com/docs/sdk) for agents, workspaces, terminals, provider discovery, events, recipes, and the API reference. Runnable TypeScript patterns also live in [`examples/`](./examples/README.md).

## Runtime

The client needs a WebSocket implementation. Modern browsers and Node.js 22 provide one globally.

Use a WebSocket URL ending in `/ws`, such as `ws://127.0.0.1:6868/ws`. Pass `password` when the daemon requires authentication.

The client advertises its supported protocol capabilities by default. Optional `capabilities`
overrides extend or override that declaration; browser hosting must be supplied by the caller.
Connecting alone does not subscribe to agent timelines or catalog events. See the
[event guide](https://clisbot.com/docs/sdk/events) for subscription lifetimes and timeline replacements.

## Stability

The high-level API exported from `@clisbot/client` is the supported SDK surface. The SDK and daemon remain protocol-compatible across versions, but newly added capabilities can require a newer daemon.
