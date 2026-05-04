# Chat Surface Guidance And Route-Binding Clarity

## Why

Operator feedback showed that current Slack chat-surface guidance makes
`routes set-agent ...` look mandatory even when `routes add ...` already routes
the surface through whichever agent is currently assigned to that bot by
default.

That creates avoidable confusion at the exact moment when a user is trying to
onboard a new shared surface from chat.

## Scope

This task tracks small but high-signal guidance polish for chat surfaces and
operator docs where route setup appears.

## Item 1

Clarify the default-vs-override rule everywhere the first Slack shared-surface
setup is explained:

- `routes add --channel slack group:<id> --bot default` is enough to make the
  surface use whichever agent is currently assigned to that bot by default
- `routes set-agent ...` is only needed when that route should answer with a
  different agent than that current bot-level default

## Shipped In This Slice

- updated Slack and Telegram unrouted feedback so the route-add command is
  presented as the required first step and the agent-binding command is clearly
  optional
- updated runtime start/status guidance with the same default-vs-override rule
- updated Slack setup docs plus shared route guidance docs in English,
  Vietnamese, and Korean

## Follow-Up Space

Keep using this task if more chat-surface feedback polish items come in from
live operator use, especially when first-run or unrouted guidance still causes
unnecessary command confusion.
