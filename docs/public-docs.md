# Public docs

`public-docs/` is published as clisbot.com/docs. Write for the reader's mental model: what this is, whether they need it, and the one way to do it. Match the voice of the page you edit.

## Word budget

Each page has a baseline word count in `scripts/public-docs/word-baseline.json`. A page may grow to at most 110% of its baseline. When a fact changes, rewrite the part that is now wrong and cut what no longer helps; do not append.

```bash
node scripts/public-docs/word-budget.mjs          # every page: words / budget
node scripts/public-docs/word-budget.mjs --check  # list only pages over budget, exit 1
```

Counts skip frontmatter and table syntax. Raise a baseline only as a deliberate edit to the JSON, with the reason in the commit message. A rewrite that stays within budget does not change the baseline, so the cap does not creep.
