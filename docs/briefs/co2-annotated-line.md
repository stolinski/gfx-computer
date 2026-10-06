# Carbon dioxide in the air

**Kind:** preset
**Slug:** co2-annotated-line
**Pack:** syntax

## Pitch

The Keeling curve, told as it happened: the Mauna Loa CO₂ record draws itself year by year from 1959 to 2025 at a steady pace, the 350 ppm line appears as the curve crosses it, and three climate milestones mark themselves as the line passes. The live value rides the tip. One `line` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "Carbon dioxide in the air"; y-axis: "Parts per million"
- Source: NOAA Global Monitoring Laboratory, Mauna Loa annual mean CO₂ (co2_annmean_mlo.txt, fetched 2026-10-06), 1959–2025.
- Threshold: 350 ppm. Events: IPCC founded (1988), Kyoto Protocol (1997), Paris Agreement (2015).

## Motion plan

`reveal` fade (axes and grid) → `advance` 1959 → 2025 at a steady pace with the value at the tip → `annotate` the 350 ppm threshold as the curve crosses it; events appear as the line reaches them → `exit` fade. Sixteen seconds.

## Channel chrome notes

The series in the Pack's first voice; threshold in the annotation voice. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/co2-annotated-line.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
