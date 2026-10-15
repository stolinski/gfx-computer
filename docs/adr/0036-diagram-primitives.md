# Diagram primitives — art-directed docu diagrams as Blocks

## Status

**Canon (built).**

> **Status: Shipped** — grilled 2026-07-01/02, built 2026-07-03/04 (dex epic `phd3zd26`): schema (`surface.diagram[]`), five Block pipelines + Identity Specs, GUI parity (rows / canvas drag / per-type inspector / cascade picker), and the four-piece demo set (`docu-map-journey`, `docu-flowchart`, `docu-stat-build`, `docu-timeline-build`) through Critic ACCEPT. Orientation geometry overrides shipped 2026-07-24 (Dex `q85lmeln`), folding the original H/V sibling proofs into one Preset per piece. The Critic loop drove three engine corrections (odometer carry, capture-safe digit rolls, transparent-ink legibility halo) plus orientation-aware segment-caption placement. Glossary: **Diagram primitive** in [`CONTEXT.md`](../CONTEXT.md). A sixth primitive, `code`, joined on 2026-10-14 — see [Amendment 2026-10-14](#amendment-2026-10-14--the-code-primitive).

Supers gets a **five-primitive diagram vocabulary** — `node`, `edge-arrow`, `label`, `stat-callout`, `timeline-segment` — living as **Blocks on any Surface**, positioned **explicitly** in composition space and revealed with **stroke-draw + Cascade**. The register is high-end YouTube documentary (Johnny Harris / Vox): every primitive is placed deliberately and revealed in choreographed order. **Auto-layout is rejected** — mermaid-style layout reads as documentation, not documentary; at most a future compile-*into*-primitives authoring shortcut.

## §1 Context

Only `paragraph` exists in the Block layer; explainer content (flowcharts, maps, timelines, stat builds) has no vocabulary at all — the biggest content-coverage gap for a dev/doc channel. The corpus-v2 demo lanes (2026-07 grill) named docu-diagram pieces a wanted deliverable kind.

## §2 Vocabulary — five primitives, map is a demo

| Primitive | Claims | Notes |
|---|---|---|
| `node` | a labeled point/box in the diagram | pin, box, or dot form — appearance via Roles |
| `edge-arrow` | a directed connection between two nodes | see §4 routing |
| `label` | free text annotating a position | the diagram's caption voice |
| `stat-callout` | a number that builds | reuses the counter roll behavior |
| `timeline-segment` | a spanned interval with endpoints | the H↔V reflow stress case |

**No map primitive.** An animated map is node-pins + arced edges + labels composited over an **image substrate** (the `jhxe2k5w` primitive) — the same shot, art-directed, with nothing built twice. Real geo support (projections, lat/lng, zoom choreography) rejected as a rabbit hole that buys nothing over hand-placed pins.

## §3 Home — Blocks on any Surface

Diagram primitives are **Blocks**: discrete content units on a Surface, in the Surface's coordinate space, positioned by explicit composition-space fractions (GUI-draggable). This works **full-frame** (paper / chapter-card substrate) and **over footage** (a transparent surface carrying only diagram Blocks — the stat-build overlay case).

- Rejected — *new Overlay types*: a 12-node flowchart becomes 12 loose overlays with no shared coordinate space, and an edge that connects two nodes has no home.
- Rejected — *dedicated diagram Surface* (the iMessage pattern): walls diagrams off from composing with other content, and every new diagram kind tempts a new Surface.

Primitives carry `id`, `type`, explicit position, content, and standard timing (`enter`/`exit` sugar, **Cascade** anchor, ADR-0035 keyframe channels where they apply). Edges reference node ids. **Field placement (decided in the schema task): `surface.diagram[]`** — a diagram group on the Surface, not a top-level `blocks[]`. It matches this section's model (primitives live in the Surface's coordinate space), and the group is pure JSON so `presetToWireFormat`'s surface spread carries it losslessly under the byte-identical round-trip gate (unlike `content.body`, which round-trips through text). Optional complete `orientationOverrides.horizontal|vertical` geometry snapshots re-stage the same primitive without changing content or choreography; `resolveDiagramPrimitiveGeometry` is the common render/lint/authoring seam. Cascade anchors gain `{ block: id }`; timeline rows are `block-{id}`. Channel split: DOM primitives (`node` / `label` / `stat-callout`) take the full ADR-0035 channel set; stroke-drawn primitives (`edge-arrow` / `timeline-segment`) expose `opacity` only — their reveal is the stroke-draw scalar, and a transform channel fighting the drawn path is the double-motion mystery ADR-0035 §2 bans.

## §4 Edges — authored route, Pack-resolved stroke

- **Route is content**: endpoints (node refs or explicit points) + one optional control point → straight, elbow, or quadratic **arc** (the map money shot). Authored, never auto-routed.
- **Stroke is appearance**, resolved through Roles per pack: `syntax` = hand-drawn marker feel (Q6 deterministic imperfection), `editorial-mono` = clean printed rule, `crt-terminal` = phosphor plotter line. Arrowhead form is a Role. A hand-wobbled arrow under CRT is an aesthetic-miss by that pack's own anti-list — which is exactly why the stroke can't be baked into the primitive.
- **Draw-on reveal** reuses the annotation stroke-draw machinery (`src/lib/annotations/`, mark progress scalar).

## §5 Reveal grammar

Cascade (ADR-0035) is the choreography: reading-order builds (node → edge draws to → next node) declared as anchor chains, re-timing as one unit with sound cues welded. Node/label entrances use the pack's motion vocabulary; `stat-callout` counts up on its window; edges stroke-draw. Multi-step emphasis (a node pulsing once when named) is ADR-0035 keyframe territory, not new machinery.

