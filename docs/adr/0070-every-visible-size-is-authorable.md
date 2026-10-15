# Every visible size is authorable

## Status

**Canon (rule adopted 2026-10-14).** Applied first to the `code` Diagram primitive and the `achievement` Overlay. Other Pipelines with fixed sizes are fixed as they are touched, and in the audit tracked in Dex.

## Context

On 2026-10-14 Scott found that the `achievement` Overlay's text size and box size could not be set, and that the new `code` Block had the same gap: its only size control was a uniform `scale` that grows text and box together, and its panel always fit its content. A Pipeline that hard-codes a size forces every Preset that uses it into one look, and no author — in the GUI or as an agent — can fix that without engine work. This contradicts ADR-0032 (GUI–agent parity) and ADR-0039 §4 (the engine owes authors the tools to compose each frame).

## Decision

1. **Every text size and every box a Pipeline draws is authored data.** Text size, box width, box height, and padding are each settable on their own. A uniform `scale` does not count: it changes them all together.
2. **Three surfaces, one field.** Each size is a field in the Preset JSON, a control in the Inspector, and an argument of a WebMCP operation in the operation inventory (ADR-0054). All three write the same field.
3. **The renderer's number is the default.** An absent field keeps today's look, so existing Presets render unchanged.
4. **Fitting boxes grow, never clip.** A box that fits its content takes a minimum width and height; it can be set larger than its content, never smaller.
5. **Sizes are in frame units.** Text sizes and box sizes are fractions of the frame's shorter side (`cqmin`), so a size reads the same in both orientations and at every export resolution.
6. **Done means settable.** A new or changed Pipeline is not done while a size it draws is fixed. An agent that touches a Pipeline with a fixed size fixes it in the same change. Briefs list each size and the field that sets it.

## Consequences

- Some Pipelines grow new optional fields, Inspector controls, and WebMCP arguments. Packs keep owning colour, type face, and material; sizes are the author's.
- A Pack Role that sets a size remains the Pack's default under the authored value: authored field → Pack Role → renderer default.

## Amendment 2026-10-14 — colours and icon sizes too

Scott found the achievement card's icon colour and icon size could not be set. The rule covers every visible property an author would reach for, not only text and box sizes:

- **Icon and mark sizes** and the **gap** between parts are sizes under §1.
- **Every part's colour** is authored data. An authored colour (`#RRGGBB`) wins over the Pack for that one part; absent, the Pack's colour renders (authored value → Pack Role → Pack core). This narrows ADR-0023's "appearance is the Pack's" the way ADR-0038 did for typography ink: the Pack supplies the defaults, the author may depart part by part.
- The Inspector shows each colour as a swatch of the colour that renders, with a reset that returns the part to its Pack (`AuthoredColorInput.svelte`).

The achievement card is the first to carry colours: background, border, icon, empty ring, kicker, chip, and title, plus icon size and gap.

