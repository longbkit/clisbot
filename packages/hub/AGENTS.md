# Paseo Hub

Paseo Hub is the self-hosted open-source automation layer for existing Paseo (`getpaseo/paseo`) daemons.

This repository contains the open-source Hub codebase. Its Fly files contain only the minimal,
non-secret deployment wiring. Credentials, private workflow configuration, and operational
runbooks for privately operated instances must not live here.

The optional billing integration in `src/billing/` is inert without `STRIPE_SECRET_KEY`; instances without billing configuration expose no billing surface. See `docs/entitlements.md` and `docs/billing.md`.

The public docs (served at https://paseo.sh/docs/hub) live in the main Paseo repository under `public-docs/`, keep it up to date with any relevant externallly observable changes. Update via PR.

Repository verification, release, cross-repository compatibility, and documentation procedures
live in `MAINTAINERS.md`.

# Product Vision

Paseo Hub is an open, self-hosted coordination layer for the agents users already run.

It connects conversations and events from services such as GitHub, Slack, and Discord to configurable, multi-step agent workflows without taking ownership of the user's code, credentials, infrastructure, or security model.

Hub provides explicit building blocks: triggers, routing, environments, provider settings, credentials, context, outputs, and completion contracts. Workflow authors decide which building blocks each step receives and how they are composed. Hub must never silently broaden permissions, inject context, rewrite prompts, or impose a particular way of working.

Provider-specific capabilities remain provider-specific. Paseo validates and passes them through faithfully, allowing users to rely on each provider's native sandboxing, permission modes, models, and documented behavior rather than learning lossy Paseo abstractions.

The goal is to make sophisticated agent workflows easy to assemble while keeping authority visible, configuration portable, and control with the operator. Defaults should make common workflows straightforward, but every consequential behavior must remain explicit and optional.

# Project Status

This is a project in early-development, take advantage of not needing to implement back compat shims, do clear cuts and hard refactors.
