# Kinetic type toolbox

**Kind:** domain
**Slug:** kinetic-type-toolbox
**Pack:** syntax
**Verification preset:** kinetic-type-field
**Progress:** Variable-weight substrate, static `kinetic-type-field-static-fixture`, and independent opacity/spatial/normalized-weight tracks with the moving `kinetic-type-field-motion-fixture` shipped 2026-09-15; Motion Beats, tracking, and the deliverable remain active.

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

The current moving proof is 6 seconds at 30 fps; the Motion Beat slice will replace its raw millisecond landmarks with named Beats. Every visual value derives from the explicit frame timestamp.

- The field treats typography as full-frame graphic material: display words deliberately crop at frame edges, connective words lock to their letterforms, and no universal title-safe inset cages the composition.
- One system, one axis, one break. Every word is `start`-anchored on the physical left frame edge, so Pack face widths change only where a word ends, never where it begins. `TYPE` fills the top of the frame; `CAN` sits as a small eyebrow; the focal verb owns a fixed bottom slot. Nothing slides across open frame: every entrance and exit is a masked reveal through the word's own line box, letter by letter (`glyphStagger` 20–40 ms, forward), with `tracking` tightening from slightly open to rest as the word lands. `TYPE` never moves — it rises once in hairline, strikes to the Pack maximum on the first beat, and pulses weight on each later beat.
- Verbs swap inside one shared mask: the outgoing word leaves upward glyph by glyph as the incoming word rises beneath it, one wave passing left to right. Support words rise the same way at eyebrow scale instead of hard-cutting.
- The third phrase is the break. `IS THE` rises into its own eyebrow and `COMPOSITION` rises letter by letter onto the bottom margin, set to the measure of the widest Pack face (Playfair, 6.95 em) so the whole word always fits with a right margin equal to the top and bottom margins. `TYPE` holds the top-left corner; the final frame is a top-and-bottom poster lockup with deliberate space between. `TYPE` recomposes in weight, not position: it falls back to hairline while `COMPOSITION` lands black.
- Vertical is its own art direction, not the horizontal layout letterboxed: a tight, heavy lockup that runs nearly edge to edge in width and sits in the vertical centre, clear of platform chrome.
- Timing sits on a 500 ms grid. Verb holds shorten (1.0 s, then 0.85 s) into the longest hold on the final phrase (1.6 s), then a staggered exit upward through the masks: `COMPOSITION` and `IS THE` first, `TYPE` last. No Kinetic Word geometry uses an overshooting or bouncy ease.
- Every arrival lands its normalized `weight` on `sharp` as its reveal finishes settling on `sharp`; tracking releases on `smooth`. Weight and geometry never share one indiscriminate ease.
- Word visibility enters satisfy G6's 250–400 ms band; the complete field exits over 180–320 ms. The final phrase holds long enough to read before exit.
- Human review judges intentional cropping and phrase recognition. The deterministic probe requires at least 55% of each visible word's bounds to remain in-frame, at least one word in every phrase hold to meet or cross a physical frame edge, and persistent `TYPE` to recompose between holds by placement or by a Pack-mapped weight change; it does not impose the generic 5% title-safe rectangle on this full-frame bumper.
- One focal word owns each phrase. No generic gradient, swoosh, animated underline, typewriter crawl, random physics, or continuous wall-clock loop.

## Channel chrome notes

Under Syntax, the proof uses the flat warm-black Pack field, Space Grotesk's real variable-weight form, Space Mono only for an optional small beat/index label, off-white ink, and one decisive yellow accent word at a time. There is no card, gloss, glow, gaussian atmosphere, or stepped shadow: the typography itself carries the piece.

The Preset stores only semantic ink/accent selections and normalized weight. Every other catalog Pack supplies its own field, ink, accent, display face, and real usable weight range. The composition does not name a Pack-specific family or raw OpenType coordinate. Effects are omitted unless exact renders prove one restrained support is needed.

## Engine work required

- ✅ Add the static Type Field group on `plain`: bounded word pool, ordered phrases, focal-word references, strict semantic validation, and shared Block identity. Phrase-to-Beat bindings remain with the Motion Beat slice.
- Add top-level named Motion Beats with absolute-millisecond and beat-relative keyframe addressing.
- ✅ Register the `kinetic-word` Block Pipeline with strict content, placement, orientation, appearance, Identity Spec, native DOM renderer, readable authority, Timeline rows, Inspector editing, and direct canvas manipulation.
- ✅ Extend generalized Block channels with normalized `weight`, `x`, `y`, `scale`, `rotation`, and `opacity`; add complete per-orientation spatial-track snapshots. `tracking` remains deferred.
- ✅ Supply a real variable-weight display face and art-directed `wght` mapping from every catalog Pack without changing ordinary static typography pixels. Validate User Pack claims against the existing vendored Google Fonts and materialized-face authorities.
- Extend Timeline identity, rows, beat markers/snapping, channel diamonds, Inspector controls, canvas selection/direct manipulation, undo/redo, and critical-frame enumeration. Rows, diamonds, scoped controls, nonzero-playhead write-back, and gesture undo ship; beat markers/snapping remain.
- ✅ Add or extend shared Operations in the `layer`, `content`, `placement`, `appearance`, and `motion` families. Update the operation inventory and WebMCP schemas; never add raw patch or GUI gesture tools. Motion Beats will add their own bounded membership/reference operations.
- Add schema/semantic ceilings, Pack/axis validation, deterministic interpolation, layout-contract authority, pixel diagnostics, agent evals, and the reference Preset/poster.
- Update `docs/CONTEXT.md`, `docs/engine-architecture.md`, `docs/preset-format.md`, `docs/animation-rubric.md`, `docs/quality-rubric.md`, and authoring workflow documentation as each boundary lands.

## ADR required?

`already-filed: 0064-kinetic-type-word-fields`

## Open questions

None.

## What 'done' looks like

The schema, `kinetic-word` Block Pipeline and Identity Spec, variable-font/Pack resolution, Motion Beats, independent channels, semantic phrases, orientation snapshots, GUI, revisioned Operations/WebMCP tools, Timeline/canvas authoring, deterministic verification authorities, docs, and `src/lib/presets/kinetic-type-field.json` are complete. The exact reference Preset passes native 3840×2160 horizontal and 2160×3840 vertical renders under every catalog Pack, including critical transition frames, layout contracts, random-seek/replay determinism, and R/Q/G checks. Its exact evidence receives human aesthetic approval. The Brief is retired only in the classified closeout change after that complete boundary lands.
