# Syntax Pack — Channel Aesthetic

**The brand source of truth is the live overlay system: [`github.com/randyrektor/syntax-overlay`](https://github.com/randyrektor/syntax-overlay)** (ratified 2026-07-09). Everything the channel draws on screen follows that system. The previous version of this doc described a "torn-paper zine collage" voice — that was a **misrepresentation of the brand** and drove the corpus toward glossy/collage template looks; it is retired. Where this doc and the repo disagree, the repo wins.

This doc governs the **Syntax Pack** — one Pack of many. Nothing here is an engine rule; the engine stays general (quality/animation rubrics are aesthetic-neutral).

---

## Channel Voice

- **Flat, physical, decisive.** Cards are flat surfaces with visible borders and a chunky stepped shadow — like matte cardstock laid on a desk under hard light. Never glossy: no gradients-as-atmosphere, no lens flares, no glow, no gaussian ambience.
- **Opinionated and direct.** The overlay states the point. No hedged copy, no "in this video we'll explore."
- **Warm dark, one loud yellow.** Warm near-blacks carry the frame; `#ffd54a` yellow is the single loud voice, used decisively (a chip, a separator, an active cue) — not sprayed.
- **Mono chrome voice.** Space Mono is the channel's interface voice — tags, labels, kickers, tickers, stamps. Space Grotesk is the display voice — names, titles.
- **Substrate ≠ chrome.** A found document (newspaper, tweet, research paper, photo) keeps its own physics — that's verisimilitude. Everything the _channel_ adds on top (cards, chips, tickers, lower-thirds, diagram strokes) is this flat-card system.

---

## Palette

The repo's tokens, verbatim. These are the channel colors — deviate only inside a found-document substrate that carries its own ink.

| Token         | Value     | Use                                               |
| ------------- | --------- | ------------------------------------------------- |
| Background    | `#0e0e0d` | Full-frame fields, dark substrates                |
| Card          | `#141413` | Card/plate surfaces                               |
| Border        | `#454441` | Card borders (2px at 1080 / 4px at 4K)            |
| Shadow        | `#050504` | The stepped shadow stack                          |
| Accent        | `#ffd54a` | THE yellow: chips, separators, active cues, focus |
| Success       | `#3dd816` | Positive marks, live/on-air cues                  |
| Danger        | `#ff474e` | Negative marks, alerts, the pulse dot             |
| Text          | `#f7f6f2` | Primary ink on dark                               |
| Byline        | `#c9c6bc` | Secondary text on cards                           |
| Muted         | `#8a8883` | Tertiary/chrome labels                            |
| Ink-on-yellow | `#0a0a09` | Text on accent plates                             |

**Saturated-hue cap (Q4)** still binds: ≤ 3 saturated hues visible at once — yellow is the default single slot; green/red enter only with a semantic job.

**Never:** pastels, purple-tinted substrates, pure RGB primaries, Apple-keynote gradient washes, amber-warm "cinematic" tints (`#f4a85e`-family reads as generic template, not Syntax).

**Marks are the one exception:** the physical highlighter/pen marks drawn over document substrates keep their measured-from-footage colors (highlighter `#fabf47` ~0.62 alpha — see the web-document canon). A highlighter is a pen on the document, not channel chrome.

---

## Type System

Two faces, fixed jobs (Q18's 2-family cap holds; a found-document substrate carrying its own face is the only third):

- **Space Grotesk** — display: names, titles, headlines on cards. 700 for primary (tight, `-0.02em`), 500 for supporting.
- **Space Mono** — chrome: kickers, tags, tickers, stamps, diagram labels, code. 700 uppercase `.08em` on chips; 400 for quiet labels.

Both are self-hosted via `@fontsource` in `src/lib/packs/syntax/fonts.ts`. Kinetic display motion uses the separate `Space Grotesk Variable` face over the real 300–700 `wght` axis, with 650 as the Pack rest; ordinary typography keeps the static 500/700 cuts. (Operator Mono is retired from this doc — the repo uses Space Mono.)

---

## The Card System

The signature construction, from the repo (values ×2 for the 4K frame):

- **Plate:** `#141413`, fully opaque. Never a scrim gradient.
- **Border:** `4px solid #454441` (4K). Always visible — the border is part of the look.
- **Radius:** `16px` (4K). Corners round; they do not tear.
- **The stepped shadow:** ten stacked hard offsets, `2px 2px 0 0 #050504` through `20px 20px 0 0 #050504` (4K). This is THE depth treatment — flat, physical, unmistakable. No gaussian shadows on chrome, ever.
- **Type on the card:** Grotesk 700 title in `#f7f6f2`, byline in `#c9c6bc`, optional Space Mono kicker in `#ffd54a` above.
- **Avatar treatment** (when a piece carries one): the portrait bleeds outside the card boundary, hard drop-shadowed (`3px 4px 0` dark + a 1px light lip) — same flat physics.

## Chrome Vocabulary

- **Chip / tag:** `#ffd54a` plate, `#0a0a09` ink, Space Mono 700 uppercase `.08em`, square-ish with the system radius, `2px #0a0a09` divider when butted against content. (The ticker tag is the canonical chip.)
- **Pulse dot:** `#ff474e` circle with an opacity/box-shadow pulse — the "live" cue.
- **Separator:** the yellow diamond `◆` between ticker items.
- **Bars/tickers:** full-width flex bars on the card construction (border + stepped shadow), content scrolling linear.

## Diagram strokes

Clean printed rules — `wobble: 0`. Scribbly/hand-jitter strokes are **not** the channel's line quality (distinct from the torn-paper question; both retired 2026-07-09). Stroke color rides the composition ink; accent-inked elements (`ink: 'accent'`) go `#ffd54a`.

---

## Substrate Vocabulary

The found documents the channel quotes. Substrates are **verisimilar artifacts** — they keep their own physics and typography (a tweet looks exactly like Twitter; a newspaper looks like newsprint). The channel layer over them is the card system above.

- **Web documents** (Twitter/Reddit/GitHub/YouTube/news/iMessage): pixel-faithful mocks (see ADR-0030/0031 and the web-document canon).
- **Paper documents** (research paper, newspaper, letter): real print physics — their own serif/slab faces, their own ink. The newspaper is _photographed, not clipped_: a full-bleed crop into a grey broadsheet page — folio line and heavy rule, tight bold grotesque headline, bold-caps byline, justified serif columns with column rules, lens vignette, grain, soft corners — with one highlighter stroke as the only mark and no page edge ever in shot ([ADR-0056](../../adr/0056-newspaper-photographed-page.md); plates in `docs/inspo/newspaper/`). Torn edges remain _plausible on the other physical documents being quoted_; they are **not** channel chrome and never appear on cards/chips/lower-thirds.
- **Photographs:** real photographic substrates, vignetted for legibility where text rides them; the photo must remain readable AS a photo (R2 substrate-resolution rule).
- **Marks on substrates:** highlighter/underline/circle are physical pens on the document — hand energy lives HERE (stroke-draw, slight wobble, overshoot), and only here.
- **Tape is a dressing, not chrome** (Scott, 2026-07-09): the washi-tape capability stays in the engine as a feature, but under Syntax it may only appear as dressing on a quoted physical document (a taped-down clipping). A standalone tape chip is not the brand.

---

## Motion Vocabulary

The repo's motion is fast, decisive, flat — enter ~420ms strong decelerate, exit ~350ms accelerate (G6-compatible). Preferences:

**Lean in:**

- **settled-place** for cards (small overshoot = "placed with intent").
- **stroke-draw** for marks and diagram rules (ink saturates along the path).
- **brightness-reveal** for spoken-content text over substrates.
- **counter/ticker rolls** for numbers (the odometer is on-brand chrome).
- **Chip pop** — a chip lands slightly late after its card, `sharp`.
- **Variable-weight resolve** for display words — thin-to-650 mass arrives decisively while geometry stays restrained; never substitute horizontal scaling or synthetic bold.

**Lean out (wrong for this channel):**

- Anamorphic flares, glows, light sweeps — all gloss.
- Gaussian-blur atmosphere; soft photographic shadows on chrome.
- Full-frame camera moves on chrome compositions (substrate/depth pieces may camera; a ticker never does).
- Bouncy ease on factual content; typewriter pop-in per word.

---

## Anti-Aesthetic

Reads wrong for **this channel specifically**:

- **Gloss of any kind** — scrim gradients, flares, rim glows, glassy plates. The channel is matte.
- **Torn-paper / zine-collage chrome** — retired misrepresentation. Tears may exist only inside a quoted physical document.
- **Scribbly/wobbly line work on chrome or diagrams** — hand energy belongs to marks on documents only.
- **Pastel or amber-warm "cinematic" palettes** — the warm blacks + one loud yellow are the identity.
- **Purple-tinted substrates** — not in the brand system.
- **Compositions with no mono** — Space Mono chrome is the signature thread.
- **Gaussian shadows on cards** — the stepped stack IS the depth treatment.
- **Generic stock motion-template moves** — swooshes, glassy wipes, light leaks.

When in doubt: _would this pass as a native element of the syntax-overlay live system?_

---

## Reference Reel

| Source                                                                                    | Take from it                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`syntax-overlay`](https://github.com/randyrektor/syntax-overlay) `lower-thirds.html`     | The card: plate, border, radius, stepped shadow, Grotesk/byline hierarchy, avatar bleed |
| [`syntax-overlay`](https://github.com/randyrektor/syntax-overlay) `ticker.html`           | The chip/tag, pulse dot, diamond separators, bar construction, motion curves            |
| [`syntax-overlay`](https://github.com/randyrektor/syntax-overlay) `featured-comment.html` | Quoting external content inside the card system                                         |
| `docs/inspo/newspaper/*.png`                                                              | Substrate physics for quoted print documents (substrate, not chrome)                    |
| `docs/inspo/pullquote/*.png`                                                              | Text-over-photo reveals (substrate register)                                            |
