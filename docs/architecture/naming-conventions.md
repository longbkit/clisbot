# Naming Conventions

## Status

Stable architecture reference

## Purpose

Make names predictable across code, configuration, persistence, CLI surfaces,
and documentation. Naming is part of the architecture contract: a reader
should be able to infer a concept's owner, scope, and representation without
having to inspect its implementation.

Consult [`domain-language.md`](domain-language.md) before this guide. That
document owns canonical product and architecture vocabulary; this guide owns
how those concepts are represented in repository artifacts.

## Choosing A Name

1. Reuse the canonical term from `domain-language.md` when one exists.
2. Search the repository for an established name and representation before
   introducing a new one.
3. Use one name for one concept and one concept for one name.
4. Include a qualifier only when it communicates a real boundary, lifecycle,
   or representation distinction.
5. Avoid vague containers such as `manager`, `helper`, `util`, `data`, or
   `common` when a concrete owner or responsibility can be named.
6. When a new domain term is necessary, add it to `domain-language.md` before
   spreading it through code or docs.
7. When a repository-wide representation rule changes, update this document.
8. Use the `naming-expert` skill when choosing or changing names.

## Repository Conventions

- TypeScript files and directories use `kebab-case`.
- Types, classes, and exported type-level contracts use `PascalCase`.
- Functions, variables, object fields, and JSON fields use `camelCase`.
- Module-level constants that are immutable configuration or protocol values
  use `SCREAMING_SNAKE_CASE`.
- Environment variables use `SCREAMING_SNAKE_CASE` with the `CLISBOT_` prefix
  for clisbot-owned values.
- Public CLI commands and flags use `kebab-case`. Internal option fields remain
  `camelCase`; keep the CLI-to-code mapping explicit.
- Canonical ids use the established `Id` suffix, such as `sessionId`,
  `providerId`, and `surfaceId`. Do not introduce parallel `ID`, `IDValue`, or
  `Identifier` spellings for the same concept.
- Persisted representations follow the owning store's established convention.
  Map names explicitly at the boundary instead of leaking storage-specific
  names into domain models.
- Tests name the behavior and observable outcome, not the implementation step.

## Boundary And Lifecycle Qualifiers

Use qualifiers only when the distinction is durable and defined. Existing
examples include:

- `providerId` versus canonical `principal`
- `sessionKey` versus native-tool `sessionId`
- `storedSessionId` versus the current live `sessionId`
- `runtime projection` versus live run truth
- `surfaceId` versus provider-specific reply or route targets

Do not add `raw`, `normalized`, `resolved`, `stored`, `live`, `runtime`, or
`canonical` merely to make a name sound precise. The code or architecture must
define the transformation or lifecycle boundary that makes the qualifier true.

## Shared Abstractions

Name abstractions after the stable capability or contract they own, not the
first consumer that happened to need them. Create or extend a shared
abstraction when the product direction identifies a definite future consumer
and the shared contract is already clear. Do not generalize around speculative
consumers or hide materially different behavior behind one generic name.

Provider-specific names stay inside provider-owned adapters unless they are
mapped to a canonical shared concept. Shared layers must use canonical names
and make provider-to-domain mappings explicit.
