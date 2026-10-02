# ADR-0048 — Agent-authored animated chart domain

## Status

**Canon (built).**

Implemented through commit `abf76b0`; the unlisted verification fixture received Critic `ACCEPT` on 2026-08-08 with no `pipeline-bug` or `default-too-permissive` findings.

Date: 2026-08-07
Builds on: [ADR-0002](0002-per-tool-routes-to-preset-engine.md) (one constrained engine), [ADR-0015](0015-identity-spec-per-pipeline.md) (Pipeline identity), [ADR-0023](0023-pack-is-appearance-only.md) (appearance-only Packs), [ADR-0032](0032-gui-agent-parity-authoring.md) (shared Preset authoring), [ADR-0035](0035-generalized-keyframes-and-cascade.md) (deterministic authored motion), [ADR-0036](0036-diagram-primitives.md) (Block-domain precedent), and [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (Pack-neutral deliverables)

## Context

Supers needs authored statistical graphics for factual video storytelling. Before ADR-0048, an agent could only approximate a chart from generic text, diagram primitives, or hand-positioned geometry; those paths did not provide one strict data contract, scale integrity, reusable chart layout, Pack-resolved mark treatment, or shared GUI/agent authoring. The shipped chart domain now supplies that bounded contract instead of fragmenting bar, grid, labeling, and motion behavior across compositions.

The goal is not a general visualization grammar. Initial demand is bounded: bar/column comparisons and normalized unit-grid/dot-field parts-of-whole graphics, with crisp editorial labels and annotations. Data is supplied conversationally by the user and encoded inline in the Preset. CSV import, live URLs, broad chart families, and a separate ingestion product are unnecessary.

## Decision

### 1. Charts are a Block-domain group

A `plain` or `paper` Surface may carry one optional `surface.chart` group; semantic validation rejects the group on other Surface types. The Surface owns the content, while each `surface.chart.items[]` entry is a Block rendered in the existing **Block Layer**, following the current `surface.diagram[]` precedent. Charts do not introduce a sixth Layer, a general node compositor, or a new top-level document model.

The initial stable Pipeline IDs are `bar-chart`, `column-chart`, `unit-grid-chart`, and `dot-field-chart`. Every ID must appear coherently in `BlockTypeSchema`, `PIPELINE_REGISTRY.blocks`, an Identity Spec, core fallback coverage, Block mounts, timeline identity, and authoring discovery before its renderer is considered registered. Source exports use the discoverable `<variant>BlockRenderer` naming convention.

The group contains one to four chart Blocks. `single` mode requires exactly one item. `sequence` mode requires two to four items whose visibility intervals are ordered and non-overlapping. Sequence mode is the one bounded multi-chart mechanism; simultaneous dashboards and arbitrary chart placement remain out of scope.

### 2. One strict inline declaration is the authoring contract

Agents and the GUI write the same `supers@1` `surface.chart` group and item objects. Each item contains a stable Block ID, a Pipeline type, inline categories and series, layout/scale intent, data-bound highlights and chart-local callouts, source note, semantic fill roles, and five explicit motion phases. The exact Zod contract is implemented once and inferred into TypeScript; there is no GUI-only chart state, agent-only shorthand, CSV upload, URL fetch, or live data adapter.

The declaration is strict: unknown keys and malformed primitive shapes fail structural parsing. Semantic validation then runs at built-in catalog parsing, User composition create/update/load, and wire round-trip boundaries. Renderers receive validated declarations and never repair data.

Highlights and callouts share a data-target union: one datum, a unique category set within one series, or one series total. A renderer computes the target value and geometry from the dataset. V1 callouts have no free-text field; the visible claim comes only from a strict computed-value formatter. `value` prints the resolved value. Both percent formatters require a positive series total. `percent-of-series-total` may still represent a signed or out-of-range target comparison. `approximate-fraction-and-percent` is valid only for a resolved ratio in `(0, 1]`; zero uses a non-fraction formatter. It searches fractions satisfying `1 <= numerator <= denominator <= maxDenominator`, with an integer maximum from 2 through 20, and emits unity as `1 in 1 · 100%`. Selection minimizes absolute error, then prefers the lower denominator and numerator. Percent precision is an integer from zero through four. This makes a callout claim data-derived rather than parallel authored prose.

### 3. Factual geometry fails closed

IDs and references are unique and total. Values and domains are finite. Bar and column domains include the required zero baseline and cannot clip values or stack totals. `single`, `grouped`, and `stacked` layouts enforce compatible series shapes; initial stacks are non-negative. Linear scales are the only initial scale.

Unit-grid and dot-field charts require exactly one non-negative parts-of-whole series and `normalization: { total, unitCount }`. The total is finite and positive. `unitCount` is a required integer from 10 through 1,000. Every part is explicit; omitted remainder is invalid. The part sum must equal the total within `max(1e-9, abs(total) * 1e-9)`, which absorbs numeric representation noise but never creates a category or rewrites a value.

Allocation uses deterministic largest-remainder rounding of `value / total * unitCount`, with declaration order as the final tie-breaker, so allocated marks sum exactly to the unit count. Precise text retains the authored or computed value; quantized marks never rewrite or overstate it.

Data marks are accurate 2D geometry. Existing composition depth may stage non-data plates, labels, or camera presentation, but extrusion or perspective must not alter perceived magnitude.

### 4. Packs own appearance; chart motion is intrinsic

A declaration names semantic chart roles, not literal colors, fonts, gradients, dither matrices, Pack IDs, or orientation variants. Each chart Identity Spec maps chart-specific appearance Roles to the existing mandatory core fallbacks. Packs may resolve a mark Role to a solid, gradient, or ordered-dither treatment.

All fill texture is clipped to data marks. Axes, grids, labels, legends, callouts, backgrounds, transparent areas, and undeclared pixels remain crisp. Ordered dither is a mark-local treatment, not a composition-wide Effect.

Each chart item has the ordered phases `entry`, `reveal`, `emphasis`, `annotation`, and `exit`. Every phase has normalized start, positive duration, and an optional value from the chart-safe `smooth | sharp` subset of the shared `EaseSchema`. The shipped `settled` and `bouncy` curves are rejected because they overshoot. Omitted eases resolve exactly to entry `smooth`, reveal `smooth`, emphasis `sharp`, annotation `smooth`, and exit `smooth`; Packs cannot change them. Timings are authored and never defaulted. Phases satisfy `entry.end <= reveal.start <= reveal.end <= emphasis.start <= emphasis.end <= annotation.start <= annotation.end <= exit.start <= exit.end <= 1`. Gaps hold state. The chart is invisible outside `[entry.start, exit.end]`; sequence-mode item intervals also cannot overlap.

Entry introduces non-data chrome, reveal animates marks from the factual baseline or deterministic allocation order, emphasis changes factual focus treatment, annotation introduces labels/callouts, and exit removes the chart. Bounce and magnitude overshoot are invalid factual motion. Runtime resolves the intrinsic `ChartMotion` directly from explicit composition progress; the five clips exposed by `composition-timeline-tracks.ts` are an editable authoring projection, not a second runtime timeline or an ADR-0035 animation manifest. A chart Block ID remains a Cascade anchor for other elements, but Cascade cannot reorder or overlap its internal phases. Packs do not resolve motion, and every animated value derives from explicit timestamp/frame inputs.

### 5. Layout reflows one declaration

Shared chart layout owns plot bounds, safe areas, linear scales, zero baselines, axes, grids, labels, legends, counters, grouping, highlights, source notes, and collision-aware chart callouts. The same Preset renders natively at 3840×2160 and 2160×3840 under every Pack. V1 defines no chart orientation-override schema; layout derives from the target safe area without changing facts or creating sibling Presets.

**Amended 2026-10-02 — the authored chart frame** ([ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) §4). A Chart Block may carry `frame`, a normalized rect `{ x, y, width, height }` (each side at least 0.1, fitting the frame), and `frameOrientationOverrides: { horizontal?, vertical? }`, a complete rect that replaces `frame` in that orientation. The chart lays itself out inside the resolved rect instead of the whole title-safe area, so where it sits and how much room it takes become authored; text roles, scales, and every other layout rule above stay chart-owned. An absent frame keeps the title-safe layout exactly, so existing Presets render unchanged. A frame is placed as written: the rubric reports one that leaves the platform safe area (G2), and the renderer never clamps it. One placement operation, `placement.set-chart-frame`, writes the shared or an orientation frame (or removes it); the canvas drags and resizes the visible chart's frame and the Chart inspector's **Frame** section types it, both through that operation. The proof fixture is `chart-frame-orientation-fixture`.

Chart-local callouts are Block content, distinct from bracket-tag marks in the Annotation Layer. This keeps data-bound labels and leader geometry inside chart layout while preserving the five-Layer vocabulary.

### 6. Verification is an unlisted fixture

`chart-domain-survey-fixture` is an unlisted `kind: fixture` full-frame proof with an explicit Pack-resolved background. Its source distribution is 1 agent = 360, 2 = 354, 3 = 237, 4 = 73, and 5 = 80, totaling 1,104. Categories 2–5 total 744, so 744/1,104 = 67.4%, stated editorially as “2 in 3.”

The fixture uses `surface.chart.mode: "sequence"` with four non-overlapping chart items, so one Preset executes all four stable Pipeline identities. Every item uses either the complete 1–5 distribution or the explicit 360/744 partition; no missing value is inferred. The accepted proof covers every initial Pipeline at both native orientations under the four registered Packs: `syntax`, `editorial-mono`, `crt-terminal`, and `clean-light`.

The separate Critic returned `ACCEPT` on 2026-08-08 after one preset/evidence remediation round, with zero `pipeline-bug` and zero `default-too-permissive` findings.

### 7. Documentation changes state at the proof boundary

The proof boundary was crossed on 2026-08-08. The chart Brief was deleted; this ADR and its index became Canon; the roadmap recorded the shipped domain; and current-state documentation was reconciled from the implemented schema, validation, renderer, and authoring paths.

This explicit closeout keeps lifecycle scaffolding out of current engine truth and prevents designed architecture from being mistaken for runtime behavior.

## Consequences

- Agents can translate conversational direction and supplied facts into a bounded shared declaration; Supers does not become a data-ingestion product.
- The GUI and agents retain create-from-blank and round-trip parity through one schema.
- Four focused Block Pipelines share scale, layout, chrome, fill, and motion infrastructure without collapsing into a general chart renderer.
- Data integrity is testable before rendering, and preview/export determinism remains part of the engine boundary.
- Packs can give charts distinct solid, gradient, or dither character without owning data, geometry, motion, or per-Preset variants.
- Supporting another chart family requires an additive Pipeline and a concrete contract; it does not widen the initial grammar implicitly.
- The unlisted fixture preserves reusable proof without entering deliverable listings, and the accepted documentation boundary records the implementation as current engine truth.
