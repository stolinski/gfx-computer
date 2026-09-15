# Kinetic type toolbox

**Kind:** domain
**Slug:** kinetic-type-toolbox
**Pack:** syntax
**Verification preset:** kinetic-type-field

## Pitch

Make typography a composition subject rather than text with an entrance effect. A bounded Type Field lets creators arrange stable Kinetic Word Blocks, animate each word independently against shared Motion Beats, carry important words across changing phrases, and make variable weight strike faster than the geometry settles. The result should support title sequences, bumpers, and transparent typographic overlays at GFX's quality bar without becoming a general node compositor.

## Surface(s) involved

V1 adds `surface.typeField` to the registered `plain` Surface only. A Preset with `backgroundFill: "pack"` is a full-frame bumper; omitting the fill preserves transparent output. The group renders registered `kinetic-word` Blocks in the Block Layer. No new Surface, Overlay, Layer, Dimensional Stage branch, or orientation-specific Preset is introduced.

## Content sample

The verification Preset uses this exact ordered phrase content:

1. `TYPE CAN MOVE`
2. `TYPE CAN BECOME`
3. `TYPE IS THE COMPOSITION`

`TYPE` is one stable word across all three phrases. `CAN` persists through the first two. `MOVE`, `BECOME`, `IS`, `THE`, and `COMPOSITION` are supporting turnover words. The focal words in order are `MOVE`, `BECOME`, and `COMPOSITION`.

## Motion plan

The composition is 5.2 seconds at 30 fps with three named Motion Beats after the initial establish. Every visual value derives from the explicit frame timestamp.

- The first phrase gathers from a loose field into a readable line. Words enter over 300–380 ms with `smooth` geometry and no bounce.
- At the second beat, persistent words travel to their next positions while `MOVE` recedes and `BECOME` arrives. Spatial tracks begin with a restrained 40–70 ms counter-motion, settle over 280–360 ms, and hold as an intentional still.
- At the third beat, `TYPE` remains the continuity anchor but is free to cross the frame; `IS THE COMPOSITION` forms the final hierarchy.
- At each beat the focal word's normalized `weight` hits on `sharp` over roughly 90–140 ms, then releases toward the Pack's rest over 160–240 ms while position finishes settling. Weight and geometry never share one indiscriminate ease.
- Word visibility enters satisfy G6's 250–400 ms band; the complete field exits over 180–280 ms. The final phrase holds long enough to read before exit.
- Horizontal and vertical share phrases, beats, opacity, weight, and tracking. Complete vertical base/spatial snapshots recompose the same words into the safe middle column rather than cropping the horizontal field.
- One focal word owns each beat. No generic gradient, swoosh, animated underline, typewriter crawl, random physics, or continuous wall-clock loop.

## Channel chrome notes

Under Syntax, the proof uses the flat warm-black Pack field, Space Grotesk's real variable-weight form, Space Mono only for an optional small beat/index label, off-white ink, and one decisive yellow accent word at a time. There is no card, gloss, glow, gaussian atmosphere, or stepped shadow: the typography itself carries the piece.

The Preset stores only semantic ink/accent selections and normalized weight. Every other catalog Pack supplies its own field, ink, accent, display face, and real usable weight range. The composition does not name a Pack-specific family or raw OpenType coordinate. Effects are omitted unless exact renders prove one restrained support is needed.

## Engine work required

- Add the Type Field group: bounded word pool, ordered phrases, focal-word references, and phrase-to-Beat bindings on `plain`.
- Add top-level named Motion Beats with absolute-millisecond and beat-relative keyframe addressing.
- Register the `kinetic-word` Block Pipeline with strict content, placement, orientation, appearance, Identity Spec, native DOM renderer, and readable authority.
- Extend generalized Block channels with `weight` and `tracking`, keeping `x`, `y`, `scale`, `rotation`, and `opacity`; add complete per-orientation spatial-track snapshots.
- Supply a real variable-weight display face and art-directed `wght` mapping from every catalog Pack without changing ordinary static typography pixels. Validate User Pack claims against the existing vendored Google Fonts and materialized-face authorities.
- Extend Timeline identity, rows, beat markers/snapping, channel diamonds, Inspector controls, canvas selection/direct manipulation, undo/redo, and critical-frame enumeration.
- Add or extend shared Operations in the `layer`, `content`, `placement`, `appearance`, and `motion` families. Update the operation inventory and WebMCP schemas; never add raw patch or GUI gesture tools.
- Add schema/semantic ceilings, Pack/axis validation, deterministic interpolation, layout-contract authority, pixel diagnostics, agent evals, and the reference Preset/poster.
- Update `docs/CONTEXT.md`, `docs/engine-architecture.md`, `docs/preset-format.md`, `docs/animation-rubric.md`, `docs/quality-rubric.md`, and authoring workflow documentation as each boundary lands.

## ADR required?

`already-filed: 0063-kinetic-type-word-fields`

## Open questions

None.

## What 'done' looks like

The schema, `kinetic-word` Block Pipeline and Identity Spec, variable-font/Pack resolution, Motion Beats, independent channels, semantic phrases, orientation snapshots, GUI, revisioned Operations/WebMCP tools, Timeline/canvas authoring, deterministic verification authorities, docs, and `src/lib/presets/kinetic-type-field.json` are complete. The exact reference Preset passes native 3840×2160 horizontal and 2160×3840 vertical renders under every catalog Pack, including critical transition frames, layout contracts, random-seek/replay determinism, and R/Q/G checks. Its exact evidence receives human aesthetic approval. The Brief is retired only in the classified closeout change after that complete boundary lands.
