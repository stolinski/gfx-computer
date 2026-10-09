# GFX Film format (`gfx-film@1`)

> **Designed, not yet wired.** This format implements [ADR-0068](adr/0068-films-scenes-and-live-scene-boundaries.md) §1–2. The schema, ingress, and frame maths exist and are tested. Nothing in the app reads or writes a Film yet: the Workspace, the stores, export, and the operation inventory still work on one Preset. Until that changes, [`preset-format.md`](preset-format.md) describes what the engine loads.

A **Film** is an ordered list of **Scenes** with a **Scene boundary** between each pair of neighbours. A Scene is one Preset's complete state, owned by the Film. A one-off piece is a Film with one Scene. Terms: [`CONTEXT.md`](CONTEXT.md).

A Film is one JSON document validated by `FilmSchema` (`src/lib/platform/film-schema.ts`). The machine-readable schema is `docs/film-format.schema.json`. Regenerate it with `npm run gen:schema`; a test fails when the committed file is stale.

```jsonc
{
	"schema": "gfx-film@1",
	"name": "Launch film",
	"description": "Optional",
	"pack": "syntax",
	"orientation": "horizontal",
	"fps": 30,
	"format": "webm",
	"scenes": [
		{
			"id": "intro",
			"origin": { "slug": "lower-third", "contentKey": "9f2c41d07ab35e68" },
			"state": {/* a complete Preset state */}
		},
		{
			"id": "outro",
			"origin": null,
			"state": {/* a complete Preset state */}
		}
	],
	"boundaries": [{ "kind": "cut" }]
}
```

Every object the Film owns is strict. An unknown key is refused, never dropped.

## Fields

| Field          | Meaning                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `schema`       | Always `gfx-film@1`.                                                                                                |
| `name`         | Required, not empty.                                                                                                |
| `description?` | Optional text.                                                                                                      |
| `pack`         | One Pack for the whole Film. Same rule as a Preset's `pack`.                                                        |
| `orientation`  | `horizontal` or `vertical`, for the whole Film.                                                                     |
| `fps`          | An integer from 1 to 120, or `23.976`, `29.97`, or `59.94`, for the whole Film.                                     |
| `format`       | `webm` or `prores`, for the whole Film.                                                                             |
| `scenes`       | 1 to 200 Scenes, played in order.                                                                                   |
| `boundaries`   | Exactly one entry per pair of neighbouring Scenes: `scenes.length - 1` entries. A one-Scene Film has an empty list. |

There is no `score` field yet (ADR-0068 §6).

### A Scene

| Field    | Meaning                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | Lowercase letters, digits, and hyphens, starting with a letter or digit, at most 40 characters. Unique within the Film.                                                                            |
| `origin` | Where the Scene was seeded from: `{ slug, contentKey }`, the source Preset's slug and its poster content key at that moment. `null` for a Scene started blank. Required, so a writer states which. |
| `state`  | A complete Preset state: the same shape as `state` in [`preset-format.md`](preset-format.md).                                                                                                      |

`origin` is a record of the past. Editing the source Preset never changes a Film. Nothing links back, and nothing re-syncs.

### A Scene boundary

A boundary is an object with a `kind`. Today the only kind is a hard cut:

```jsonc
{ "kind": "cut" }
```

Fade, the transition effects, and magic move come later as further kinds (ADR-0068 §4–5).

## The Film's transport is the truth

`orientation`, `fps`, and `format` are stated once, on the Film. Each Scene's `state.transport` still has those three fields, so a Scene state is a complete engine state on its own.

When a Film is read (`FilmIngressSchema` in `src/lib/platform/film-ingress.ts`), the Film's three values are written into every Scene's `state.transport`:

- A Scene that leaves one of them out gets the Film's value.
- A Scene that states a different value has it replaced. This is not an error.

Each Scene keeps its own `transport.durationSeconds` and `transport.posterSeconds`.

## How Scene timing works

Film time is counted in whole frames, never in summed seconds. This keeps NTSC rates such as 29.97 from drifting.

1. The Film's `fps` resolves to an exact rate. `29.97` means 30000/1001 frames per second.
2. Each Scene's `durationSeconds` becomes a frame count on its own: rounded to the nearest whole frame, and never fewer than one. This is the same rule that gives a single Preset its frame count.
3. The Film's length is the sum of its Scenes' frame counts, minus any frames that boundaries overlap. A cut overlaps none.

For example, three Scenes of 0.36 seconds at 24 fps are 9 frames each, so the Film is 27 frames. Rounding the summed 1.08 seconds would give 26, which is why seconds are never summed.

Every timing inside a Scene (0 to 1 windows, Motion Beats, captions, `posterSeconds`) means what it meant in the Preset, because it is measured against the Scene's own duration.

`src/lib/platform/film-playhead.ts` holds the frame maths: `filmFrameCount`, `filmSceneFrameOffsets`, `resolveFilmFrame` (Film frame to Scene and local frame), and `filmFrameForSceneFrame` (the inverse). A frame outside the Film is an error, not a clamp.

## Validation

Validation has two ordered layers, the same as a Preset:

1. `FilmSchema` validates the structure. It also refuses two Scenes with the same id and a boundary list of the wrong length.
2. `validateFilmSemantics(film)` checks meaning:
   - Each Scene goes through `validatePresetSemantics`, as the Preset it would be alone. Findings are reported under `scenes/<index>/state/...`.
   - The Pack is checked once, at `pack`.
   - The whole Film must fit in 600 seconds, counted in frames at the Film's rate. This is the ceiling one composition already has (ADR-0068 §9).

## From a Preset

`filmFromPreset(preset, origin)` makes a one-Scene Film. The Film takes the Preset's `name`, `description`, and `pack`, and its `orientation`, `fps`, and `format` from the Preset's transport. The Scene gets its own copy of the state.

Two Preset fields are not carried:

- `kind`. It classifies a catalogue entry, and a Film is not one.
- `transition`. A transition Preset becomes a two-Scene Film in a later phase (ADR-0068 §3).
