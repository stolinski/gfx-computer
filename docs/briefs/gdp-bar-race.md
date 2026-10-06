# The largest economies, 1990–2023

**Kind:** preset
**Slug:** gdp-bar-race
**Pack:** syntax

## Pitch

The bar chart race, done honestly: the ten largest economies by GDP from 1990 to 2023, re-ranking year by year at a steady pace, bar lengths always the true interpolated value, and the axis growing smoothly with the leader. It ends by setting aside everything but the two economies that pulled away. One `bar-race` Figure ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), full frame, both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "The largest economies, 1990–2023"
- Source: "World Bank · GDP, current US$" (indicator NY.GDP.MKTP.CD, fetched 2026-10-06)
- Sixteen economies, 34 yearly frames, ten visible at a time; values in trillions of US dollars.

## Motion plan

`reveal` grow (bars extend from zero, `smooth`) → `advance` 1990 → 2023 at a steady pace (no ease) over about 19 seconds → `focus` the United States and China → `exit` fade.

## Channel chrome notes

Uniform bars in the Pack's first series voice; the focus dims everything else. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/gdp-bar-race.json` passes the deterministic affected render matrix at native horizontal and vertical under every Pack, and its exact evidence bundle receives human aesthetic approval, with no orientation-specific sibling Preset.
