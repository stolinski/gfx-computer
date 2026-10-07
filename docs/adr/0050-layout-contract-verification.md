# ADR-0050 — Geometry-first Layout Contract verification

## Status

**Build-harness (built).**

Date: 2026-08-26  
Builds on: [ADR-0025](0025-static-linter-checks-safety-and-readability-only.md) (objective safety/readability boundary), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (Pack- and orientation-neutral deliverables), and [ADR-0049](0049-lazy-pipeline-renderer-loading.md) (Preset-scoped runtime readiness)

## Context

Supers originally proved rendered-composition changes with a Cartesian screenshot matrix. A broad Pack or renderer path could select every deliverable Preset, Pack, orientation, and critical timestamp. Each cell retained native-resolution PNGs, replay PNGs, auxiliary frames, readable masks, and probe artifacts. The approach was expensive, opened visible browser windows, produced gigabytes of evidence, and frequently returned unavailable evidence unrelated to the changed behavior.

The screenshot was also the wrong authority for the objective questions that dominate routine verification. Title-safe placement, vertical platform rails, native dimensions, clipping, cap-height floors, reading windows, stable layout, and frame-addressable geometry are mathematical properties. The runtime already knows the semantic readable identities, exact frame address, DOM/native coordinate transform, and authored timing. Converting those facts to PNG and recovering them with image probes adds uncertainty rather than authority.

Human-only review does not scale to the complete corpus. A single engine change may affect more than fifty deliverable Presets under every Pack and orientation. Supers still needs exhaustive safety coverage, but exhaustive coverage must be compact numeric evidence rather than an image archive.

## Decision

### 1. Layout Contract evidence is the routine rendered-safety authority

A **Layout Contract Frame** is a strict numeric receipt for one exact Preset, Pack, orientation, and frame address. It records native target dimensions, readable identity coverage, native bounds and clip bounds, cap heights, font readiness, title/platform-safe affected pixels, reading windows, canonical/replay geometry digests, and maximum layout delta. It contains no PNG bytes, data URLs, screenshot paths, or subjective observations.

A **Layout Contract Matrix** evaluates those receipts over the complete selected coordinate set. Routine Delivery and scheduled Sentry verification use this matrix for objective rendered safety. Its closed checks are:

- native target size;
- font readiness;
- readable identity coverage;
- title-safe area;
- vertical platform-safe area;
- readable clipping;
- cap-height floor;
- reading-window duration;
- deterministic geometry replay;
- layout stability.

Missing semantic identities, unavailable timing, non-finite geometry, and incomplete coordinates fail closed as unavailable evidence. They never become an inferred pass.

### 2. Exhaustive means numeric, not photographic

The matrix may cover every deliverable Preset, Pack, orientation, and critical frame because each cell stores only bounded JSON. One persistent isolated browser session may perform standards-compliant HTML layout and WebGPU frame settling, but it runs hidden, reuses pages by Preset, opens no user-facing windows, and captures no images on success.

The matrix preserves exact frame determinism: explicit frame index and rational frame rate, repeated geometry capture at the same address, and critical/transition sample plans derived from composition timing. Wall-clock animation and arbitrary screenshot timing remain forbidden.

A standalone matrix receipt fingerprints the complete checkout. Factory supplies its exact classified changed paths, so the persisted receipt instead uses the same scoped content-sensitive fingerprint as change classification. Served-source identity remains bound to the complete live checkout. This keeps unrelated dirty authoring work visible to runtime identity checks without allowing it to invalidate or impersonate the sealed task-owned receipt.

### 3. Pixel diagnostics are explicit and separate

Native pixel capture remains available as an explicit diagnostic or release-audit operation for questions that are genuinely pixel-only: antialiasing, blur, banding, codec artifacts, composited local contrast, and subjective aesthetic review. It is not an automatic scheduled Sentry lane and does not run merely because a path sits under a render or Pack directory.

A Layout Contract failure may nominate a bounded diagnostic region. Diagnostics retain only the minimum artifact needed for that named failure class. A passing Layout Contract run creates no image evidence.

### 4. Geometry and semantics come from runtime owners

Pipeline definitions declare readable identities and semantic text roles. The runtime audit converts current DOM geometry into native backing-store coordinates after the exact frame settles. It measures authored content, not editor chrome. Stage projection, Overlay placement, orientation overrides, Pack typography, and font readiness are resolved before evidence is emitted.

The contract does not infer readable importance from arbitrary tags alone. Missing renderer-owned identity coverage is unavailable evidence so new Pipelines cannot escape safety checks by omitting metadata.

Placement, clipping, and cap-height checks apply when the renderer-owned readable carrier has reached its legible hold (`opacity` and enter progress ≥ 0.99). Entering or exiting text is instead covered by exact-address replay and declared stable-geometry checks. This prevents a deliberately scaled or displaced transition pose from being misclassified as a held readability violation while still failing any nondeterministic or discontinuous motion.

### 5. Aesthetic authority remains separate

Mathematics can prove safety, readability floors, determinism, and structural integrity. It cannot prove taste. Layout Contract success therefore does not manufacture an aesthetic approval. Human review remains available for explicitly aesthetic product work, but routine safety verification no longer requires a human to inspect dozens of screenshots.

## Rejected alternatives

- **Keep the screenshot matrix but hide Chrome.** This removes desktop noise but retains the storage, runtime, probe uncertainty, and wrong evidence model.
- **Sample only a few screenshots.** Sampling reduces cost by giving up exhaustive safety coverage and still treats images as the authority for geometric facts.
- **Human-only verification.** A reviewer cannot reliably inspect every Preset × Pack × orientation × critical frame after each engine change.
- **Static Preset lint only.** JSON cannot know final browser layout, loaded font metrics, line wrapping, stage projection, or runtime clipping.
- **Remove all pixel diagnostics.** Some render-quality properties are genuinely pixel-only. They remain explicit diagnostics rather than routine gates.

## Consequences

- Scheduled Sentry and ordinary Delivery verification can exhaustively check rendered safety without saving screenshots or opening visible browser windows.
- Full-corpus verification becomes bounded by layout/settling work and compact JSON size rather than 4K image encoding and storage.
- Pipeline authors must expose complete stable readable identities and semantic roles.
- Existing deterministic runtime manifests become the migration seam; composited mask and PNG capture are omitted in Layout Contract mode.
- Screenshot render matrices move to explicit release/diagnostic tooling and lose automatic routing authority.
- Pixel-only quality and subjective aesthetics remain separate concerns with separate evidence and invocation policy.

## Amendment — 2026-10-06 (Figures)

- **Length-pinned SVG text.** SVG text pinned with `textLength` paints at that length, while a Range over it reports the font's natural glyph advances, which can be wider or narrower than what is drawn. The runtime audit measures such text by its painted element box.
- **Readable ids.** Readable identities from every Pipeline, Figures included, use the lowercase domain-id format this contract's schema enforces; Figure data ids are lowercase so their derived ids always qualify.
- **Shape-edge probes exclude text.** When the screenshot matrix probes a non-axis edge, readable text boxes inside the region are skipped: text is crisp on purpose and has its own softness check.
- **Practice.** The Layout Contract stays the routine rendered-safety check: all nine Figure Presets ran through it in every Pack and orientation in about seven minutes. The full screenshot matrix (here 450 native-resolution cells, about three hours) is too heavy for the current development machine; run it only on hardware that can carry it, and after a fix re-run only the cells that failed, never the whole grid.
