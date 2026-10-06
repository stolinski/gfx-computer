# ADR-0067 — Figures: a generated visualization domain

## Status

**Designed, not built** (in progress under Dex epic `qvyyiu9g`, planned 2026-10-06). Becomes Canon when the nine target Presets listed in §9 have shipped with human aesthetic approval and the migration review in §9 has recorded its per-part decisions.

Date: 2026-10-06

Builds on: [ADR-0023](0023-pack-is-appearance-only.md) (appearance-only Packs), [ADR-0032](0032-gui-agent-parity-authoring.md) (shared authoring), [ADR-0035](0035-generalized-keyframes-and-cascade.md) (composition-owned channels), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) §4 (authored orientation), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations)

Amends: [ADR-0036](0036-diagram-primitives.md) (automatic layout is allowed inside a Figure), [ADR-0048](0048-agent-authored-chart-domain.md) (Figures are not limited to `plain`/`paper`, to one group, or to typed-in data)

## Context

GFX can show data in two ways today. Diagram primitives (ADR-0036) are placed one at a time by hand, and their edges can only draw on and fade. Chart Blocks (ADR-0048) are five hand-built Pipelines with linear scales, one group per `plain` or `paper` Surface.

Neither can produce the pieces a documentary channel actually needs: a neural network with a forward pass moving through it, a bar chart race, a Sankey with flow, a network graph lighting up along a path. A small neural network already has 72 edges. Placing each by hand is not authoring, and nothing in the current vocabulary can move along an edge, let a value drive how a mark looks, or change data over time.

Building one Pipeline per new chart would repeat ADR-0048's cost for every kind and bend each feature around one piece. The human direction (2026-10-06) is "flexibility, but good presets", designed against many kinds at once.

## Decision

### 1. A Figure is a declaration that generates its marks

`surface.figures` is an optional array of one to four **Figures** on **any** Surface type, including a transparent Surface over footage. Each Figure has a stable `id`, a `kind`, kind-specific `data` and `layout`, a frame, **Moves**, and **Pins**.

The engine expands a Figure into **Marks** (nodes, links, bars, bands, rectangles, lines, labels), and each Mark gets a stable id derived from the data, such as `node:<id>` or `link:<source>><target>`. Generation is a pure function of the declaration and the orientation. It uses no wall clock and no unseeded randomness, so preview and export produce the same pixels.

The first kinds are: `neural-network`, `tree`, `network`, `cycle`, `bar-race`, `line`, `slope` (`value` or `rank` mode, so bump charts are included), `sankey`, and `treemap`. To add a kind, add a data schema, a layout, and a scene builder. It does not need a new Pipeline, mount, timeline identity, or Pack Role.

### 2. One Block Pipeline, one scene, one renderer

Figures render through **one** Block Pipeline, `figure`, in the existing Block Layer. Each kind's scene builder produces a flat, renderer-independent **Figure scene**: circles, rectangles, paths, ribbons, and text, each with a Pack Role voice. One SVG renderer draws every scene. That renderer sits on the Surface plane inside `.composition`, the same way `DiagramMount` and the line chart do, so HTML-in-Canvas captures it in every render path.

Layout is computed once per declaration and orientation. Motion is evaluated per frame over the computed layout. Figures do not add a GPU mark pass: every mark they need (curves, ribbons, gradients, text) already exists in SVG, and the captured DOM is already the native-resolution path.

### 3. Layout is generated live, and Pins keep the author's hand

Figures use proven layout math at pinned versions: `d3-hierarchy` (tidy tree, squarified treemap), `d3-sankey`, and `d3-force` run for a fixed number of ticks from a seeded start, never on a timer. Layered (neural-network), circular (cycle), and Cartesian (bar-race, line, slope) layouts are owned by the engine. Mermaid, ELK, and Graphviz are not used.

This amends ADR-0036. Automatic layout is allowed **inside a Figure**, because the author keeps control through:

- **`layout` + `layoutOrientationOverrides`.** Each orientation can have its own complete layout settings (direction, spacing, seed), so the vertical piece is composed, not derived (ADR-0039 §4).
- **`frame` + `frameOrientationOverrides`.** The Figure lays itself out inside an authored normalized rect, with the same contract as the ADR-0048 chart frame.
- **Pins.** A Pin names one Mark and overrides its position (in frame-local fractions), its label, or its visibility, either everywhere or in one orientation. It can also carry `opacity` and `scale` keyframe channels (ADR-0035). Pins survive regeneration. A Pin whose Mark no longer exists fails semantic validation with its path, and is never dropped silently.

