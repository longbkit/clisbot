# Hermes Agent self-evolution research

Date: 2026-05-16

Local clones:

- `/home/node/projects/hermes-agent`
  - Repo: https://github.com/NousResearch/hermes-agent
  - Commit inspected: `c5dc9700ebc8b890e349c0cc3e978d133395909b`
  - Last commit: `fix(windows): silence tirith-unavailable banner + skip install/spawn attempts on unsupported platforms (#26718)`, 2026-05-15
- `/home/node/projects/hermes-agent-self-evolution`
  - Repo: https://github.com/NousResearch/hermes-agent-self-evolution
  - Commit inspected: `4693c8f0eed21e39f065c6f38d98d2a403a04095`
  - Last commit: `feat: add Hermes session importer + fix short skill name matching (#4)`, 2026-03-29

HTML visual:

- [`docs/artifacts/2026-05-16-hermes-self-evolution-architecture.html`](../../artifacts/2026-05-16-hermes-self-evolution-architecture.html)

## Executive take

The hype phrase "agent that evolves itself" maps to two different mechanisms:

1. **Runtime self-improvement in `hermes-agent`**: the live agent maintains memory, creates/patches reusable skills, searches prior sessions, and runs background review forks that save durable learnings after enough user turns or tool iterations.
2. **Offline evolutionary optimization in `hermes-agent-self-evolution`**: a separate optimization repo reads Hermes artifacts, builds eval datasets, uses DSPy/GEPA to mutate text artifacts, scores candidates, applies constraints, and is meant to open PRs back to `hermes-agent`.

This is not continuous neural weight training. The current technical center is **text and code artifact evolution under eval gates**: skills, tool descriptions, prompt sections, and eventually code files. Changes are intended to land through reviewable diffs, not by hot-swapping the running agent's brain mid-conversation.

## What is implemented vs planned

### Implemented in `hermes-agent`

- **Skills as procedural memory**: skills live under `~/.hermes/skills/` and can be created, patched, edited, deleted, or extended with support files through the `skill_manage` tool.
- **Prompt guidance to save learnings**: `agent/prompt_builder.py` injects guidance telling the agent to save durable facts in memory and non-trivial workflows as skills.
- **Background review loop**: `run_agent.py` increments memory and skill review counters, then spawns a quiet background `AIAgent` fork. The fork is whitelisted to memory/skill tools and writes to shared stores.
- **Skill upkeep**: the curator tracks agent-created skills, stale states, archive/restore, and LLM-driven review so self-created skills do not pollute the catalog forever.
- **Cross-session recall**: `hermes_state.py` stores sessions in SQLite with FTS5 search; `session_search` summarizes past conversations when needed.
- **Trajectory capture**: `agent/trajectory.py` and `batch_runner.py` produce ShareGPT-style JSONL traces for eval, debugging, and training data.

### Implemented in `hermes-agent-self-evolution`

- **Phase 1 skeleton for skill evolution**:
  - `evolution/skills/skill_module.py` wraps a `SKILL.md` body as a DSPy module.
  - `evolution/core/dataset_builder.py` can generate synthetic eval examples and load golden JSONL datasets.
  - `evolution/core/external_importers.py` mines Claude Code, Copilot, and Hermes session history into eval examples, with secret filtering.
  - `evolution/core/fitness.py` defines LLM-as-judge and a fast keyword-overlap DSPy metric.
  - `evolution/core/constraints.py` enforces size, growth, non-empty, and basic skill structure checks.
  - `evolution/skills/evolve_skill.py` wires load skill -> build dataset -> run GEPA or MIPROv2 fallback -> validate -> holdout compare -> save output.

### Planned, not implemented yet

The README and PLAN list later phases, but the directories are placeholders:

- Phase 2: tool description evolution.
- Phase 3: system prompt section evolution.
- Phase 4: tool/code evolution via Darwinian Evolver.
- Phase 5: continuous monitor and scheduled optimization loop.
- `benchmark_gate.py` and `pr_builder.py` are described in `PLAN.md`, but are not present in the inspected repo.

## Runtime learning loop in Hermes Agent

### Skills

Hermes treats skills as on-demand knowledge documents with progressive disclosure:

- `skills_list()` returns names and descriptions.
- `skill_view(name)` loads full instructions or a specific support file.
- `skill_manage(...)` mutates skills.