## §6 Demo set (corpus v2)

All four chosen: **animated map** (primitives over image substrate — the signature), **flowchart** ("how X works", the pure-primitive test), **stat build** (transparent surface over footage), **timeline build** (H↔V reflow stress). Each a deliverable through Critic ACCEPT.

## §7 Consequences

- Five Block pipelines with Identity Specs (`graphic` kind; stroke/node appearance dims `viaPack`, motion intrinsic) — the registry gate applies as everywhere.
- New pack Roles (edge stroke, node form, arrowhead) join all pack manifests — lands cleanly only after the pack-contract work (core-vocabulary enforcement, epic `wscbvu5k`).
- GUI: diagram Blocks join the timeline outline as rows and get canvas drag + a per-type inspector (the ADR-0034 machinery, extended).
- Depends on ADR-0035 shipping first; epic `phd3zd26` stays blocked on `4i8gx2i7`.

## Amendment 2026-10-14 — the `code` primitive

**Decision.** Code on screen is a sixth Diagram primitive, `code`: a syntax-highlighted panel that walks through ordered **Code steps**. Each step after the first has a `move` window. During that window, tokens both steps share glide to their new line and column, removed tokens fade out, and added tokens fade in. Each step may also light chosen line ranges, or a column range on one line, and dim every other token to 30%. A step without code keeps the previous step's code, so a step can change only what is lit.

**Why a Diagram primitive.** It is a positioned, timed, placed element like `stat-callout`. Joining the Diagram vocabulary gives it enter/exit, keyframe channels, Cascade, canvas drag, timeline rows, orientation geometry overrides, and the `content.set-diagram-primitive` operation without new machinery. The steps live inside one Block rather than across Scenes, so one Preset is a whole walkthrough. Scott chose this over Scene-boundary magic move (ADR-0068 §5); `code` as a Scene-boundary kind is not built.

**Appearance is only the Pack's fill and ink.** The panel uses `fill-treatment`, plain code uses `ink-treatment` (authored `typography` colours win), and each syntax role uses the ink's lightness with its own hue (`oklch(from ink …)`). Comments and punctuation mix the ink toward the fill. No Pack Role exists for code, so every Pack dresses it without extra work. The face is always JetBrains Mono with ligatures off, because a token's place is its grid cell.

**Tokens and motion.** Shiki tokenises synchronously, with the JavaScript regex engine and a fixed set of nine grammars; a theme of sentinel colours reads each token's role back. `@shikijs/magic-move/core` keys tokens across neighbouring steps, matching whole tokens only (split tokens moved as stray letters). Its renderer is never used, because it animates on a clock. `src/lib/utils/code-tokens.ts` places tokens on the monospace grid and computes each frame from the composition progress, so preview and export match.

**Limits.** 16 steps, 40 lines, 100 columns. Lines never wrap: wrapping would move a token across lines mid-move. The demo `code-async-await` is art-directed for horizontal only, at Scott's direction; its vertical composition has not been designed.

## Amendment 2026-10-14 — the filmed flowchart

**Why.** Scott judged the agent-made flowcharts ugly, badly sounded, and unengaging: small boxes in a mostly empty frame, every element entering the same way, a pop and a draw for every element. The direction he chose is printed cut-out cards on a dark page, filmed by the Stage camera ([ADR-0057](0057-filmed-canvas-camera-pose-and-posed-planes.md)), which walks from step to step and marks the current step with a highlighter swipe. The deliverable is `docu-flowchart-filmed`.

**Decisions.**

- **A node may carry a `highlight`.** A chisel-marker band in the Pack's `node.accent` colour draws on behind the node's text over its window and holds; an optional `lift` wipes it off when the story moves on. This is the "this step, now" mark §5 left to keyframes; keyframes cannot draw a band, so it is a node field. It emits the `swipe` sound event, the same as a highlight mark, and nothing else in a filmed flowchart needs to sound: the Preset mutes the per-element pop and draw.
- **Node, label, and edge sizes are authorable** ([ADR-0070](0070-every-visible-size-is-authorable.md)). A box node takes `fontSize`, `paddingX`, `paddingY`, and `borderWidth` (0 is a borderless cut-out card); a label takes `fontSize`; an edge takes `strokeWidth`. Node and label sizes are geometry, so they ride the per-orientation snapshot.
- **A node may carry a logo** (amendment 2026-10-15). `logoUrl` is content, shared by both orientations, with the same uploaded-image contract as the checklist logo; the image is drawn centred above the node on the same filmed surface, for every form, without changing the node's own box or centre. Its height `logoSize` (cqmin, width follows the image) and its gap above the node `logoGap` (cqmin) are geometry, so they ride the per-orientation snapshot and `gfx_placement_set_diagram_geometry` ([ADR-0070](0070-every-visible-size-is-authorable.md)).
- **A blurred depth rig is a lifted card.** A Pack `node.depth` offset with a blur draws one soft cast shadow and no backing plate; an unblurred offset keeps the hard plate.
- **The Syntax Pack sets diagrams in print faces**: Archivo 900 on cards and headings, Source Serif 4 italic for captions, through `diagram.font`, `label.font`, and the new `label.captionFont`, `label.captionStyle`, `node.weight`, and `node.tracking` Roles ([`docs/packs/syntax/aesthetic.md`](../packs/syntax/aesthetic.md)). Every Syntax flowchart takes the new dress.
