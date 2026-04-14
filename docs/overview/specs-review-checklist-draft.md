# Specs Review Checklist Draft

## Status

Draft

Experimental review aid.

Not an official repository standard yet.

## Purpose

Use this checklist to review a feature spec quickly before implementation hardens.

It is meant to stay:

- short
- MECE enough for practical review
- easy to update as the team learns

## Review Status Labels

Use one label at the top of the spec or guide under review:

- `explore`
- `spec-ready`
- `alpha`
- `beta`
- `official`

If the status is unclear, the spec is not review-ready.

## The 7 Gates

### 1. Outcome

- Is the user or operator value obvious?
- Is the problem worth solving now?
- If the user guide still reads weakly, should this feature be cancelled or re-scoped?

### 2. Actors And Surfaces

- Which user types or roles are involved?
- Which surface owns each action:
  user guide, prompt, slash command, routed runtime, operator CLI, config?
- Who can do what, where?

### 3. Behavior And Enforcement

- What is current behavior?
- What is target behavior?
- Which parts are advisory only?
- Which parts are hard enforcement?
- Is resolution order explicit?

### 4. Defaults And Safety

- Are defaults and fallbacks safe?
- Could a neutral fallback be misread as a privileged state?
- Are protected boundaries clear:
  editable templates versus protected prompt blocks, route-local rules versus global auth?

### 5. Operator Flow

- Can a real operator complete the main flow without architecture context?
- Are add/remove/change/debug flows covered?
- Are denial or failure paths clear and actionable?

### 6. Transition And Risk

- Is compatibility policy explicit:
  compatibility mode, migration, or fail-fast replacement?
- Are the main regression risks named?
- Is there any ambiguous old-vs-new behavior left?

### 7. Evidence And Maturity

- Is there both a dev-facing spec and a user-facing or operator-facing guide when needed?
- Does the wording match current runtime truth versus planned target truth?
- Is the maturity label honest?
- Is the validation plan good enough for the claimed status?

## Quick Verdict

A spec is usually in good shape when:

- all 7 gates have a clear answer
- no gate depends on hidden assumptions
- user guide and dev spec tell the same story
- the status label matches reality

Common stop signals:

- the value is still not convincing
- operator flow is still muddy
- advisory versus enforced behavior is still mixed up
- fallback semantics still feel risky
- the guide is weak enough that the feature may not be worth shipping

## Notes

- Prefer this checklist for review, not as a replacement for feature docs or task docs.
- If the checklist repeatedly catches the same missing section, promote that rule into the spec template later.