The public docs call skills "procedural memory": when the agent discovers a non-trivial workflow, it can save the workflow for future reuse. The tool schema says the agent should create skills after complex tasks, recovered errors, user-corrected approaches, or newly discovered workflows. It should patch skills when instructions are stale or incomplete.

Important implementation detail: foreground `skill_manage(create)` calls are treated as user-directed. Only background review-created skills are marked as agent-created for curator telemetry in `tools/skill_manager_tool.py`.

### When Hermes creates a new skill

The create trigger is intentionally narrow in the tool schema and prompt guidance:

- a complex task succeeded after roughly `5+` tool calls
- the agent hit errors or dead ends and found a working path
- the user corrected the approach and that correction should be reused
- the agent discovered a non-trivial workflow
- the user explicitly asked it to remember a procedure

The schema also tells the agent to skip simple one-offs and to confirm with the user before creating or deleting skills. That is the right product shape: skills should capture reusable procedures, not task logs.

The actual write path is:

1. The model calls `skill_manage(action="create", name=..., content=..., category=...)`.
2. Hermes validates the name, category, YAML frontmatter, description length, body presence, and content size.
3. Hermes checks for name collisions across local and external skill directories.
4. Hermes writes `SKILL.md` atomically under `~/.hermes/skills/<category?>/<name>/`.
5. If configured, the agent-created skill security scanner runs and can roll back the write.
6. Background-review-created skills can be marked in `.usage.json` for curator management.

Good skill content is expected to include trigger conditions, numbered steps, exact commands, pitfalls, and verification. Supporting files are allowed only under `references/`, `templates/`, `scripts/`, or `assets/`.

### Skill naming and collision behavior

Skill names are filesystem-safe identifiers:

- max `64` characters
- lowercase letters, numbers, hyphens, dots, and underscores
- must start with a letter or digit
- optional category uses the same character rules and must be a single path segment

Collisions are blocked: a new skill cannot reuse an existing skill directory name discovered across the local skills directory and configured external skill directories. Local skills take precedence when names collide with external read-only skills.

This is mechanically safe, but not semantically sufficient. A name like `debugging`, `fix-tests`, or `deploy` can still be too broad or ambiguous. A better naming convention for scale would be:

- use domain + workflow: `github-pr-review`, `python-debugpy-debugging`, `telegram-channel-integration`
- avoid generic verbs: `fix`, `debug`, `deploy`, `research`
- prefer one reusable class-level skill over many one-incident skills
- patch an existing skill when the new learning is a missing pitfall or step
- create a new skill only when the workflow has a distinct trigger and procedure

### Scale risk: skill sprawl and decision noise

This is the most important operational issue in the "agent evolves itself" story.

Hermes' system prompt tells the model to scan available skills and load a skill if it is even partially relevant. That improves recall, but it also means a bloated or poorly named skill library can become a decision-noise surface:

- too many narrow skills make the skill index harder to scan
- overlapping names can cause the model to load the wrong procedure
- broad skills can shadow more precise skills
- near-duplicate skills increase maintenance burden
- every additional skill description consumes prompt/index attention
- stale skills can encode old commands or bad assumptions

Hermes has several mitigations:

- progressive disclosure keeps the system prompt to names/descriptions until a skill is loaded
- local precedence and collision checks avoid exact duplicate names
- `.usage.json` tracks use/view/patch activity
- curator can mark stale skills, archive unused skills, patch drift, and consolidate overlaps
- pinned skills prevent deletion while still allowing patches
- archives are recoverable and backups exist before curator mutation

The remaining gap is semantic governance. The code can stop duplicate names, but it cannot fully stop duplicate concepts. At scale, skill creation needs a policy like:

- search existing skills before creating
- patch before create when the procedure already exists
- consolidate incident-specific skills into umbrella skills
- keep names stable and boring
- treat category as an information scent, not a dumping ground
- run curator dry-runs periodically before letting automatic archival touch the library

### Create skill vs evolve skill

These are different mechanisms:

- **Create skill** happens inside the live Hermes runtime. It is a memory write: "we learned a workflow, save it as a reusable procedure."
- **Patch skill** also happens inside the live runtime. It is maintenance: "the skill was incomplete or stale, update the procedure."
- **Evolve skill** happens in the companion self-evolution repo. It is offline optimization: "given eval cases and scoring, search for a better version of this skill text."

