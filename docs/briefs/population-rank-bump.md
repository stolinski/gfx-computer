# The most populous countries, ranked

**Kind:** preset
**Slug:** population-rank-bump
**Pack:** syntax

## Pitch

Sixty-four years of population in one bump chart: today's twelve most populous countries ranked against each other from 1960 to 2024. The lines draw decade by decade, then the story takes three turns in focus — India passing China, Pakistan, Nigeria and Ethiopia climbing, Russia and Japan sliding. One `slope` Figure in `rank` mode ([ADR-0067](../adr/0067-figures-generated-visualization-domain.md)), both orientations.

## Surface(s) involved

`plain` with `backgroundFill: "pack"` carrying one Figure.

## Content sample

- Title: "The most populous countries, ranked"
- Source: World Bank World Development Indicators, SP.POP.TOTL (fetched 2026-10-06), in millions to one decimal place, for 1960, 1970, 1980, 1990, 2000, 2010, 2020 and 2024.
- Entities: the twelve most populous countries of 2024 (India, China, United States, Indonesia, Pakistan, Nigeria, Brazil, Bangladesh, Russia, Ethiopia, Mexico, Japan). Ranks are among these twelve, as the source note says; in early years a country outside the set (Germany) ranked among them worldwide.

## Motion plan

`reveal` fade (period axis) → `advance` 1960 → 2024 → `focus` India and China → `focus` Pakistan, Nigeria, Ethiopia → `focus` Russia, Japan → release → `exit` fade. Eighteen seconds.

## Channel chrome notes

One uniform line voice so focus does the storytelling; focused lines take the accent. No Pack-specific chrome.

## Engine work required

None beyond ADR-0067.

## ADR required?

already-filed: 0067-figures-generated-visualization-domain

## Open questions

## What 'done' looks like

`src/lib/presets/population-rank-bump.json` reads well at native horizontal and vertical under every Pack, passes the static checks, receives human aesthetic approval, and is included in the batched end-of-epic render matrix; no orientation-specific sibling Preset.
