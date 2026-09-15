# ADR-0063 — Kinetic type is an authored Block field with independent tracks

## Status

**Canon.** The Pack-mapped variable-weight substrate and static Type Field authoring substrate shipped 2026-09-15 under Dex epic `fnwlsz1g`. Independent Kinetic Word tracks, named Motion Beats, animated validation, and the reference deliverable remain designed implementation work governed by this ADR and [`../briefs/kinetic-type-toolbox.md`](../briefs/kinetic-type-toolbox.md).

Date: 2026-09-15

Builds on: [ADR-0011](0011-text-animation-orchestration.md) (slot-bound TextAnimation), [ADR-0023](0023-pack-is-appearance-only.md) (appearance only), [ADR-0035](0035-generalized-keyframes-and-cascade.md) (composition-owned channels), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (one Preset across Packs and orientations), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (shared Operations), and [ADR-0055](0055-user-defined-packs.md) (validated font declarations)

## Context

GFX can animate a static text slot through 26 catalogued text effects. Most are one enter endpoint, one exit endpoint, and a stagger over SplitText units. The layout-aware families push words into one final line, but a word is not an authored entity: it has no stable composition identity, placement, Timeline lane, independent keyframe tracks, semantic relationship to later phrases, or variable-font axis channel. `TextAnimation` remains useful for revealing ordinary titles, labels, and bodies; making it impersonate an authored title sequence would mix content, layout, and motion into one effect selector.

High-end kinetic typography needs a different unit of authorship. A small vocabulary of words must persist across several readable phrases while supporting words enter and leave. Each word needs direct spatial control, typography needs to change on a different rhythm from geometry, and the complete result must remain frame-deterministic, Pack-neutral, and intentionally reflowed at both native orientations.

The tempting alternatives all fail a project boundary:

- More Text Effect ids still animate one static slot and turn a structural gap into a longer canned menu.
- Diagram `label` Blocks carry document-label semantics and cap-height bands; scaling them into hero words would collapse two identities.
- Auto-layout, scene snapshots, or seeded physics take placement decisions away from the author. They may become authoring shortcuts later, but they are not the model.
- Arbitrary per-character nodes, CSS properties, expressions, paths, or curve editors recreate a general compositor GFX explicitly rejects.
- Raw OpenType axis numbers bake one font's coordinate system into the Preset and fail as soon as the Pack changes.

## Decision

### A Type Field is a bounded Block group on a `plain` Surface

`surface.typeField` is an optional strict group supported only by the `plain` Surface in v1. It contains:

- a stable pool of **Kinetic Word Blocks**;
- ordered semantic phrases, each referencing word ids in reading order and naming one focal word;
- references from those phrases to composition **Motion Beats**.

It is not a Surface, Overlay, sixth Layer, scene tree, or alternate composition. `backgroundFill: "pack"` makes the same plain-Surface composition a full-frame bumper; omitting it keeps the ordinary transparent output contract.

A phrase is semantic authority, not auto-layout. It says what the viewer must be able to read at a beat. Reusing a word id across phrases is what preserves continuity. The renderer and verification layer may check phrase visibility, order, and focal hierarchy at that beat, but they never invent positions.

### Each word is a first-class Block

`kinetic-word` is a registered graphic Block Pipeline. One Block owns one trimmed word token, a stable id, a display/support role, an ink/accent role selection, and normalized base placement. Punctuation may stay attached; v1 does not expose per-character children.

Base placement is the center point, scale, and rotation. Like Diagram geometry, it has a shared value plus optional complete horizontal and vertical snapshots. Each word is selectable on the canvas and has one Timeline row, one Inspector, one Block identity, and one shared undo/history identity.

The initial ceilings are 16 words, 8 phrases, 8 Motion Beats, 8 words per phrase, 32 Unicode code points per word, and 24 keyframes per channel. Validation rejects overflow rather than truncating it.

### Independent tracks use a closed channel vocabulary

A Kinetic Word Block may author:

- spatial channels: `x`, `y`, `scale`, `rotation`;
- visibility: `opacity`;
- typography: normalized `weight` and `tracking`.

The four existing eases remain the only curves. There are no expressions, arbitrary CSS properties, masks, motion paths, free handles per glyph, or per-character tracks. Declaring channels transfers motion ownership from Pipeline defaults exactly as ADR-0035 defines.

Spatial tracks resolve from the active orientation's base placement. An optional orientation override replaces the complete spatial-track group for that target; `opacity`, `weight`, `tracking`, phrase identity, and beat relationships remain shared. This permits a genuine tall-frame recomposition without an orientation-specific Preset.

### Motion Beats are named time anchors, not animation owners

