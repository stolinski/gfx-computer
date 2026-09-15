# Editorial Mono — Pack Aesthetic

The appearance reference for the **`editorial-mono`** Pack — the cool, modern,
**editorial** counterpart to [`syntax`](../syntax/aesthetic.md)'s warm zine
collage. Where Syntax is found-media energy (torn paper, hard-offset shadow,
channel yellow, registration jitter), Editorial Mono is **calm restraint**: a
press review, a design-annual spread, a documentary lower-third. The engine and
Pipelines are identical; only the dress changes. This doc is what the Critic
verifies an `editorial-mono` Preset against — _not_ `syntax/aesthetic.md`.

> The same composition under both Packs must read as two different publications.
> Editorial Mono earns its place by proving the structure re-skins, not just the
> colour.

## Channel Voice

Considered, typographic, cool. The mood is "this was art-directed," not "this
was torn and taped." Quiet confidence over loud energy. Negative space is a
feature. Motion is settled and minimal; nothing bounces or jitters.

## Palette

Cool and low-temperature. Resolved through the Pack manifest, never inline.

| Role             | Value                 | Use                                                    |
| ---------------- | --------------------- | ------------------------------------------------------ |
| substrate / fill | `#e9eef3`             | cool off-white paper                                   |
| ink              | `#0f151c`             | near-black text, slightly cool                         |
| accent           | `#22d3ee`             | cyan — kicker chips, underlines, single-accent moments |
| cool slate       | `#c4d0dc` / `#aab9c9` | secondary surfaces, tape, rules                        |
| muted ink        | `#9aafc2`             | bylines, captions, de-emphasised mono labels           |

One accent, used sparingly. Cyan is a punctuation mark, not a fill. **No warm
hues** — no cream, no channel-yellow, no amber grit. Restrained, near-monochrome
cool with a single cyan note.

## Type System

The engine type system, worn editorially: a heavy display serif for headlines,
JetBrains Mono caps for the signature thread (kicker / byline / dateline). The
mono labels are the editorial substitute for Syntax's watermark — they carry
the "signed object" role without collage chrome.

Claimed as the Pack's core voice (the pack switch IS the font switch):
`font-treatment` is `'Playfair Display', 'EB Garamond', Georgia, serif` and
`font-label-treatment` is `'JetBrains Mono', ui-monospace, monospace`. Kinetic
display motion uses `Playfair Display Variable` across the real 400–900 `wght`
axis, with 700 as rest; ordinary typography keeps its static 600/700/800 cuts.
Document substrates (newspaper / paper) keep their hardcoded faces — substrate
physics, never Pack dress.

## Surface Treatment — flat, clean, structural

The defining inversion from Syntax is **structural, not just chromatic**:

- **No hard-offset shadow.** A hard-offset collage shadow is an Editorial Mono
  anti-pattern; this Pack's structural depth claims (`node.depth: 'none'`) sit
  flat. The newspaper was the literal structural re-skin proof
  (`newspaper.depth: 'none'` against Syntax's 12 px zine shadow) until
  [ADR-0056](../../adr/0056-newspaper-photographed-page.md) made it a
  photographed page with no depth claim under any Pack.
- **Clean printed edges.** No torn fiber, no irregular cut.
- **Cool-cast grain.** Where a grain texture exists (tape, grit), its fibres are
  cool (`washi-tape.grain-*` cool override) and low-warmth — a neutral film
  grain, not warm newsprint tooth.
- **Restraint over collage.** At most one tape strip, in cool slate, reading as a
  clipping pinned to a press review — never a busy multi-element collage stack.

## Motion Vocabulary Preferences

A subset of the shared vocabulary, biased to the calm end: **settled-place**
(found media settling into frame), **tape-down**, **stroke-draw** (a quiet
underline). Avoid: halo-bloom, brightness-reveal, anything bouncy or seeded-jittery.
A single restrained focal beat per piece; long, still holds for reading.

## Anti-Aesthetic — what Editorial Mono is _not_

- Not warm. No cream substrate, no channel-yellow, no amber grit.
- No hard-offset collage shadow (the flat card is the point).
- No torn edges, no registration jitter, no busy collage layering.
- No more than one accent colour active at a time.
- Not loud — if a move reads as "energetic," it belongs to Syntax, not here.
