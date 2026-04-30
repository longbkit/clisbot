# Prompt Briefs

These prompt briefs document the avatar directions tried for `@clisbot` on X.

Exact image-generation request payloads were not stored before this archive was created, so these are reconstructed briefs that preserve the design intent, constraints, and critique from the session.

## Shared Constraints

- 1:1 square profile avatar designed for circular crop on X.
- Must remain readable at small sizes.
- No wordmark or long text. The only acceptable text-like symbol is `>_`.
- Brand mood: modern, technical, trustworthy, AI agent / CLI / messaging automation.
- Palette: dark charcoal or black base, bright cyan and teal as primary accents, optional small amber accent.
- Avoid generic robot faces, over-detailed 3D rendering, stock AI glow, or busy backgrounds.

## v1, Early Manual Direction

**Brief**

Create a compact clisbot avatar mark using simple geometric forms, dark background, bright technical accent color, and a terminal-inspired face. Prioritize a clean social profile silhouette over detail.

**Result**

This direction established the rough terminal/avatar territory, but it did not yet have enough ownable character or polished brand logic.

## v2, Professional Bot Terminal

**Prompt brief**

Create a professional modern avatar for `clisbot`, an AI agent that operates from chat and CLI surfaces. Use a sleek bot head with a terminal-style `>_` expression, dark charcoal circular badge, cyan and teal lighting, subtle amber accent, high contrast, premium SaaS/devtool feel, trustworthy and modern, centered composition, no text except `>_`, readable as an X profile photo.

**Critique**

v2 looked polished and trustworthy, but the silhouette was still too close to a generic robot assistant. The mark carried professionalism but lacked distinctiveness and viral memory.

## v3, Recognizable Chat-Bubble Bot

**Prompt brief**

Create a simpler, more iconic clisbot avatar for small social sizes. Use a chat-bubble outline fused with a bot face. Make the `>_` terminal expression large and central. Keep the design flat-to-semi-flat, dark circular background, cyan/teal strokes, minimal details, strong silhouette, no extra text, no clutter.

**Critique**

v3 improved small-size readability. The `>_` signal became clearer, and the chat-bubble idea connected better to clisbot. It still felt like a category icon rather than a brand-ownable mark.

## v4, C-Prompt Chat Mark

**Prompt brief**

Design a brand mark for clisbot that combines a capital `C`, a terminal prompt `>_`, and a speech bubble into one compact avatar. Use a black circular field, cyan/teal vector-like geometry, balanced negative space, sharp modern developer-tool styling, highly readable at 48px, no full wordmark.

**Critique**

v4 had the strongest conceptual compression: `C` for clisbot, `>_` for CLI, chat bubble for conversational surfaces. It was cleaner as a logo, but less emotionally memorable as a social avatar.

## v5, Meo-CLI Agent Mark

**Prompt brief**

Create a more ownable clisbot mascot-logo called the Meo-CLI Agent Mark. Combine a subtle cat-bot silhouette with a chat bubble and a large terminal `>_` face. Make it modern, geometric, trustworthy, and devtool-friendly. Avoid childish cartoon styling. Use black circular badge, cyan/teal linework, high contrast, simple shapes, memorable ears, readable at avatar size.

**Critique**

v5 was more memorable and more viral than v4 because it added a mascot silhouette. The cat shape gives people an easy visual hook to remember and describe. The downside was that, on close inspection, the execution still looked slightly illustrative and AI-generated rather than fully logo-system polished.

## v6, Polished Meo-CLI Mark

**Prompt brief**

Refine the Meo-CLI Agent Mark into a more professional vector-logo avatar. Keep the cat-bot/chat-bubble silhouette and the `>_` terminal face, but make the design flatter, cleaner, more symmetrical, and more grid-aligned. Reduce glow, gradients, tiny details, and toy-like expression. Use a black circular badge with crisp cyan/teal geometry, strong negative space, balanced stroke weight, premium AI developer-tool identity, readable at small X avatar size.

**Critique**

v6 is the current landing. It keeps the mascot memory from v5 while improving professional polish: fewer effects, cleaner proportions, stronger symmetry, and a more deliberate logo-like shape.

## Why The Cat-Bot Direction

The cat-bot is not used because clisbot is a pet brand. It is used because it gives a technical product a recognizable social identity.

For clisbot, a purely abstract mark is cleaner but easier to forget. A generic robot is understandable but not ownable. A subtle cat-bot sits between the two:

- it is simple enough to work as a logo;
- it has a silhouette people can remember;
- it matches the assistant personality without becoming childish;
- it can scale into stickers, reactions, release art, and launch posts;
- it still carries the `>_` terminal mark, so the developer-tool meaning is not lost.

The key is execution quality. Future refinements should keep the cat-bot idea but make the final asset more vector-native, grid-based, and reproducible.

## Next Refinement Direction

If this identity is developed further, the next step should be a hand-authored vector pass instead of another raster-only generation:

- define a 1024x1024 grid;
- lock the circular badge, ear angles, chat-tail shape, and `>_` position;
- reduce the palette to 3-4 exact color tokens;
- export SVG, PNG 1024, PNG 512, and small-size proofs at 128, 64, and 32;
- test the avatar in X, Slack, GitHub, npm, and docs contexts.
