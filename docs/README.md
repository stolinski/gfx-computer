# GFX

GFX is a motion-graphics engine built on a web stack — WebGPU through TypeGPU, live
HTML composited into the canvas, GSAP for timing. It renders two kinds of piece at
native 4K: **transparent overlays** you composite over footage in an edit, and
**full-frame segments** — bumpers, title cards, stat beats — that stand on their own.

It is local-first. There is no service to sign into: you run the engine on your own
machine, and the pieces you make stay there.

Start at [Getting started](getting-started.md) — a clean clone to a frame on screen to
an exported file.

## How a piece is put together

A composition is a **Preset**: one JSON document in the `gfx@1` format. A Preset stacks
five **Layers**, each drawn by a **Pipeline** from a registry.

| Layer | What it draws |
| --- | --- |
| Surface | The scene the piece lives on — paper, a web document, an iMessage thread. |
| Block | Content primitives — quotes, stats, timelines, diagrams, charts. |
| Annotation | Hand-drawn marks — circles, underlines, arrows, highlights. |
| Overlay | Chrome above the content — tape, badges, lower-third framing. |
| Effect | Full-frame WGSL passes — grain, depth, light, bloom. |

What a piece *says* lives in the Preset. What it *looks like* does not: appearance comes
from a **Pack** — palette, type, texture, motion feel — that swaps underneath the same
composition. The engine is general; the look is not.

Overlays render transparent by default. A composition that declares a background fill
becomes a full-frame piece instead, which changes how it is classified and encoded on
the way out.

## One composition, both shapes

Every Preset renders horizontal (3840×2160, for YouTube) and vertical (2160×3840, for
TikTok and Reels), at native resolution with each platform's safe areas respected.
Switching orientation reflows the same piece rather than opening a second copy of it.
*How* a piece reflows is a design decision; *whether* it does is not.

Animation is driven from an explicit frame timestamp, never from wall-clock time, so a
scrubbed preview and an exported file show the same pixels at the same moment.

## Where to go next

- [Getting started](getting-started.md) — what to install, how to run the engine, and
  the one Chrome flag that stands between you and a rendered frame.
- [Glossary](CONTEXT.md) — Preset, Layer, Pack, Role, Pipeline, and the rest of the
  vocabulary, defined once.
- [Preset format](preset-format.md) — the `gfx@1` JSON contract, field by field.

## Packs

Five Packs ship with the engine, each with its own palette, type system, surface
vocabulary, and motion feel. Swapping one for another redresses a composition without
rewriting it.

- [Syntax](packs/syntax/aesthetic.md) — the house channel aesthetic.
- [CRT Terminal](packs/crt-terminal/aesthetic.md) — phosphor, scanlines, glow.
- [Editorial Mono](packs/editorial-mono/aesthetic.md) — print-desk restraint.
- [Clean Light](packs/clean-light/aesthetic.md) — bright, plain, unfussy.
- [Sentry](packs/sentry/aesthetic.md) — violet-black, hot pink, and crisp Rubik.
