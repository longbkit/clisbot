---
title: Code Review Checklist Draft
status: draft
date: 2026-04-14
area: development
summary: Short internal checklist for reviewing patches with focus on scope control, contract safety, regression risk, and validation quality.
---

# Code Review Checklist Draft

Use this before approving a patch.

The goal is not perfect formality.

The goal is to catch avoidable bad fixes early.

## 1. Problem Fit

- Does the patch clearly fix the bug or requirement that was asked for?
- Is the fix aimed at the real seam where the bug lives, not just the visible symptom?
- If the bug is narrow, is the patch also narrow?

## 2. Layer Boundaries

- Did the patch keep shared loader, resolver, or helper semantics unchanged unless change was truly required?
- Did any utility or shared helper silently change contract?
- Is ownership still clear about which layer decides behavior?

## 3. Blast Radius

- Outside the target bug, what behavior changed?
- Could this patch break existing config, runtime assumptions, or operator workflow?
- Is there a simpler fix with fewer moving parts?

## 4. Truthfulness

- Do names, comments, status output, and docs still describe the real behavior?
- If there is fallback behavior, is it explicit and reviewable?
- Does the patch hide complexity, or surface it honestly?

## 5. Validation

- Do tests cover the real production seam, not just a mocked outcome?
- Is there at least one check for regression on the previously working path?
- Was compile or typecheck run when relevant?

## 6. Ship Decision

- Is this patch easy to explain in a few sentences?
- If the explanation sounds too complicated, is the design too broad?
- Would you still trust this patch after reading it fresh tomorrow?

## Practical Rule

If a patch fixes one small bug by changing multiple shared semantics, stop and review the seam again.

Prefer:

- narrower scope
- fewer contract changes
- smaller diff
- more direct validation

Avoid:

- workaround layers
- silent helper contract drift
- tests that prove only the happy-path story
