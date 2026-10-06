# Who meets whom in Les Misérables

**Kind:** preset
**Slug:** les-miserables-network
**Pack:** syntax

## Pitch

The cast of Les Misérables as a social network: the thirty most-connected characters grow in and settle into their circles — the students of the barricade, the Thénardiers' underworld, Fantine's friends, Valjean's household — then one line of influence lights up, from the bishop Myriel through Valjean and Marius to Enjolras at the barricade. One `network` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "Who meets whom in Les Misérables"
- Source: Donald E. Knuth, The Stanford GraphBase (1993), Les Misérables chapter co-appearances, via the vega-datasets `miserables.json` (fetched 2026-10-06). The thirty characters with the most co-appearance partners; 140 links weighted by shared chapters.
- Circles are named for the story (the dataset's numbered groups are an example clustering, not Knuth's): students, underworld, Fantine's circle, Valjean's circle.

## Motion plan

`reveal` grow, hubs first → hold → `focus` and `propagate` along Myriel → Valjean → Marius → Enjolras → release → `exit` fade. Sixteen seconds.

## Channel chrome notes

Circles take the Pack's sequence voices; link width follows shared chapters. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/les-miserables-network.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
