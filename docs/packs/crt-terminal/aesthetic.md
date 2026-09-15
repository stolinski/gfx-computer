# CRT Terminal — Pack Aesthetic

The appearance reference for the **`crt-terminal`** Pack — the **emissive** third
point of the pack triangle. [`syntax`](../syntax/aesthetic.md) is warm reflective
paper (zine collage, hard-offset shadow); [`editorial-mono`](../editorial-mono/aesthetic.md)
is cool reflective print (flat, art-directed restraint); CRT Terminal is **light,
not pigment**: an 80s phosphor terminal — VT100 / IBM 5151 register — where every
element is a small green-glowing screen. The engine and Pipelines are identical;
only the dress changes. This doc is what the Critic verifies a `crt-terminal`
Preset against.

> This pack exists to stress the roles a color swap never touched: **depth is
> glow, not shadow. Grain is scanline, not paper tooth. Edges are hard pixels,
> not torn fiber.** If a piece re-skins under CRT and still reads broadcast, the
> Pack contract is real.

Register references: IBM 5151 monochrome display, DEC VT100, Apple II monitor,
MU/TH/UR 6000 (_Alien_), WOPR terminals (_WarGames_). Period-_serious_, not
retro-game.

## Channel Voice

Precise, machine-calm, a little ominous. The mood is "mission console," not
"arcade cabinet." Uniformity is the personality: one type voice, one color at
several intensities, everything on the character grid. Where Syntax is
hand-made and Editorial Mono is art-directed, CRT Terminal is **machine-made** —
nothing is placed casually; everything aligns.

## Palette — one phosphor, several excitations

Green phosphor (P1 family) on near-black glass. There is **one hue**; hierarchy
comes from _intensity_ (how hard the phosphor is driven), never from a second
color. Resolved through the Pack manifest, never inline.

| Role              | Value     | Use                                                    |
| ----------------- | --------- | ------------------------------------------------------ |
| substrate / glass | `#070b08` | near-black screen glass, faint green cast              |
| phosphor ink      | `#45ff6e` | primary text and strokes — the driven phosphor         |
| hot core          | `#d9ffe0` | white-green overdriven centers (title moments, cursor) |
| dim phosphor      | `#1e8f3d` | secondary text, rules, de-emphasised labels            |
| ghost             | `#0f3a1c` | persistence residue, faint grid lines, dividers        |

- **Emissive, not printed:** light values glow on dark glass — the exact
  inversion of both reflective packs. The "ink" is the brightest thing in frame.
- **No second hue.** No amber (adjacent to Syntax yellow), no cyan (Editorial
  Mono's mark), no warm anything. Alerts/accents are _brighter or blinking_
  phosphor, not a different color.

## Type System

**Modern mono wearing the phosphor** — the period feel comes from the _material_
(glow, persistence, grid), never from pixelated glyphs. One family everywhere:
the engine's mono stack (JetBrains Mono — already bundled for the Syntax
kicker thread), all weights, generous tracking in caps for labels. Crisp at 4K;
A+ text is non-negotiable (bitmap faces read retro-game at 3840×2160 and fail
long-body readability — rejected).

- Titles: mono, hot-core intensity, optional character-grid reveal.
- Body: phosphor ink, looser leading (scanlines need air between lines).
- Labels/kickers: dim phosphor caps — the terminal's status-line voice.
- Kinetic display motion uses `JetBrains Mono Variable` across its real 100–800
  `wght` axis, with 600 as rest. The moving outline remains crisp; scanline and
  phosphor material supply the period character, never stepped static cuts.

## Surface Treatment — the screen material

The defining structural inversions, and the roles they exercise:

- **Depth is glow.** `*.depth` resolves to a phosphor **bloom halo**, never a
  drop shadow — a shadow implies an object above paper; a screen has neither.
  Intensity scales with the element's excitation (hot core blooms widest).
- **Edges are hard.** `edge-treatment: none` — pixel-crisp element boundaries,
  no torn fiber, no soft feather. The character grid is the only permissible
  edge texture.
- **Grain is scanline.** The grain/material roles resolve to a subtle horizontal
  scanline raster + faint phosphor triad shimmer _inside_ element pixels — a
  screen texture, not paper tooth. Low contrast; visible at pause, invisible in
  motion.
- **Persistence.** Phosphor decay is the pack's signature material behavior:
  moving/exiting elements may leave a brief ghost-intensity trail (deterministic,
  frame-driven — never wall-clock).
- **Pointer.** `cursor-trail.pointer` resolves to a **block cursor** (▮), with
  the trail as phosphor persistence.

### Screen scope — per-element emissive; full-frame only when opaque

- **Transparent overlays:** each element is its own small emissive screen —
  glow, scanlines, persistence live **inside the element's pixels** (the
  ADR-0030 emissive-screen shaderPass pattern). The footage underneath is never
  treated: it isn't ours.
- **Opaque segments/bumpers:** the pack's chrome appends the physical
  `crt-tube` effect — a flat-glass beam raster (gaussian scanlines that swell
  on bright strokes), subtle shadow-mask texture, rounded-glass bezel with
  inner shadow, and bright-pass halation — the whole frame _is_ the terminal.
  The chrome dial must keep small dim-phosphor text above the G5 floor and
  hairline form dress must span ≥1 raster pitch or the beam nulls it.
- **No curvature, ever.** Barrel distortion fights composition geometry,
  safe-areas, and reflow; the flat-glass late-period CRT is the claim — the
  chrome runs `curvature: 0` even though the general `crt-tube` effect
  supports it.

## Motion Vocabulary Preferences

A subset of the shared vocabulary, biased to the machine end: **type-on /
character reveal** (the native terminal entrance), **sharp snaps** (`sharp`
ease — instant excitation, phosphor-decay settle), **stroke-draw** (a plotter
sweep), cursor-blink beats as punctuation. Phosphor persistence gives exits
their character: elements _decay_ rather than slide away. Avoid: bouncy,
tape-down, settled-place paper physics, anything hand-made or jittery — a
machine does not wobble.

## Anti-Aesthetic — what CRT Terminal is _not_

- Not retro-game kitsch: no bitmap/pixel fonts, no CP437 box-art, no rainbow
  ANSI palettes, no chromatic "glitch" abuse.
- No second hue — one phosphor at several intensities. Amber and cyan are other
  packs' property.
- No shadows of any kind — depth is bloom. A drop shadow under CRT is a
  pipeline bug by definition.
- No paper artifacts: no torn edges, no tape, no grain-as-tooth, no collage.
- No curvature / barrel distortion; no full-frame treatment on transparent
  overlays (the footage is not ours to scanline).
- Not nostalgic-cute: if a move reads "arcade," it's wrong; the register is
  mission console.
