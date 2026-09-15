# Sentry — Pack Aesthetic

The appearance reference for the **`sentry`** Pack — the first customer pack
promoted through the User Pack drafting lane ([ADR-0055](../../adr/0055-user-defined-packs.md),
[playbook § 7](../authoring-playbook.md)). Where [`syntax`](../syntax/aesthetic.md)
is warm paper, [`editorial-mono`](../editorial-mono/aesthetic.md) cool print,
[`crt-terminal`](../crt-terminal/aesthetic.md) phosphor glass, and
[`clean-light`](../clean-light/aesthetic.md) a white studio, Sentry is a
**night-mode product console**: a rich-black violet field with a soft wash,
panels a step lighter than the field behind neon hot-pink hairlines, white
Rubik, one accent word in hot pink, blurple UI furniture, lime as the signal
voice. The engine and Pipelines are identical; only the dress changes. This doc
is what the Critic verifies a `sentry` Preset against.

> This pack exists to prove the promotion lane: a look drafted live in the
> Pack control, then rebuilt from real pixels. Its structural claim is **edges
> are neon** — a card is defined by the hairline and the bloom it throws, never
> by a shadow it casts.

Intake 2026-09-01: `sentry.io/welcome` at 1440×900 @2×, its CSS custom
properties, computed styles of the nav, buttons, hero, and feature cards, and
eyedropped pixels of the rendered page. Every value below traces to one of
those.

## Channel Voice

Confident, playful, developer-first. The mood is "the console you actually
want to look at at 2 a.m." — dark, saturated, a little theatrical (the hero's
accent word tilts), never grim. Cards are panels with something happening in
them; the accent is loud because it appears once. Where Clean Light is
understated, Sentry is emphatic.

## Palette — a violet field, one pink, one lime

Resolved through the Pack manifest, never inline.

| Job                    | Value                         | Source                                                                      |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| field (rich black)     | `#1f1633`                     | `main` background, `--color-rich-black`                                     |
| field, lower (utility) | `#181225`                     | eyedropped lower sections, `--color-utility-black`                          |
| field wash (peak)      | `#2f1c48`                     | eyedropped hero glow centre                                                 |
| card / panel           | `#2e225c`                     | eyedropped "Errors" panel interior                                          |
| ink                    | `#ffffff`                     | headings, body, nav (computed)                                              |
| ink, secondary         | `#cfcfdb`                     | `--color-gray-3`                                                            |
| ink, tertiary          | `#79628c`                     | `--color-lt-violet`                                                         |
| accent (hot pink)      | `#fd44b0`                     | `--color-hot-pink`; the hero's accent word renders `#fd3ca7`                |
| signal / success       | `#c2ef4e`                     | `--active-accent-end`; the "Root Cause" and "Seer" voice                    |
| UI blurple             | `#6a5fc1`                     | snackbar pill background (computed), `--color-blurple`                      |
| dark blurple (rules)   | `#4e2a9a`                     | `--color-dk-blurple`; the UI bars inside panels                             |
| sunrise gradient       | `#fa7faa → #ff9691 → #ffb287` | primary CTA background-image (computed)                                     |
| highlighter            | `#e2abe0`                     | `--color-v-lt-purple`; the band multiplies, so it must be highlighter-light |

- **Saturated-hue budget (Q4):** pink, blurple, lime — the three the site
  itself keeps on screen at once. Peach appears only as a fourth data series.
- **The pink appears once.** One accent word, one hairline, one kicker. Two
  pink objects in a frame is the anti-pattern.
- **Lime is a verdict, not a decoration:** success, root cause, the signal
  found. Never a second accent.

## Type System

**One family, Rubik, everywhere.** The site's only web face; its hero cut
("Dammit Sans" bold) is custom and unavailable, so Rubik 700 carries display —
the same rounded geometric voice the body already speaks, at the weight the
headings measure.

- Display: Rubik 700, white, tight leading (the hero measures 1.2).
- Body: Rubik 400, white or gray-3.
- Labels / kickers / chrome: Rubik 500 **caps**, near-flat tracking (the nav
  and buttons measure 0.2px at 14px; claimed as `0.02em`). Buttons are 700
  caps.
- The accent word: Rubik 700 in hot pink, the one place the pink goes on type.
- Kinetic display motion uses `Rubik Variable` over the art-directed 300–700
  portion of its real `wght` axis, with 650 as rest. The face can technically
  reach 900; this Pack does not — the unavailable Dammit Sans hero is not
  imitated by making Rubik artificially heavier.

## Surface Treatment — the console panel

The structural claims, and the roles they exercise:

- **Edges are neon.** `depth-treatment` resolves to a hot-pink **glow rig**,
  and every card form role pairs a hairline border (`0.22cqmin` ≈ 2px on the
  site's 230px card) with a two-radius pink box-shadow. A shadow under a
  Sentry card is a pipeline bug by definition; so is a card without its
  hairline. The site draws these hairlines as pink-to-lime gradients; the
  pack claims the solid hot pink the role contract can express, and the bloom
  carries the rest.
- **Panels are a step lighter than the field** (`#2e225c` on `#1f1633`),
  never the field and never darker — the inverse of Clean Light's white-on-
  white separation by shadow alone.
- **The field has a wash.** Full-frame backdrops run from the hero's violet
  peak at the top to utility black at the bottom with a dark-blurple additive
  key; the type-hero backdrop scatters a lavender particle (the hero's star
  specks). Bands are zeroed — the wash is the atmosphere.
- **Rounding is quiet:** ~5% of the card (`1.2cqmin`, the site's 12px on
  230px); buttons round harder (8px on 40px) but the engine has no button.
- **Digital-clean.** `edge-treatment: clean`; `paper-grain.strength: none`;
  tape carries defensive values only; text has no shadow armor — white on the
  field needs none.
- **Display type stays crisp.** The neon belongs to cards, nodes, toasts. The
  hero and title-sequence glyphs carry no glow: a halo on a 4K word reads as
  smear, and the site's hero has none.

## Motion Vocabulary Preferences

Biased to the confident end of the shared vocabulary: **settled place** with a
firm snap (a panel arrives and stays), **stroke-draw** for rules and diagram
strokes (the plotter read), type reveals that land whole words rather than
letters. The site's hero tilts its accent word; the pack has no rotation role,
so the playfulness lives in timing, not geometry. Avoid: paper physics
(tape-down, tear, drift), phosphor decay exits, anything that wobbles — a
console does not wobble either.

## Anti-Aesthetic — what Sentry is _not_

- Not a dark mode of Clean Light: no drop shadows, no hairlines in gray, no
  single product blue.
- Not CRT: no scanlines, no phosphor, no curvature, no bloom on glyphs.
- No paper: no torn edges, no tape, no grain-as-tooth, no collage.
- No second pink and no rainbow — pink once, lime as verdict, blurple as
  furniture; peach only as a fourth series.
- Not corporate-quiet: if a panel arrives without its hairline, or the accent
  word is not pink, it is not this pack.

## Reference Reel

- `sentry.io/welcome` (measured 2026-09-01): the hero, the nav and CTA
  buttons, the "Errors / Replays / Logs / Traces" panels, the "Monitor in five
  lines" and "Root Cause" feature cards.
- The page's CSS custom properties (`--color-*`, `--active-accent-*`), the
  brand's own token names.
- The `sentry` User Pack drafted in the Pack control (2026-09-01) — the
  drafting lane this pack was promoted from; not ratification evidence
  (playbook § 7).