Diagram primitives remain for single hand-placed callouts.

### 4. Values drive appearance through per-kind encodings

Each kind declares a small `encoding` with closed options, for example the neural-network's `nodeBrightness: activation | uniform` and `linkWidth: weight | uniform`, or the network's `nodeSize: value | degree | uniform`. An encoding maps a value to size, brightness, width, or a Pack color voice. There is no expression language and there are no literal colors.

### 5. Data that changes over time is a list of keyed frames

`bar-race` carries entities plus ordered frames of values keyed by entity id. `slope` carries entities with one value per period. `line` carries series of `{x, y}` points. The `advance` Move interpolates between frames by entity key, re-sorts ranks, and handles entities entering and leaving the visible set.

### 6. Motion is named Moves, plus Pin keyframes

A Figure's `moves[]` is an ordered list of named Moves. Each has `start` and `duration` as composition-progress fractions and an optional ease from the shared `EaseSchema`:

| Move        | Meaning                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `reveal`    | Required, exactly one. Brings the Figure in by `cascade`, `grow`, `draw`, or `fade`, in the kind's structural order. |
| `propagate` | A signal travels through the structure in order: layers, depth, steps, a path, or the flow direction.                |
| `pulse`     | Named Marks swell and brighten.                                                                                      |
| `flow`      | Continuous motion along links for the length of the window.                                                          |
| `advance`   | Moves through data frames or periods, or draws a line forward along x.                                               |
| `focus`     | Dims everything but the named Marks. On a treemap it can zoom into one branch.                                       |
| `annotate`  | Brings in named annotations.                                                                                         |
| `exit`      | Takes the Figure out.                                                                                                |

**Honest motion.** A Move that changes a quantity (`reveal` on a data kind, and `advance`) accepts only non-overshooting eases (`smooth`, `sharp`). A Move on structure (`pulse`, `propagate`, `flow`, `focus`, and `reveal` on a structure kind) may also use `settled` and `bouncy`. Validation enforces this.

### 7. Data comes from agents or file import, never live

Data is stored inline in the composition. Agents write it through operations. CSV and JSON files can be imported through one parsing operation that is reachable from the GUI and from WebMCP; it copies the parsed values inline. There is no table editor, no URL fetch, and no live adapter. The GUI's data path is file import by design, because agents author Figure data; the GUI owns structure settings, look, Moves, Pins, and frames.

Every capability is a row in the operation inventory, owned by one family, with the ADR-0054 transaction contract.

### 8. Appearance resolves through the chart Roles

Figures resolve color and type through the existing `chart.*` Roles (`chart.mark`, `chart.series-2..4`, `chart.axis`, `chart.grid`, `chart.label`, `chart.annotation`) and the Pack's font treatment, so every registered Pack and every User Pack already styles Figures. Signals and emphasis use `chart.annotation`. Packs own no geometry and no motion.

### 9. The design target and the existing parts

The domain is designed against nine pieces at once: neural network, tree, network graph, cycle loop, bar chart race, annotated line, slope/bump, Sankey, and treemap. Each ships as one listed Preset with both orientations art-directed, reads well under every Pack, and has human aesthetic approval.

After the nine ship, a migration review compares each Chart Block Pipeline and Diagram primitive with its Figure equivalent. A part moves onto Figures only if the Figure version renders at least as well. Old compositions keep loading, through a legacy reader that rewrites them. Each decision is recorded here.

## Consequences

- One Pipeline and one renderer serve every visualization kind. A new kind is a schema, a layout, and a scene builder.
- Figures can sit beside other content, over footage, and several to one composition.
- Layout libraries become runtime dependencies at pinned versions. Their output is deterministic because force layouts are ticked a fixed number of times from a seeded start.
- SVG through HTML-in-Canvas bounds Figure density. The ceilings in the schema (for example 400 network links and 1,792 neural-network links) keep capture time inside the frame budget.
- ADR-0036's ban on automatic layout and ADR-0048's surface and group limits still hold for Diagram primitives and Chart Blocks, but not for Figures.

## Out of scope

Maps, Gapminder-style bubble charts, scale comparisons, pictograms, a GUI table editor, live or fetched data, and 3D Figures.