`state.motionBeats` is a bounded, ordered list of stable ids at exact milliseconds from composition start. A Kinetic Word keyframe may use an absolute `atMs` or `{ atBeat, offsetMs }`. Beat-relative keyframes move when their beat moves; independent tracks otherwise remain independent. A phrase binds to one beat so semantic verification knows which words and focal point should be readable there.

The Timeline shows and snaps to Motion Beats. Operations add, move, and remove them atomically. Removing a referenced beat is refused with the referencing phrase/keyframes named; no operation leaves dangling references.

The default choreography is **dual-speed editorial**: geometry anticipates and settles over the ordinary 250–400 ms motion band, while variable weight makes a shorter beat-centered impact and releases to rest. These are authoring defaults copied into the Preset, not runtime magic and not Pack data.

### Variable weight is semantic motion over Pack-owned real axes

V1 adds only normalized `weight` because `wght` is the one real variable axis shared by every current catalog Pack's primary display family. A value in `[0,1]` maps through the active Pack's declared, art-directed minimum/rest/maximum and the exact variable face the Pack supplies. The face and usable axis range are appearance; the keyframes, timing, and ease remain composition motion. This does not create a motion Role.

Every catalog Pack must supply and preload a real variable-weight display face for `kinetic-word`; ordinary existing typography keeps its current static faces so the new substrate cannot silently change corpus pixels. User Pack axis claims validate against the vendored Google Fonts metadata and materialized face descriptors. A Pack with no real `wght` capability renders the word at its declared rest and reports the unavailable channel correctively; it never synthesizes a cut.

`wdth`, `slnt`, `opsz`, `GRAD`, and custom axes are deferred. An axis joins the Preset vocabulary only after every catalog Pack used by a deliverable supplies a real mapped capability or the specific composition avoids that axis. GFX never substitutes `scaleX`, fake italic, or synthetic weight for a missing axis.

### GUI and agents author the same field through Operations

Block membership belongs to `layer`; word and phrase text/reference content belongs to `content`; base geometry belongs to `placement`; ink/hierarchy and font-axis capability belong to `appearance`; Beats and tracks belong to `motion`. The operation inventory records the exact longest-pointer ownership.

The static substrate adds six Type Field operations under those existing families because first/last-word parent lifecycle and phrase/reference validity must remain atomic: add/remove word, set word text, set complete phrases, set word placement, and set word appearance. Existing generalized Block operations will be extended where the motion decision already fits, including keyframe channels; new motion operations are reserved for Motion Beat membership/timing and references. Every mutating path uses the observed Composition revision, preflights the complete prospective field, records one undo entry, moves Workspace focus, and returns one bounded receipt. No raw patch or UI gesture tool is introduced.

## Implementation state

The static substrate now ships: bounded `surface.typeField` data, first-class `kinetic-word` Block identity, semantic phrases, complete orientation placement, Pack-resolved real variable faces at rest weight, native DOM capture, full-clip Timeline rows, GUI direct manipulation and Inspector editing, and six revisioned Operation/WebMCP capabilities split across `layer`, `content`, `placement`, and `appearance`. It deliberately has no hidden motion. Removing a referenced word refuses until phrase and Cascade references are explicitly cleared; the first word creates a valid parent field and the last removal clears it atomically.

`pnpm probe:kinetic-type-field` proves native dimensions, complete word-pool rendering, actual safe-area containment, readable identities, real Pack variable faces without synthesis, active-orientation placement, and seek-away/seek-back pixel and geometry replay across all ten Pack × orientation cells. Independent tracks and named Motion Beats remain absent until their following slices land.

## Consequences

- `TextAnimation` keeps its current job: applying a catalogued effect to one ordinary text slot. A Type Field is the authored multi-word composition domain; the two do not compete for the same target.
- The static proving fixture is `kinetic-type-field-static-fixture`: it renders the complete word pool for `TYPE CAN MOVE` → `TYPE CAN BECOME` → `TYPE IS THE COMPOSITION` with Pack-resolved hierarchy and complete horizontal/vertical placement. The first animated deliverable will add persistence, supporting-word turnover, Pack-mapped weight impacts, and separately authored spatial tracks without changing that semantic field.
- The shipped Block Pipeline has a graphic Identity Spec, native readable/geometry authority, variable-face readiness evidence, deterministic random-seek/replay proof, and Pack-role pixel-consumer declarations. The motion slices add critical-frame coverage at every beat and channel envelope.
- A Type Field may coexist with ordinary Overlays, Effects, Media, sound, and a transparent or Pack field, but v1 excludes the Dimensional Stage, per-character children, automatic transcript generation, freeform layout recipes, physics, arbitrary font selection in the Preset, and axes other than weight.
- Evidence that useful word choreography cannot be expressed without arbitrary CSS or per-character nodes would reject this bounded design rather than silently widening it into a node compositor.
