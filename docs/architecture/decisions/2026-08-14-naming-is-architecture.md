---
title: Naming Is Architecture
status: accepted
date: 2026-08-14
---

# Context

Naming rules existed partly in `AGENTS.md`, while canonical product vocabulary
lived in `domain-language.md`. The repository had no single guide connecting
domain terms to code, configuration, persistence, CLI, and file names.

# Problem

Scattered rules allow one concept to acquire several names, hide ownership
boundaries, and make otherwise correct code harder to understand and extend.

# Considered Options

1. Keep naming guidance only in `AGENTS.md`.
2. Put all representation rules into `domain-language.md`.
3. Keep domain vocabulary in `domain-language.md` and add a linked canonical
   naming-conventions guide.

# Decision

Choose option 3. Treat naming as an architecture concern:

- `domain-language.md` owns canonical concepts and boundary meanings
- `naming-conventions.md` owns their repository representations
- `AGENTS.md` requires consulting both and using the `naming-expert` skill when
  choosing or changing names

# Rationale

Separating vocabulary from representation keeps each document focused while
making both mandatory implementation inputs. It also gives naming-rule changes
a canonical home instead of expanding agent instructions indefinitely.

# Consequences

- New domain terms must update `domain-language.md` before they spread.
- New repository-wide naming rules must update `naming-conventions.md`.
- Code reviews can evaluate naming against explicit architecture rather than
  personal preference.
- Changes to these rules require the same care as other architecture changes.

# Supersession

This decision does not supersede an earlier decision and is not currently
superseded.
