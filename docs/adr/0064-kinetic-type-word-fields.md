# ADR-0064 — Kinetic type is an authored Block field with independent tracks

## Status

**Canon.** The Pack-mapped variable-weight substrate, static Type Field authoring substrate, and independent Kinetic Word opacity/spatial/normalized-weight tracks shipped 2026-09-15 under Dex epic `fnwlsz1g`. Amended 2026-09-21: the line-box mask (`reveal`), a bounded per-word glyph stagger, and `tracking` joined the vocabulary after the first moving proof showed that whole-word slides and cuts cannot reach the quality bar (see [Amendment](#amendment-2026-09-21--the-line-box-mask-glyph-stagger-and-tracking)). Amended 2026-10-02: named Motion Beats, beat-bound keys, phrase readability at a beat, and the dual-speed editorial defaults shipped (see [Amendment](#amendment-2026-10-02--motion-beats-as-shipped)). Animated release validation and the listed reference deliverable remain designed implementation work governed by this ADR and [`../briefs/kinetic-type-toolbox.md`](../briefs/kinetic-type-toolbox.md).

Date: 2026-09-15 (amended 2026-09-21, 2026-10-02)

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

Base placement is a normalized position, optional `start | center | end` horizontal anchor, scale, and rotation. The anchor defaults to `center` for older Presets and pins a stable typographic edge while Pack faces change width. Placement is optical: the renderer measures the active face's outer side bearings and ink centre, so an anchored edge is the ink edge and `y` is the ink centre, not the advance box or the line box — a flush-left stack shows one edge and equal margins under every Pack without per-Pack numbers in the Preset. Like Diagram geometry, placement has a shared value plus optional complete horizontal and vertical snapshots. Each word is selectable on the canvas and has one Timeline row, one Inspector, one Block identity, and one shared undo/history identity.

The initial ceilings are 16 words, 8 phrases, 8 Motion Beats, 8 words per phrase, 32 Unicode code points per word, and 24 keyframes per channel. Validation rejects overflow rather than truncating it.

### Independent tracks use a closed channel vocabulary

A Kinetic Word Block may author:

- spatial channels: `x`, `y`, `scale`, `rotation`;
- visibility: `opacity` and the masked `reveal` offset;
- typography: normalized `weight` and `tracking` (em delta).

The four existing eases remain the only curves. There are no expressions, arbitrary CSS properties, motion paths, free handles per glyph, or per-character tracks. The one mask a word may use is its own line box, driven by `reveal`; a per-word glyph stagger delays that single shared track per grapheme. Declaring channels transfers motion ownership from Pipeline defaults exactly as ADR-0035 defines.

Spatial tracks resolve from the active orientation's base placement. An optional orientation override replaces the complete spatial-track group for that target; `opacity`, `reveal`, `weight`, `tracking`, phrase identity, and beat relationships remain shared. This permits a genuine tall-frame recomposition without an orientation-specific Preset.

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

The static substrate adds six Type Field operations under those existing families because first/last-word parent lifecycle and phrase/reference validity must remain atomic: add/remove word, set word text, set complete phrases, set word placement, and set word appearance. Generalized `motion.set-keyframe-channel` and `motion.clear-keyframe-channel` now accept Kinetic Word Block subjects and an optional complete horizontal/vertical spatial scope. `motion.set-kinetic-word-position-keyframe` is the smallest corrective operation for canvas gestures: it upserts X and Y together at the playhead, establishes the complete orientation spatial group when needed, and records one undo entry. New motion operations remain reserved for Motion Beat membership/timing and references. Every mutating path uses the observed Composition revision, preflights the complete prospective field, records one undo entry, moves Workspace focus, and returns one bounded receipt. No raw patch or UI gesture tool is introduced.

## Amendment (2026-09-21) — the line-box mask, glyph stagger, and tracking

The first moving proof was rejected on quality: with only whole-word `opacity`, `x`, `y`, `scale`, `rotation`, and `weight`, every entrance is a slide, a fade, or a cut across open frame — the vocabulary of a slide deck, whatever the layout. Good kinetic typography differs in three specific, bounded ways, and this amendment admits exactly those:

1. **Masked reveals.** `reveal` offsets a word's glyphs inside the word's own padded line box, in mask heights: `0` at rest, `-1` hidden below the baseline edge, `1` hidden above the cap edge. Letters rise out of nothing and leave through the top of their own line, never crossing the frame. The mask exists only while a `reveal` track does; an unmasked word renders as one text run exactly as before. This is a named channel over one fixed mask, not an arbitrary mask.
2. **Glyph stagger.** `glyphStagger: { offsetMs 0–120, order forward | reverse | center }` is one number and one order on the word. Every grapheme plays the word's own shared `reveal` track delayed by its rank. Glyphs render as inline text so the Pack face still kerns across them (verified: Blink shapes across inline boundaries; inline-block would not); only the vertical mask offset is per glyph. Weight, tracking, opacity, and placement stay word-level. This is not per-character tracks.
3. **Tracking.** `tracking` is an em delta on the hierarchy's letter-spacing, `-0.2..1`, Pack-neutral because em follows the face. It un-defers the channel this ADR always named.

Glyph stagger belongs to `motion` (`motion.set-kinetic-word-glyph-stagger`, GUI in the Kinetic Word Inspector); `reveal` and `tracking` ride the generalized keyframe Operations. The deterministic motion probe now accepts a Pack-mapped weight change, not only a placement move, as persistent-word recomposition.

## Amendment (2026-10-02) — Motion Beats as shipped

The beat model above holds; these are the concrete choices the implementation made.

1. **Shape.** `state.motionBeats` is at most 8 `{ id, atMs, sound? }` entries, ids lowercase letters, digits, and hyphens, `atMs` a whole non-negative millisecond, strictly ascending. A beat placed from the GUI lands on the playhead's frame at the largest whole millisecond at or before that frame's time, so it is reached on exactly that frame at integer and NTSC rates.
2. **Bound keys keep their resolved time.** A beat-bound Kinetic Word key stores `atBeat` and `offsetMs` **and** its resolved `atMs`. Every time consumer — manifest, Timeline, cascade, sound — keeps reading one field; structural validation requires `atMs = beat.atMs + offsetMs`, names the expected time when it is not, and rejects a key bound to a missing beat. The keyframe Operation accepts `atBeat` + `offsetMs` without `atMs` and resolves it; a key sent without a beat at the time an existing bound key holds keeps that binding, so editing a value never silently unbinds it. Only Kinetic Word keys bind.
3. **Phrases.** `phrases[].beatId` is phrase content, set with `content.set-kinetic-phrases`. A beat is read at by at most one phrase. Semantic validation requires every word of a beat-bound phrase to be readable at that beat (opacity ≥ 0.98 and |reveal| ≤ 0.02); words outside the phrase stay free.
4. **Operations.** Four `motion` Operations: `add-motion-beat`, `set-motion-beat` (time, sound, or both — merged so the motion family stays inside the 35-tool disclosure budget), `remove-motion-beat`, and `land-kinetic-word-on-beat`. Moving a beat moves its bound keys in the same transaction and refuses, naming the key, a move that would reorder a track. Removal refuses while a phrase reads at the beat; keys bound to it are refused too unless `releaseKeyframes` keeps them at their times as absolute keys. No Operation rewrites a phrase.
5. **Sound.** Beats are silent. A beat with `sound.event` derives one cue at its exact time (`beat:<id>`), welded through every move.
6. **Dual-speed defaults.** `land-kinetic-word-on-beat` copies bound keys into the word's shared tracks: `arrive` — `reveal` −1 → 0 over the 360 ms before the beat (`sharp`), `weight` rest 0.5 → 1 → rest from −80 to +200 ms (`sharp` hit, `smooth` release), `tracking` 0.08 → 0 from −360 to +100 ms; `leave` — `reveal` 0 → 1 over 240 ms from the beat; `strike` — `weight` rest → 1 → rest from −80 to +240 ms. Keys already inside a move's window are replaced. Normalized 0.5 is every Pack's rest coordinate.
7. **Timeline.** Beats show as flags in the ruler with a guide through every lane. Dragging a flag previews the move frame-snapped and commits one Operation; a press seeks. Keyframe drags and the playhead snap to a beat within 8 px; a Kinetic Word key dropped on a beat binds to it at offset 0, and a bound key dragged elsewhere keeps its beat with the new offset.

## Implementation state

The bounded `surface.typeField` and first-class `kinetic-word` Block now ship semantic phrases, complete orientation placement with stable horizontal anchors, Pack-resolved real variable faces, native DOM capture, independently authored `opacity`, `reveal`, `x`, `y`, `scale`, `rotation`, normalized `weight`, and `tracking` channels, and a bounded per-word glyph stagger over the line-box mask. Shared opacity and weight survive both targets. A complete target-specific spatial group replaces shared spatial motion for that orientation. Kinetic Word rows expose channel diamonds; the Inspector writes revisioned keyframe Operations; canvas drag and nudge at a nonzero playhead upsert X/Y keys instead of moving rest geometry. Removing a referenced word refuses until phrase and Cascade references are explicitly cleared; the first word creates a valid parent field and the last removal clears it atomically.

`pnpm probe:kinetic-type-field` still proves the static substrate across all ten Pack × orientation cells. `pnpm probe:kinetic-type-field-motion` parks deterministic capture on three semantic phrase frames plus a real Pack-mapped weight strike, proves seek-away/seek-back image and geometry identity, native dimensions, active-orientation paths, font readiness/no synthesis, distinct phrase pixels, controlled edge-bleed visibility, and an intentional frame-edge relationship across the same matrix. The unlisted `kinetic-type-field-motion-fixture` is the moving technical proof; since 2026-10-02 its timing reads from seven named beats (`open`, `move`, `swap`, `become`, `turn`, `composition`, `out`), each phrase reads at its beat, and every choreographed key is bound, with frames unchanged. The listed reference deliverable remains absent until its slice lands.

Verification authorities landed 2026-10-02 (`tvmuvpnt`): critical moments (beats plus per-word keyframe envelopes) feed the deterministic sample plan; field-wide ceilings bound keyframes (320), masked glyph spans (192), and critical moments (48) with corrective messages; `pnpm probe:kinetic-type-field-diagnostics` adds closed pixel and geometry diagnostics across every Pack and orientation. Authoring ergonomics: Kinetic Word rows group under one collapsible Type Field header on the Timeline, canvas multi-selection aligns and distributes words in the active orientation, the On Beat menu defaults to the beat nearest the playhead, and the phrase Operation carries `beatId` for agents.

The reference deliverable `kinetic-type-field` ("Type Is the Composition") landed 2026-10-02 for aesthetic review (`fbutl1u4`): the moving fixture's choreography on the Brief's holds (beats at 0.5, 1.0, 2.0, 2.5, 3.35, 4.0, and 5.6 s; MOVE 1.0 s, BECOME 0.85 s, COMPOSITION 1.6 s; TYPE leaves last), every word on one shared 5% margin axis so support words stay inside title-safe, COMPOSITION set to the widest Pack face, and the tall frame scaled to clear the action column. It passes `probe:kinetic-type-field-diagnostics` in all ten Pack × orientation cells. Authoring it exposed one renderer defect, fixed in `KineticTypeFieldMount.svelte`: an absolutely positioned word box shrank to the room right of its left edge before its scale applied, so a long word set small (Playfair COMPOSITION in the tall frame) clipped at its own mask; the box is now `max-content`, and the diagnostics probe fails any word whose text overflows its mask.

## Consequences

- `TextAnimation` keeps its current job: applying a catalogued effect to one ordinary text slot. A Type Field is the authored multi-word composition domain; the two do not compete for the same target.
- `kinetic-type-field-static-fixture` preserves the no-motion substrate checkpoint. `kinetic-type-field-motion-fixture` proves the same `TYPE CAN MOVE` → `TYPE CAN BECOME` → `TYPE IS THE COMPOSITION` field with persistent core words, supporting-word turnover, Pack-mapped weight impacts, independently authored spatial paths, and complete vertical spatial replacements. Both remain unlisted fixtures; Motion Beats will replace their raw timing landmarks before the reference composition becomes a deliverable.
- The shipped Block Pipeline has a graphic Identity Spec, native readable/geometry authority, variable-face readiness evidence, deterministic random-seek/replay proof over exact canonical poster-grid digests, and Pack-role pixel-consumer declarations. The motion slices add critical-frame coverage at every beat and channel envelope.
- A Type Field may coexist with ordinary Overlays, Effects, Media, sound, and a transparent or Pack field, but v1 excludes the Dimensional Stage, per-character children, automatic transcript generation, freeform layout recipes, physics, arbitrary font selection in the Preset, and axes other than weight.
- The 2026-09-21 amendment is the bounded answer to exactly that evidence: whole-word transforms could not express a masked, letter-by-letter reveal, so one named mask and one per-word stagger were admitted rather than per-character nodes or arbitrary CSS. Evidence that useful choreography still cannot be expressed would again reject this design rather than silently widening it into a node compositor.
