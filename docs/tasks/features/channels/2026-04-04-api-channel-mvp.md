# API Channel MVP

## Summary

Add the OpenAI-compatible API surface as another channel in the system.

## Status

Planned

## Why

API access is a surface for reaching the same persistent agents, not a separate product line.

Treating it as a channel keeps the system model honest.

## Scope

- choose the first API-compatible slice
- map API requests to agents and sessions
- define sync and streaming responses
- define auth and error behavior

## Non-Goals

- full parity with every OpenAI endpoint
- channel-specific Slack behavior

## Subtasks

- [ ] define the MVP compatibility slice
- [ ] define request-to-agent mapping
- [ ] define streaming response behavior
- [ ] define failure and timeout behavior
- [ ] add channel-ground-truth tests for the API surface

## Dependencies Or Blockers

- stable Agents lifecycle
- stable runner contract
- stable configuration model

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Channels Tests](../../../tests/features/channels/README.md)
