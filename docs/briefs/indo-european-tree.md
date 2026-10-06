# Where English comes from

**Kind:** preset
**Slug:** indo-european-tree
**Pack:** syntax

## Pitch

A family tree that grows: the Indo-European languages branch out from Proto-Indo-European to fifteen modern languages, then the frame dims everything but one lineage — Proto-Indo-European, Germanic, West Germanic, English — and English pulses. One `tree` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), growing left to right in both orientations: wide in the horizontal frame, a tall list of leaves in the vertical one.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "Where English comes from"; source note: "Indo-European language family, simplified"
- Six branches (Germanic, Italic, Balto-Slavic, Indo-Iranian, Hellenic, Celtic), their sub-branches, and fifteen languages.

## Motion plan

`reveal` grow (branches extend from the root outward, `settled`) → `focus` the English lineage (only its links stay lit) → `pulse` English → `exit` fade. Fourteen seconds.

## Channel chrome notes

Branches take the Pack's series voices; the focused lineage takes the accent. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/indo-european-tree.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
