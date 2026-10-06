# The citric acid cycle

**Kind:** preset
**Slug:** citric-acid-cycle
**Pack:** syntax

## Pitch

The engine of cellular respiration as a loop: the eight intermediates of the citric acid cycle appear in turn, each with the enzyme that makes it and the carbon dioxide, NADH, GTP or FADH₂ it releases, then a signal runs the cycle twice around. One `cycle` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)) at the kind's maximum of eight steps, both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "The citric acid cycle"
- Source: OpenStax Biology 2e, §7.3 "Oxidation of Pyruvate and the Citric Acid Cycle" (CC BY 4.0).
- Steps (product · enzyme · released): Citrate · citrate synthase; Isocitrate · aconitase; α-Ketoglutarate · isocitrate dehydrogenase · CO₂, NADH; Succinyl-CoA · α-ketoglutarate dehydrogenase · CO₂, NADH; Succinate · succinyl-CoA synthetase · GTP; Fumarate · succinate dehydrogenase · FADH₂; Malate · fumarase; Oxaloacetate · malate dehydrogenase · NADH.

## Motion plan

`reveal` draw around the loop from twelve o'clock → `propagate` twice around → `exit` fade. Sixteen seconds.

## Channel chrome notes

Steps take the Pack's sequence voices; arrows in the muted voice. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/citric-acid-cycle.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
