# Content Architecture

Use this file when improving `queue-workflow` itself or any code, doc, or skill surface where structure can sprawl.

For skills, the goal is context saving and progressive disclosure. For docs and code, the goal is readability, maintainability, and a review surface humans can still understand.

Read this file when you need:

- file split heuristics
- anti-ambiguity rules
- line and heading limits
- code, doc, or skill architecture recipes
- a checklist for human + AI readability

See also:

- [../SKILL.md](../SKILL.md) for queue workflow, queue plans, and command templates

## Root Problem

AI can create duplicate structure from the first pass: another section, file, function, fallback, or helper with similar purpose because the local completion looks useful. Continued work can amplify that duplication unless the workflow checks existing owners first.

Prompt echoing and history leaking make this worse: the artifact may copy the user's wording or explain old draft problems instead of presenting the best objective version. That breaks human review because the system becomes larger, less named, and harder to trust.

The fix is structural discipline: inventory existing owners, reuse or merge overlap, add only when a distinct responsibility remains, and report any intentional duplication.

## Structure Rules

### File Split Heuristics

Split by decision surface, not by arbitrary document length.

Good splits:

- code: domain/model owner, adapter/integration owner, tests near the touched contract
- docs: main reader journey first, appendices or references only when they solve a separate lookup need
- skills: `SKILL.md` coordinates trigger/workflow and always-needed recipes; references hold only dense optional rules

Bad split:

- one file for every tiny subtopic
- one file for examples, one for notes, one for caveats, one for reminders, when all belong to the same decision

### Universal Architecture Rules

- Inventory before adding: search for similar files, sections, functions, components, terms, and command surfaces.
- Prefer merge, rename, move, or delete over a new owner when purpose overlaps.
- One concept has one owner; other places link to it instead of repeating it.
- New structure needs a distinct responsibility, clear reader/caller path, and clear reason to change.
- Use boring, short, role-revealing names; reuse the repo glossary or dominant existing terms.
- Keep the diff within reviewer capacity: smallest coherent change that fully solves the task.
- Keep sibling structure consistent: if one artifact type uses a heading, peer artifact types should use the same heading pattern.
- When duplication remains, say why it cannot be merged now.
- Do not echo user wording or leak draft history into the final artifact; use an existing changelog section/file only when useful.

### Size Rule

Keep files small enough that loading one file does not waste context, but large enough that loading it solves a real subproblem completely.

Preferred shape:

- one short coordinator file
- a few dense reference files
- each reference file should answer one coherent question end to end

Default budgets:

- `SKILL.md`: target under 250 lines; reference files target under 200 lines unless they are searchable specs.
- New section: target 3-7 lines before examples; split or merge if it needs more.
- Function: one reason to change, usually under 40 logical lines unless the repo's local style differs.
- Folder depth: keep shallow and obvious; avoid more than 3 levels below the feature root unless already established.
- Operator docs: target under 1,500 words; PRDs, design docs, and proposals target under 2,500 words unless the user asked for deep reference.
- Headings: one H1; target 5 H2s, max 7 H2s, and max 5 H3s under any H2; 8 H2s should trigger refactor. Avoid H4 by default, but allow it when the document genuinely needs that level.
- Queue passes should delete or merge as eagerly as they add.

## Artifact Recipes

### Code

- Start from software fundamentals: domain model, boundaries, data flow, invariants, and error contracts.
- Map existing modules before editing; keep folders short, simple, and responsibility-based.
- Apply SOLID pragmatically: split by reason to change, not by pattern names.
- Name consistently by role and family, such as `*Service`, `*Store`, `use*`, `parse*`, or existing repo convention.
- Before adding a file/function, find similar logic and choose reuse, merge, or an explicit non-merge note.
- Tests should cover the touched contract, not only the happy line edited.
- Final pass removes dead fallbacks, duplicate wrappers, naming drift, and unnecessary files.

### Docs

- Choose the doc mode first: PRD, design doc, proposal, runbook, reference, decision note, or learning guide.
- Keep one H1; target 5 H2s, max 7 H2s, and max 5 H3s under any H2; use H4 only when the doc mode needs it.
- Each major section should answer one reader question and end near a concrete decision, action, check, or evidence.
- Keep operator docs under 1,500 words and PRDs/design docs/proposals under 2,500 unless the user asked for deep reference.
- On-page structure: clear title, intent in the first 100 words, descriptive headings, internal links, no keyword stuffing.
- Merge overlapping sections before adding new ones; one concept gets one canonical explanation.
- Separate changelog/draft notes from the final version; prefer an existing changelog section/file, and omit them when the user does not need them.

### Skills

- `SKILL.md` owns trigger, workflow, selection, navigation, and reporting; references own dense variants.
- Keep top-level under 250 lines and references under 200 lines unless a reference is intentionally searchable.
- Target 5 H2s, max 7 H2s, and max 5 H3s under any H2; 8 H2s should trigger refactor. Avoid H4 unless the skill genuinely needs that depth.
- Say exactly when to read each reference and what decision it solves.
- Add examples only when they change behavior; keep them copyable and truthful.
- Update frontmatter description when trigger coverage changes.
- Verify progressive disclosure: a future agent loads only what the task needs.

## Authoring Rules

- Follow the same sibling pattern for repeated artifact types; do not mix headings with prose labels.
- Name scope, owner, rule, exception, and validation clearly.
- Avoid vague verbs like "improve" unless the exact lens is named.
- Keep examples, commands, links, and names truthful to the actual artifact.
- Remove draft-history explanation from the final artifact unless a changelog is expected.

## Revision Checklist

Before finishing any code, doc, or skill artifact, check:

1. Is there one clear owner for each concept?
2. Did you merge or delete overlap before adding structure?
3. Are sibling sections, files, and names consistent?
4. Are line, heading, folder, and function budgets still inside review capacity?
5. Would a human and an AI interpret the artifact the same way?
