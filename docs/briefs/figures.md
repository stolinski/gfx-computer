# Figures — a generated visualization domain

**Kind:** domain
**Slug:** figures
**Pack:** syntax
**Verification preset:** figure-domain-fixture

## Pitch

High-end documentary channels explain ideas with moving data: a forward pass lighting up a neural network, a bar chart race, money flowing through a Sankey, a family tree growing, a treemap zooming into one branch. GFX can't make any of these today without placing every mark by hand. Figures turn one short declaration into generated marks with honest, choreographed motion, and Pins keep the author's hand on every individual piece. Decision record: [ADR-0067](../adr/0067-figures-generated-visualization-domain.md).

## Surface(s) involved

Any registered Surface. A Figure is Surface-carried Block content, the same as `surface.diagram`. A full-frame piece uses `plain` with a Pack background; an overlay over footage uses a transparent `plain` Surface.

## Content sample

The design target is nine pieces, each to ship as one listed Preset:

| Kind             | Piece                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `neural-network` | A 4-6-6-2 network classifying a handwritten digit; activations light up layer by layer. |
| `bar-race`       | Top ten economies by GDP, 1990 → 2020.                                                  |
| `sankey`         | Where electricity comes from and where it goes.                                         |
| `tree`           | A language family tree.                                                                 |
| `line`           | Atmospheric CO₂ with a threshold band and dated events.                                 |
| `treemap`        | A national budget, zooming into one department.                                         |
| `network`        | Who co-authored with whom, lighting the shortest path between two people.               |
| `cycle`          | The water cycle, with flow travelling around the loop.                                  |
| `slope`          | Rank changes among the top eight smartphone makers across five years.                   |

Each piece's exact data and copy is settled in its own preset Brief when its wave starts.

## Motion plan

Named Moves from ADR-0067 §6: a structural `reveal` (cascade, grow, or draw), then the kind's signature Move (`propagate` for neural networks and trees, `advance` for bar races, lines, and slopes, `flow` for Sankeys and cycles, `focus` with zoom for treemaps, a path `propagate` for networks), then `annotate`, then an optional `exit`. Quantities never overshoot.

## Channel chrome notes

Each Figure resolves through the `chart.*` Roles and the Pack font treatment, so it carries whichever Pack is active. No Pack-specific chrome is imported.

## Engine work required

Everything in ADR-0067: `src/lib/platform/figure-schema.ts`, `src/lib/platform/figure-validation.ts`, `src/lib/utils/figure-*.ts` (layouts, scene, pins, data frames, motion), the `figure` Block Pipeline under `src/lib/pipelines/blocks/figure/`, `FigureMount.svelte`, operation-inventory rows and operations, the Figure inspector, and CSV/JSON import.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`figure-domain-fixture` (unlisted) renders every kind at native horizontal (3840×2160) and vertical (2160×3840) under every registered Pack, `pnpm check`, `pnpm test`, and `pnpm verify-presets` pass, and the nine listed Presets in the table above each pass their affected render matrix and receive human aesthetic approval, with no orientation-specific sibling Preset.