So "self-evolving" is not one loop. It is a stack:

1. runtime creates or patches procedural memory from experience
2. curator keeps the procedural memory library from rotting or exploding
3. the self-evolution repo can later optimize selected skills against eval data
4. evolved output should become a reviewable diff or PR, not an invisible live mutation

### Memory

Built-in memory stores compact durable facts in `MEMORY.md` and `USER.md`, injected into the system prompt at session start. The docs emphasize a frozen snapshot pattern: memory changes persist immediately but do not alter the active system prompt mid-session, preserving prompt cache stability.

External memory providers are orchestrated through `agent/memory_manager.py`. Honcho is the most relevant to the marketing claim because it can build an evolving model of the user and AI peer beyond the local markdown memory files.

### Background self-improvement review

The important flow is in `run_agent.py`:

1. Each user turn increments `_user_turn_count` and memory nudge counters.
2. Tool iterations increment `_iters_since_skill`.
3. When thresholds trip, the main answer still returns normally.
4. After the answer, `_spawn_background_review(...)` starts a daemon review thread.
5. The review thread creates another `AIAgent`, inherits the parent's cached prompt/runtime, and runs a review prompt over the conversation snapshot.
6. A thread-local whitelist allows only memory and skill tools.
7. Successful memory/skill actions are summarized back to the user as "Self-improvement review".

The docs for Codex app-server runtime state the default cadence as:

- every 10 user prompts for memory review
- every 10 tool iterations within a turn for skill review

This is a genuine closed loop, but it is bounded: it writes memory/skills, not arbitrary source code, and it uses tool whitelisting in the background fork.

### Curator loop

The curator exists because agent-created skills can accumulate. It tracks view/use/patch counts, marks stale skills, archives long-unused skills, and can run an LLM review pass. It never auto-deletes; archives are recoverable. It is triggered by idle/time checks, not a constantly running daemon.

This matters architecturally: a self-improving agent needs garbage collection. Hermes has an explicit component for that.

## Offline evolution repo architecture

`hermes-agent-self-evolution` is a separate repo that operates on `hermes-agent`; it is not imported by the normal live Hermes runtime.

The intended loop:

1. **Select target**: a skill, tool description, prompt section, or code file.
2. **Build eval dataset**: synthetic cases, mined session history, or hand-curated golden JSONL.
3. **Wrap target as optimizable module**: for skills, the `SKILL.md` body becomes the text parameter.
4. **Run optimizer**: primary path is DSPy GEPA; fallback is DSPy MIPROv2.
5. **Evaluate variants**: score baseline and evolved candidates using task-specific metrics and holdout examples.
6. **Constraint gates**: size/growth limits, structure validation, tests/benchmarks where available.
7. **Deploy as reviewable change**: create branch/PR with metrics. The plan repeatedly says no direct commit/auto-merge.

### Skill evolution code path

Current entrypoint:

```bash
python -m evolution.skills.evolve_skill \
  --skill github-code-review \
  --iterations 10 \
  --eval-source synthetic
```

Key modules:

- `evolution/skills/evolve_skill.py`: orchestration.
- `evolution/skills/skill_module.py`: `SkillModule` wraps `skill_instructions + task_input -> output`.
- `evolution/core/dataset_builder.py`: synthetic and golden dataset support.
- `evolution/core/external_importers.py`: session mining from Claude Code, Copilot, Hermes.
- `evolution/core/fitness.py`: LLM judge and quick metric.
- `evolution/core/constraints.py`: gates.

The detailed skill evolution flow is:

1. Resolve the target skill from the `hermes-agent` repo's `skills/` tree.
2. Parse `SKILL.md` into frontmatter and body.
3. Build or load eval examples:
   - synthetic examples generated from the skill text
   - golden JSONL examples
   - mined session history from Claude Code, Copilot, and Hermes
4. Split examples into train, validation, and holdout.
5. Wrap the skill body as `SkillModule(skill_text)`.
6. Run `dspy.GEPA(metric=skill_fitness_metric, max_steps=iterations)`, or fall back to `dspy.MIPROv2`.
7. Reassemble the original frontmatter with the evolved body.
8. Validate size/growth/non-empty/basic skill structure.
9. Compare baseline and evolved modules on the holdout set.
10. Save baseline, evolved skill, and metrics under `output/<skill>/<timestamp>/`.

