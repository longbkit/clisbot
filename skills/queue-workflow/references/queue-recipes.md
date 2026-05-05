# Queue Recipes

These are the standard follow-up prompts for queue-first implementation work.

Use the smallest batch that still protects quality.

Read this file when you need:

- a queue plan for small, medium, or large work
- prompt-writing rules for queued follow-up passes
- real `clisbot queues` command templates

See also:

- [../SKILL.md](../SKILL.md) for workflow and queue-depth selection
- [content-architecture.md](content-architecture.md) for context-saving structure and anti-ambiguity rules when revising the skill itself

This file assumes you already chose `small`, `medium`, or `large` in [../SKILL.md](../SKILL.md).
It is the operational reference, not the owner of queue-depth selection.

## Prompt Rules

- Tailor the prompt to the current task when the generic wording would be vague.
- Each queued prompt should emphasize one review lens.
- Prefer prompts that mention the concrete artifact under review: feature, repo area, skill, docs surface, or release surface.
- Avoid prompts that are so narrow they miss nearby issues.
- Avoid prompts that are so broad they become motivational noise.

## Pass Lenses

Use these lenses to build or edit a queue:

1. continue
2. breadth review
3. simplify and naming/glossary review
4. DRY/KISS and grouping review
5. code review and fix
6. docs and release/help review

## Small Task

1. `continue`
2. `code review & fix`
3. `continue`

## Medium Task

1. `continue`
2. `any remaining gaps?`
3. `continue; do a breadth review to catch nearby issues and reduce repeated small fixes`
4. `simplify. Follow repo AGENTS.md rules and guidance, especially naming conventions: use consistent prefixes/suffixes where they clarify role, keep concepts/terms/glossary aligned, and do not invent new terms unless truly necessary`
5. `check DRY and KISS strictly. Group similarly named files/functions and closely duplicated logic to see what can be consolidated. If some items should stay separate, report a clear merge-vs-keep list to the user`
6. `code review & fix`
7. `review docs, features, backlog status, release notes, and updates/migrations. Keep docs short, very easy for end users to follow, and free of unstated assumptions`
8. `continue`

## Large Task

Queue the same medium-task sequence, but do it in two waves:

Wave 1:

1. `continue`
2. `any remaining gaps?`
3. `continue; do a breadth review to catch nearby issues and reduce repeated small fixes`
4. `simplify. Follow repo AGENTS.md rules and guidance, especially naming conventions: use consistent prefixes/suffixes where they clarify role, keep concepts/terms/glossary aligned, and do not invent new terms unless truly necessary`

Wave 2:

1. `check DRY and KISS strictly. Group similarly named files/functions and closely duplicated logic to see what can be consolidated. If some items should stay separate, report a clear merge-vs-keep list to the user`
2. `continue`
3. `code review & fix`
4. `continue`
5. `review docs, features, backlog status, release notes, and updates/migrations. Keep docs short, very easy for end users to follow, and free of unstated assumptions`
6. `continue`

Two-wave batching is safer when the first implementation pass may still reshape the code significantly.

## Tailoring Rule

Do not blindly reuse these prompts word-for-word if the task deserves more specificity.

Good:

- `code review & fix skill queue-workflow; review clarity, ambiguity, progressive disclosure, and command truthfulness`
- `continue; do a breadth review of the session-id capture flow for topic-runner reuse`

Weak:

- `continue working harder`
- `check everything again`

## Command Templates

Telegram topic:

```bash
clisbot queues create --channel telegram --target group:<chat_id> --topic-id <topic_id> --sender telegram:<user_id> "<prompt>"
```

Slack thread:

```bash
clisbot queues create --channel slack --target group:<channel_id> --thread-id <thread_ts> --sender slack:<user_id> "<prompt>"
```

For Slack queue commands, use `group:<channel_id>` as the simple default. Make sure to include `--thread-id` when the current Slack message is in a thread, and `--topic-id` when the current Telegram message is in a topic.

Inspect the queue:

```bash
clisbot queues status --channel telegram --target group:<chat_id> --topic-id <topic_id>
clisbot queues list --channel telegram --target group:<chat_id> --topic-id <topic_id>
clisbot queues status --channel slack --target group:<channel_id> --thread-id <thread_ts>
clisbot queues list --channel slack --target group:<channel_id> --thread-id <thread_ts>
```

Clear only pending items:

```bash
clisbot queues clear --channel telegram --target group:<chat_id> --topic-id <topic_id>
clisbot queues clear --channel slack --target group:<channel_id> --thread-id <thread_ts>
```

Command notes:

- `create` requires explicit `--channel`, `--target`, and `--sender`
- `--current` is not supported
- `list` shows pending items only
- `status` shows pending and running items
- `clear` removes pending items only and does not interrupt a running prompt

## Batching Rule

- Use the queue-depth meanings from [../SKILL.md](../SKILL.md).
- If the queue cap or task uncertainty is high, queue the first wave only, then add the second wave after the code settles.
