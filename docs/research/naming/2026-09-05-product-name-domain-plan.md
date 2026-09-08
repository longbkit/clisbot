# 2026-09-05 naming plan — product and domain replacement for clisbot

- Mode: plan
- Status: proposed
- Scope: external product identity and domain shortlist
- Baseline: working tree has unrelated modified evidence images; no product files changed
- User outcome: find a durable name for a multi-surface agent workspace/chat product
- Canonical sources: `docs/architecture/domain-language.md`, `docs/architecture/naming-conventions.md`, `README.md`, `docs/overview/README.md`
- Evidence: repository architecture reading; registrar pricing pages; exact-name web collision searches

## Executive answer

`clisbot` is now too implementation- and channel-specific. The product is better described as a persistent agent workspace that can be reached through desktop, mobile, chat, and developer surfaces. The strongest proposed direction is a coined, surface-neutral brand with an affordable `.com`, while optionally reserving `.ai` later.

This is a proposal, not a canonical rename decision. Domain availability and trademark clearance require a final registrar cart check and jurisdiction-specific legal search immediately before registration.

## Concept card

`<new brand>` is the public product identity owned by the clisbot project that lets people work with persistent agents across surfaces and sessions; it is not a bot, channel adapter, or coding CLI.

## Candidate matrix

| Candidate | Meaning | Collision screen | Domain direction | Verdict |
|---|---|---|---|---|
| **TaskCove** | A calm home for ongoing work | No exact product found in initial search; verify trademarks | `taskcove.com`, fallback `.app`/`.dev` | **Recommend** |
| **AgentHarbor** | Safe home for agents and work | No exact product found; generic terms increase trademark noise | `agentharbor.com`, fallback `.ai` | Strong backup |
| **WorkCove** | Friendly work base | No exact product found; broad term | `workcove.com`, fallback `.app` | Strong backup |
| **SessionCove** | Persistent continuity | Descriptive and architecture-adjacent; less consumer-friendly | `sessioncove.com`, `.dev` | Technical backup |
| **TaskHarbor** | Reliable place for tasks/agents | No exact product found; “harbor” is common | `taskharbor.com`, `.app` | Good backup |
| **AgentGrove** | Agents growing in one place | No exact product found; check education/nonprofit uses | `agentgrove.com`, `.ai` | Good backup |
| **ChatHarbor** | Chat as an access surface | Clear but overweights chat and may age poorly | `chatharbor.com`, `.app` | Conditional |
| **WorkNest** | Personal/team work home | Likely crowded descriptive space; check carefully | `worknest.com`, `.app` | Conditional |
| **FlowHarbor** | Workflows entering one system | No exact product found; “Flow” crowded | `flowharbor.com`, `.com` | Conditional |
| **AgentPort** | Gateway into agents | “Port” has infrastructure meanings | `agentport.com`, `.dev` | Conditional |

## Explicit rejects from evidence

- **AnyAgent**: semantically broad but likely crowded and difficult to protect.
- **AgentCove**: active hosted personal-agent product at [agentcove.ai](https://www.agentcove.ai/).
- **AgentLoom**: active products at [agent-loom.com](https://agent-loom.com/), [agentloom.net](https://agentloom.net/), and [agentloom.sh](https://agentloom.sh/).
- **Workloom**: active sales OS at [useworkloom.com](https://useworkloom.com/) and shift-management app at [workloomapp.com](https://workloomapp.com/).
- **TaskWeaver**: Microsoft open-source framework at [github.com/microsoft/TaskWeaver](https://github.com/microsoft/TaskWeaver).
- **MindDock**: multiple active products at [minddock.app](https://minddock.app/), [minddock.network](https://www.minddock.network/), and [mindock.ai](https://www.mindock.ai/).
- **OrbitDesk**: active AI helpdesk at [orbitdesk.leavenlabs.com](https://orbitdesk.leavenlabs.com/en/).
- **AgentNest**: active AI real-estate product at [agentnest.com](https://agentnest.com/).
- **TaskOrbit**: registered through 2027 according to [WHOIS](https://www.whois.com/whois/taskorbit.com).

## Domain and budget guidance

Porkbun currently lists `.com` from **$11.08/year**, `.app` and `.dev` from **$8.75/year**, `.tech` from **$6.99/year**, and `.ai` at **$82.70/year** with the same renewal price ([pricing](https://porkbun.com/products/domains), [.ai pricing](https://porkbun.com/tld/ai)). Namecheap lists `.com` at **$11.28 first year / $18.48 renewal**, `.dev` and `.app` at **$12.98 first year**, and `.ai` is not the economical default ([pricing](https://www.namecheap.com/domains/domain-name-search/)).

Therefore, the under-$100 strategy is:

1. Register the exact `.com` for the chosen brand, usually $10–20/year.
2. If budget allows, add one defensive `.app` or `.dev`; combined cost remains under $100.
3. Reserve `.ai` only when its $82.70 annual renewal is acceptable; do not treat it as the primary domain by default.

Search excerpts are evidence of registrar pricing and indexed collisions, not a guarantee that an unregistered domain remains available. Availability can change between search and checkout.

## Recommended decision path

1. Shortlist **TaskCove**, **AgentHarbor**, and **WorkCove**.
2. Check exact `.com`, `.app`, `.dev`, and `.ai` in one registrar cart, including renewal price and premium status.
3. Run USPTO/EUIPO/WIPO and target-market trademark searches for the finalists.
4. Check GitHub, npm, X, App Store, Google Play, and major search results for confusingly similar software.
5. Ratify one canonical product name before any repository-wide rename.

## Availability correction (2026-09-05)

A direct RDAP check against Verisign confirms the previously recommended `.com` domains are already registered: `taskcove.com`, `agentharbor.com`, `workcove.com`, `taskharbor.com`, `agentgrove.com`, and `sessioncove.com` all returned HTTP 200. Candidate `.com` domains returning HTTP 404 (available at RDAP check time) were: `tandemnest.com`, `tandemrelay.com`, `tandemroam.com`, `tandemhaven.com`, `tandemharbor.com`, `tandemport.com`, `useanyagent.com`, `anyagentdesk.com`, `anyagentbase.com`, `anyagentapp.com`, `anyagentchat.com`, `agenttandemapp.com`, `agenttandemdev.com`, and `agenttandemai.com`.

RDAP availability is a registry-level signal, not a completed registrar checkout; recheck at purchase time for premium pricing and final availability.
