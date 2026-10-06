# Where the world's electricity comes from

**Kind:** preset
**Slug:** world-electricity-treemap
**Pack:** syntax

## Pitch

All of 2025's electricity in one rectangle: every generating source grows in by size, grouped into fossil and clean, then the frame zooms into clean power, where solar and wind each now sit level with nuclear. One `treemap` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "Where the world's electricity came from in 2025"
- Source: Ember yearly electricity data (yearly_full_release_long_format.csv, fetched 2026-10-06), World, Electricity generation, TWh, 2025, rounded to whole TWh.
- Fossil: coal 10,490 · gas 6,896 · other fossil 818. Clean: hydro 4,432 · nuclear 2,812 · solar 2,779 · wind 2,712 · bioenergy and other renewables 794 (Ember's bioenergy 705 plus other renewables 89).

## Motion plan

`reveal` grow, largest cells first → hold on the whole → `focus` with `zoom` into Clean → release back to the whole → `exit` fade. Fourteen seconds.

## Channel chrome notes

Clean (listed first) takes the Pack's first voice and fossil the second; leaf labels read in contrast ink on their cells. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/world-electricity-treemap.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
