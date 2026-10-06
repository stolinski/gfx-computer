# Where America's energy goes

**Kind:** preset
**Slug:** us-energy-sankey
**Pack:** syntax

## Pitch

The classic energy Sankey, made legible: five U.S. energy sources flow into transport, industry, homes, business, and power plants, and the power plants pour more than half of what they burn out as heat. Ribbons grow source to sink, current runs through them, and the frame then sets aside everything but the loss. One `sankey` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)): left to right in the wide frame, top to bottom in the tall one.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "Where America's energy goes"
- Source: EIA, "U.S. energy consumption by source and sector, 2023" (Monthly Energy Review, April 2024), quadrillion Btu. Flows start from the chart's published source and sector percentages and are balanced (iterative proportional fitting) so every node matches its published total within rounding; links under 1% omitted.

## Motion plan

`reveal` grow (ribbons extend source to sink, `smooth`) → `flow` (streaks travel every ribbon) → `focus` the power plants and their loss → `exit` fade. Sixteen seconds.

## Channel chrome notes

Ribbons take the Pack's series voices by source; nodes in ink. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/us-energy-sankey.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
