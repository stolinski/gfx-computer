# Clean Light — Pack Aesthetic

The appearance reference for the **`clean-light`** Pack — the catalog's first
**light-field** pack. [`syntax`](../syntax/aesthetic.md) is warm dark paper,
[`editorial-mono`](../editorial-mono/aesthetic.md) is cool print with dark-piece
fields, [`crt-terminal`](../crt-terminal/aesthetic.md) is emissive glass; Clean
Light is a **white studio**: soft-neutral fields, white cards separated by thin
rules and a quiet layered shadow, one confident product blue. The
design-YouTuber / product-demo voice. The engine and Pipelines are identical;
only the dress changes. This doc is what the Critic verifies a `clean-light`
Preset against.

Every load-bearing value below was **measured at intake (2026-07-13)**, not
remembered: field/card whites and the quiet-shadow ramp from notion.com, the
hairline and cool-ink family from docs.stripe.com, the Geist voice and
mono-eyebrow label grammar from vercel.com. Register references: product
launch pages, tool-demo videos, design-YouTuber b-roll — Notion, Stripe,
Vercel, Linear, Figma community.

## Channel Voice

Calm, confident, effortless. The mood is "product film," not "keynote" —
nothing shouts, nothing decorates. Negative space is the main material:
generosity of margin IS the luxury cue. Where Syntax is hand-made and
Editorial Mono is art-directed print, Clean Light is **studio-made** — every
object photographed on a white sweep under flat, even light.

## Palette — neutrals plus one blue

| Role               | Value               | Provenance / use                                                                       |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| field              | `#f6f7f8 → #eef0f2` | full-frame backdrops; the floor deepens one neutral step so white cards separate       |
| card / plate       | `#ffffff`           | measured (notion cards); the object color                                              |
| ink                | `#16181d`           | derived between measured `#1a1f36` (stripe h1) and notion's 95%-black; cool near-black |
| secondary / byline | `#5b6472`           | measured stripe body `#3c4257`, lifted one step; the slate voice                       |
| hairline           | `#e3e8ee`           | measured (stripe card borders); rules on cards                                         |
| rule-on-field      | `#d0d7e0`           | one step darker — a field rule must survive video compression                          |
| accent             | `#0075de`           | measured (notion CTA); THE product blue                                                |
| highlight wash     | `#8fc2f0`           | accent at selection-wash lightness                                                     |

- **One accent.** Blue does every accent job — kicker, pin, active cue, every
  annotation tool. An alert is the same blue doing a louder job, never a
  second hue. (Q4: this pack idles at ONE saturated hue.)
- **No warm anything.** The neutral ladder is cool; warmth belongs to other
  packs.

## Type System

**Geist + Geist Mono** (self-hosted via `@fontsource` in
`src/lib/packs/clean-light/fonts.ts`; both ship true cuts — never synthesize).

- **Geist** — display and body: titles, names, quotes. **600 semibold is the
  display ceiling** (the register is understated — vercel's h1 measures 400);
  hierarchy comes from size and the ink/slate split, never from heavy cuts.
- **Geist Mono** — the eyebrow-label voice: kickers, tags, stamps, diagram
  labels. `0.07em` tracking (measured: vercel's mono eyebrows at 1px/14px),
  weight 400–500. Sentence case stays the default — this pack does not shout;
  uppercase belongs only where a pipeline's label voice is intrinsically caps.
- Kinetic display motion uses `Geist Variable` over the restrained 100–600
  portion of its real `wght` axis, with 500 as rest. Weight may strike the 600
  ceiling; the Pack never borrows the face's available 700–900 cuts.

## Surface Treatment — the white studio

The structural claims, and the roles they exercise:

- **Depth is a quiet float.** `depth-treatment` is a straight-down, wide-blur,
  low-alpha shadow (`0 8px 36px rgba(9,13,20,0.10)` @4K — notion's measured
  4-layer ramp, scaled and lifted a step for broadcast). The "screenshot
  floating on white" read. No stepped stacks, no glow, no gaussian drama.
- **Rules are thin.** Card boundaries are `#e3e8ee` hairlines at ~1px 1080
  equivalent (`0.18cqmin` @4K — thinner vanishes on downscale). The border
  whispers; the shadow does the separating.
- **Edges are die-cut.** `edge-treatment: 'clean'` — nothing tears, feathers,
  or fibers.
- **Light fields everywhere.** Full-frame pieces sit on the near-white studio
  gradient; every additive atmosphere role (keys, glows, bands, motes) is
  zeroed. Flat, even light is the claim — a staged key would make it a set,
  not a studio.
- **Ink needs no armor.** Baked glyph text-shadows are claimed off — dark ink
  on white needs none, and a dark halo on white reads as a bug.
- **Substrate ≠ chrome** binds as everywhere: quoted documents keep their own
  physics; the white-card grammar is only what the channel adds.

## Motion Vocabulary Preferences

A subset of the shared vocabulary, biased to effortless: **smooth fades and
micro-scale resolves** (the product-film cut), **settled-place** at low
overshoot (objects set down gently, never tossed), **stroke-draw** for thin
diagram rules, cursor moves as first-class content (the screencast register).
Exits dissolve or slide short distances. Avoid: bounce, wobble, tape-down
physics, typewriter pop-in, anything that reads as effortful.

Sound: soft, short, dry — felt ticks and low thumps at the quiet end of the
kit. Audition samples; event names lie.

## Anti-Aesthetic — what Clean Light is _not_

- **No dark fields.** A near-black backdrop under a clean-light piece is a
  pipeline bug by definition — this is the catalog's light pack.
- No chunky borders, no stepped hard-offset shadows — that grammar is
  syntax's property.
- No gloss: no gradients-as-atmosphere, no flares, no glassy plates, no
  vignettes. White is flat.
- No grain, grit, or paper tooth — the studio is digital-clean. (Paper-grain
  effects that bond a dark field read as dirt on white.)
- No torn edges, tape, or collage — nothing is stuck down in a studio.
- No second saturated hue; no warm tints. One blue.
- No heavy cuts (700+ display), no letterspaced shouting beyond the eyebrow
  grammar, no all-caps titles.
- Not sterile-corporate: generous space and real content keep it human;
  if a frame reads as a slide template, the composition is wrong, not the pack.

When in doubt: _would this frame pass as b-roll in a top-tier product film?_

## Reference Reel

| Source                                       | Take from it                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| notion.com (measured 2026-07-13)             | white-on-white cards separated by the 4-layer quiet shadow; radius scale     |
| docs.stripe.com (measured 2026-07-13)        | hairline-driven card grammar; the cool ink/slate text ladder                 |
| vercel.com (measured 2026-07-13)             | Geist voice; mono uppercase eyebrow labels at ~0.07em; restraint as identity |
| Product-film b-roll (Linear, Figma launches) | motion register: effortless resolves, cursor as content                      |
