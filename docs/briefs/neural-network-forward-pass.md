# How a network reads a digit

**Kind:** preset
**Slug:** neural-network-forward-pass
**Pack:** syntax

## Pitch

The explainer shot every AI video reaches for and few get right: a small neural network builds itself layer by layer, a forward pass sweeps through it with every link lighting by how much it carries, and the network lands on its answer. One `neural-network` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), full frame, both orientations art-directed: left to right in the wide frame, top to bottom in the tall one.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` (a full-frame segment) carrying one Figure.

## Content sample

- Title: "How a network reads a digit"
- Layers: Pixels (6) → Edges (9) → Shapes (9) → Digit (4, labelled 0, 3, 8, 9)
- The answer Pin: "8 · 93%"
- Source note: "Illustrative activations"

## Motion plan

`reveal` cascade layer by layer with `settled` (structure may overshoot) → `propagate` once, signals travelling every link, each link lighting by weight × activation, layers lighting as the wave arrives → `focus` the answer node → `pulse` it twice → `exit` fade. Twelve seconds; the wave takes about four.

## Channel chrome notes

Figure voices resolve through the chart Roles: positive weights in the Pack's first series voice, negative in its second, signals and focus in the annotation voice. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067: the `figure` Pipeline, the layered layout, and the propagate/focus/pulse Moves.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/neural-network-forward-pass.json` passes the deterministic affected render matrix at native horizontal (3840×2160) and vertical (2160×3840) under every Pack, and its exact evidence bundle receives human aesthetic approval, with no orientation-specific sibling Preset.
