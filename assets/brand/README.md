# Brand assets

Clisbot's copies of upstream's canonical brand folder. Every SVG here is generated from the
approved Flow / Ocean 02 kit in [`assets/branding/clisbot/`](../branding/clisbot/README.md)
by `scripts/branding/apply.mjs` during each upstream sync; do not edit them by hand.

- `marks/clisbot-*.svg` and `marks/clisbot-hub-*.svg`: the filled Flow mark on a
  `700 × 700` viewBox (`fill-rule="evenodd"`). Clisbot has one mark, so the Hub files repeat it.
- `lockups/*.svg`: the Flow mark with the Manrope Bold wordmark (`clisbot`, `clisbot hub`,
  `hub`, lowercase like the approved wordmark), 144 units high with a 2-unit margin, in the kit's lockup proportions.
- `fonts/`: upstream's Plus Jakarta Sans, kept with its license; Clisbot lockups do not use it.

`green` files carry the Clisbot Ocean accent (`#153B43`).

## Regenerate

```sh
node assets/brand/build.mjs            # marks and lockups only
node scripts/branding/apply.mjs --apply  # the whole kit
```