There is a useful design idea here: the optimizer mutates instruction text, not model weights. But the current implementation is not yet the full plan. The fast metric is mostly keyword overlap, and the main flow does not yet run a full Hermes `batch_runner.py` task execution loop for every candidate.

### Deep dive: DSPy module wrapping and GEPA/MIPROv2

The two architecture boxes mean:

1. **Wrap artifact as DSPy module**: Hermes converts a skill file into a tiny DSPy program. The current `SkillModule` signature is effectively:

   ```text
   skill_instructions + task_input -> output
   ```

   The `SKILL.md` frontmatter is parsed and preserved, while the markdown body becomes `skill_text`. On every eval example, the wrapper calls `dspy.ChainOfThought` with the current skill body and a test task. This lets the optimizer treat the skill text like a tunable prompt parameter.

2. **GEPA / MIPROv2 optimization**: the optimizer repeatedly proposes alternative versions of that skill body, runs the wrapped module on eval examples, scores outputs, and keeps better candidates. GEPA is the preferred path; if `dspy.GEPA` is unavailable, the code falls back to `dspy.MIPROv2(auto="light")`.

DSPy docs describe optimizers as tuning a DSPy program against a metric using a few training inputs; MIPROv2 proposes and searches natural-language instructions and demos, while GEPA reflects on execution traces and textual feedback to mutate prompts. The [GEPA paper](https://arxiv.org/abs/2507.19457) reports better sample efficiency than RL-style optimization in its benchmarks, including up to `35x` fewer rollouts and more than `10%` improvement over MIPROv2 in reported comparisons. That external result is for GEPA as a method, not a measured claim for Hermes' current skill-evolution repo.

Hermes repo defaults and numbers:

| Item | Current value |
| --- | --- |
| Default optimizer steps | `10` GEPA iterations |
| Default optimizer model | `openai/gpt-4.1` |
| Default eval / judge model | `openai/gpt-4.1-mini` in CLI, config says judge default `openai/gpt-4.1` but `evolve_skill.py` passes `judge_model=eval_model` |
| Synthetic eval size | `20` examples |
| Default split | `50%` train / `25%` val / `25%` holdout = about `10 / 5 / 5` examples |
| Fast metric | keyword-overlap proxy, `0.3 + 0.7 * overlap`, with `0.5` base for non-empty output |
| LLM judge dimensions | correctness `50%`, procedure following `30%`, conciseness `20%` |
| Length penalty | ramps up near limit, max `0.3` |
| Max skill size | `15,000` chars |
| Max growth over baseline | `20%` |
| Max tool description size | `500` chars |
| Max parameter description size | `200` chars |
| Test gate in current main flow | `--run-tests` exists, but the inspected `evolve_skill.py` does not call `run_test_suite()` in the main path |

Practical value:

- Useful when a workflow is repeated often and has clear examples: PR review style, release checklist, channel integration playbook, incident response, data-cleanup procedure.
- Useful when failures can be captured as eval cases: "the skill forgot to verify source before writing", "the skill over-created files", "the skill missed a rollback step."
- Useful as a review tool: produce a candidate `SKILL.md` and `metrics.json`, then a human reviews the diff.

Overkill / weak value:

- Overkill for one-off skills, personal preferences, tiny procedures, or anything without repeatable eval examples.
- Weak if synthetic evals are generic. With only about `20` synthetic examples and `5` holdout examples, scores can be noisy and easy to overfit.
- Weak if the metric is keyword overlap. A skill can score higher by parroting expected words without actually improving agent behavior.
- Overkill if the evolved skill is not tested inside the real Hermes agent loop. The wrapper tests `skill text + task -> output`, not the full tool-using agent with file edits, terminal output, memory, and user constraints.
- Current code has a maturity bug/gap: it validates `skill["body"]` as if it were a full skill file with YAML frontmatter, while `load_skill()` already stripped frontmatter from the body. That means the skill-structure constraint can fail even when the reassembled final skill would contain valid frontmatter.

The operational read: wrapping a skill as a DSPy module is the practical piece. It turns loose "prompt improvement" into a testable artifact update. GEPA/MIPROv2 is valuable only after there is a real eval set and a real gate. Without that, it is expensive prompt-churn with a scientific name.

### Maturity caveat

The repo's README says Phase 1 is implemented. The inspected code supports that direction, but it is early:

- GEPA integration is attempted through `dspy.GEPA`, with fallback to MIPROv2.
- The default fast metric is keyword overlap, not a full agent execution through Hermes `batch_runner.py`.
- `run_test_suite()` exists but is not called in the main `evolve_skill.py` flow after candidate extraction.
- PR creation is described in the plan but not implemented in the current file tree.
- Tool/prompt/code/monitor phases are placeholders.

So the accurate read is: **the concept and first skill-optimization pipeline exist, but the fully autonomous multi-phase self-evolution system is mostly roadmap.**

## Technical interpretation of "self-evolving"

The architecture uses four "memory surfaces":

- **Semantic/user memory**: `MEMORY.md`, `USER.md`, external providers like Honcho.
- **Procedural memory**: skills (`SKILL.md`) that encode workflows and pitfalls.
- **Episodic memory**: SQLite sessions with FTS5 + summaries through `session_search`.
- **Trajectory/eval memory**: JSONL traces and mined sessions for optimization datasets.

Runtime Hermes improves by writing the first two and searching the third. The offline evolution repo turns the third and fourth into eval data, then mutates the second and eventually prompts/tools/code.

That is a practical agent evolution loop:

```
Use agent -> observe traces/corrections -> save memory/skills -> curate skills
          -> mine eval data -> optimize skill/prompt/tool/code -> human PR
          -> deploy next version -> repeat
```

But it is not an unchecked recursive self-modifier. The strongest safety idea is that **benchmarks are gates, not the objective**. Task-specific eval drives optimization; broader benchmarks and tests catch regressions.

## Strengths

- Clear separation between live runtime learning and offline artifact optimization.
- Good artifact choices: skills and tool descriptions are easier and safer to evolve than model weights.
- Prompt-cache awareness: no mid-session hot-swap.
- Human review remains in the deployment path.
- Curator acknowledges the real operational issue of skill-library sprawl.
- Session mining bridges real usage into eval datasets.

## Hype check: does Hermes escape the long-context decay pattern?

No. Hermes is still an agent harness around frontier models, tools, memory, and prompts. It can still get worse when the context window fills, tool output grows, skills overlap, or recalled memory is trusted too much. The difference is not "Hermes has no context problem"; the difference is that Hermes adds explicit mechanisms to manage the problem:

- session search instead of relying only on active context
- memory writes for durable user/project facts
- skills for reusable procedures
- background review forks that can save learnings after the main answer
- curator logic for stale or duplicate agent-created skills
- trajectory capture and an offline evolution repo for eval-driven artifact updates

That is a real architectural difference from a simple chat wrapper, but it does not remove the need for operator discipline. In fact, the extra machinery adds new failure modes: memory can be wrong, skills can sprawl, curator edits can break references, and self-improvement can become prompt/tool overhead if it is not governed.

### Public complaint signals found

These public issues and community signals line up with the concern that Hermes can still degrade under real use:

- **Context pressure remains real**: issue [#21567](https://github.com/NousResearch/hermes-agent/issues/21567) asks for a context-mode skill because the "Context Window" gets full quickly from tooling output.
- **Memory can become unsafe if unverified**: issue [#17164](https://github.com/NousResearch/hermes-agent/issues/17164) reports false project-status recall and live file mutation before source-of-truth verification. The issue frames the failure as memory-assisted improvisation rather than reliable engineering behavior.
- **Self-improving skills can drift from upstream**: issue [#19549](https://github.com/NousResearch/hermes-agent/issues/19549) reports self-improving skills not updating, with local skill patches blocking upstream improvements.
- **Self-modifying artifacts need provenance**: issue [#11692](https://github.com/NousResearch/hermes-agent/issues/11692) asks for receipts proving which skill version produced which output.
- **Skill lifecycle and sprawl are acknowledged risks**: issues such as [#7816](https://github.com/NousResearch/hermes-agent/issues/7816), [#11425](https://github.com/NousResearch/hermes-agent/issues/11425), and [#23104](https://github.com/NousResearch/hermes-agent/issues/23104) discuss stale skills, usage metadata, cleanup, compounding gates, deduplication, and negative examples.
- **Long-running delegation can get slow**: issue [#11431](https://github.com/NousResearch/hermes-agent/issues/11431) reports multi-round subagent runs becoming slow from oversized child toolsets and heavy session persistence.
- **OpenClaw interop can create operational weirdness**: issue [#23799](https://github.com/NousResearch/hermes-agent/issues/23799) reports Hermes and OpenClaw exposed to each other as tools, causing repeated OpenClaw child-fleet respawns and orphan `claude mcp serve` processes.
- **Community anecdote is mixed**: a Reddit thread about Hermes reaching the top of OpenRouter token rankings includes users calling out high token usage, bundled-skill overhead, side-by-side OpenClaw/Hermes use, and at least one user saying Hermes may not replace OpenClaw for them soon. Treat this as anecdotal, not a measured benchmark: ["Hermes Agent is now #1 on the Global OpenRouter token rankings"](https://www.reddit.com/r/hermesagent/comments/1t7qqlx/hermes_agent_is_now_1_on_the_global_uopenrouter/).

The evidence supports a conservative read: Hermes is not immune to the "small context good, big context bad" pattern. It tries to replace raw context accumulation with structured memory and procedural recall, but those systems must be curated or they become another form of context debt.

### Is there evidence of users going back to OpenClaw?

I did not find strong public evidence of a broad "people tried Hermes, then returned to OpenClaw" pattern. I found comparisons, hype skepticism, token/bloat complaints, at least one public comment that Hermes may not replace OpenClaw for that user soon, and OpenClaw migration/interop issues. That is enough to say there is real skepticism, but not enough to claim a reversal trend.

The more defensible position is:

- users who value minimalism, predictable behavior, and lower prompt/tool overhead may prefer OpenClaw-like workflows
- users who value persistent memory, reusable skills, gateway integrations, and eval-driven improvement may find Hermes meaningfully different
- users who let Hermes create or load too much context without governance can reproduce the same degradation pattern they disliked elsewhere

### 80/20 Hermes advantages over OpenClaw-like workflows

If choosing only the 20% of Hermes that can feel different immediately, pick these:

1. **Skill-backed procedural memory**: capture recurring workflows as `SKILL.md` instead of re-explaining them in every session. This is the most visible difference when work repeats.
2. **Session search and source-ranked recall**: use prior sessions as searchable episodic memory, but require source verification before project-status claims or file mutation.
3. **Curated skill lifecycle**: use curator, archive, usage metadata, and dedup policies from day one. Without this, skills become noise.
4. **Trajectory and eval artifacts**: keep traces that can become eval cases. This is the path from "agent remembered a trick" to "agent workflow improved under a gate."
5. **Gateway/runtime breadth**: Hermes is interesting when it is used as a durable operator across CLI, server, gateway, cron, and session surfaces, not just as a one-shot terminal chat.

The practical recommendation is to adopt Hermes with a minimal default skill set, strict skill naming, and a "patch before create" rule. Turn on the self-improvement loop for repeated workflows, not for every incident. If the team cannot maintain skill governance, Hermes can feel like another hype cycle with more moving parts.

## Weak points / open risks

- Evaluation quality is the bottleneck. Synthetic rubrics and keyword overlap can overfit or reward shallow changes.
- Phase 1 does not yet appear to run full Hermes agent behavior through `batch_runner.py` in the main optimization loop, despite the plan.
- PR builder and benchmark gate are plan-level, not present in code.
- Skill creation can become noisy at scale if the agent creates one skill per incident instead of patching/consolidating existing procedures.
- Name validation is syntactic, not semantic; it prevents unsafe names and exact collisions, but not overlapping concepts like `debug-tests`, `test-debugging`, and `pytest-fixes`.
- The prompt strongly encourages loading partially relevant skills, so skill sprawl can degrade model attention and procedure selection even if progressive disclosure keeps token cost bounded.
- Continuous self-improvement can create noise unless auto-triage is conservative.
- Tool/prompt evolution has larger blast radius than skill evolution; those phases need stronger regression suites than currently visible.
- "Self-evolving" branding is stronger than current implementation maturity if interpreted as autonomous code/model improvement.

## Bottom line

Hermes is meaningfully more self-improving than a normal chat agent because it has memory, agent-managed skills, background review forks, session search, trajectory capture, and a separate eval-driven evolution repo.

The technically honest framing:

> Hermes is building toward a closed-loop artifact evolution system. Today, the live agent can improve its memories and skills during use, while the external self-evolution repo provides an early DSPy/GEPA pipeline for optimizing skills. Broader prompt/tool/code evolution and unattended continuous improvement are planned, not fully shipped.
