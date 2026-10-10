# GFX Film format (`gfx-film@1`)

> **Built: phase 1 of [ADR-0068](adr/0068-films-scenes-and-live-scene-boundaries.md), 2026-10-09.** A User composition is a Film. Both stores read and write Film records ([Stored records](#stored-records)), the document open in the Workspace is a Film ([The open Film](#the-open-film)), a Film of several Scenes plays with a hard cut at each boundary, Scenes are added, removed, reordered, and selected, and export renders the whole Film ([Export](#export)). Boundaries with a duration, the **fade** and the four **transition effects**, are built in the format, the frame maths, export, and the paused Workspace frame, and sound fades across them (phase 2, 2026-10-09; [A Scene boundary](#a-scene-boundary)); nothing edits a boundary yet. A Preset that states the legacy two-endpoint `transition` is read as a two-Scene Film, and the frozen-endpoint lane that used to draw it is gone ([From a Preset](#from-a-preset)). **Not built:** magic move, any operation or control that edits a boundary, and the Score. A corpus Preset is still a Preset; [`preset-format.md`](preset-format.md) describes it and each Scene's `state`. What an author and an agent do with a Film is in [`user-composition-workflows.md`](user-composition-workflows.md); how the engine holds one is in [`engine-architecture.md`](engine-architecture.md#the-open-document-is-a-film).

A **Film** is an ordered list of **Scenes** with a **Scene boundary** between each pair of neighbours. A Scene is one Preset's complete state, owned by the Film. A one-off piece is a Film with one Scene. Terms: [`CONTEXT.md`](CONTEXT.md).

A Film is one JSON document validated by `FilmSchema` (`src/lib/platform/film-schema.ts`). The machine-readable schema is `docs/film-format.schema.json`. Regenerate it with `pnpm gen:schema`; a test fails when the committed file is stale.

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
			"name": "Lower-third",
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

| Field    | Meaning                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | Lowercase letters, digits, and hyphens, starting with a letter or digit, at most 40 characters. Unique within the Film.                                                                                                                                                                                 |
| `name?`  | What the Scene is called. Optional; not empty when present. A Scene made from a corpus Preset takes the Preset's name. See [Scene names](#scene-names).                                                                                                                                                 |
| `origin` | Where the Scene was seeded from: `{ slug, contentKey }`, the source Preset's slug and its poster content key at that moment. `contentKey` is `null` when the key was never recorded (a Scene lifted from a legacy stored record). `null` for a Scene started blank. Required, so a writer states which. |
| `state`  | A complete Preset state: the same shape as `state` in [`preset-format.md`](preset-format.md).                                                                                                                                                                                                           |

`origin` is a record of the past. Editing the source Preset never changes a Film. Nothing links back, and nothing re-syncs.

### Scene names

A Scene's `name` is its own. It is not the Film's name, and renaming the Film does not change it.

- `filmFromCorpusPreset(preset, origin)` names the Scene for the Preset. A corpus Preset opens through it, and a Starter is stored through it. `composition.add-scene-from-starter` and `composition.add-open-to-film` name the Scene they add the same way.
- `filmFromPreset` gives the Scene no name. The blank composition, an imported Preset, and a legacy stored record use it. No stored record is rewritten to add a name.
- `filmSceneDisplayName(scene, sceneIndex)` in `src/lib/platform/film-scene-display-name.ts` says what the Scene strip and `composition.inspect` show: the Scene's `name`; if it has none, the name of the corpus Preset at `origin.slug`; if there is none, `Scene <n>`, counted from 1.

No operation renames a Scene yet.

### Scene ids

The first Scene of a Film made from one Preset is `scene-1` (`FILM_FIRST_SCENE_ID` in `film-ingress.ts`). A Scene an operation adds is `scene-<n>`, counted from one past the number of Scenes until the id is free (`mintFilmSceneId`). An id never changes when Scenes are reordered, so an agent can keep it.

### A Scene boundary

A boundary is an object with a `kind`: `cut`, `fade`, or the name of a registered transition effect.

```jsonc
{ "kind": "cut" }
{ "kind": "fade", "durationMs": 1000 }
{ "kind": "mask-wipe", "durationMs": 1200, "params": { "direction": "right", "softness": 0.001 } }
{ "kind": "seeded-shatter", "durationMs": 1900, "params": { "seed": 1337, "columns": 14, "scatter": 0.13, "rotation": 0.55, "depth": 0.6, "shadow": 0.35 } }
```

- **`cut`** shares no frames. The frame after the outgoing Scene's last is the incoming Scene's first.
- **`fade`** is a cross-fade that lasts `durationMs`. On each window frame the picture is `outgoing × (1 − p) + incoming × p` in premultiplied alpha, where `p` is the window's progress.
- **A transition effect** lasts `durationMs` and carries that effect's `params`. The kinds are the effects in the transition registry (`src/lib/platform/pipelines/transition-definition-registry.ts`): today `mask-wipe`, `particle-dissolve`, `sheet-peel`, and `seeded-shatter`. The union is built from the registry, so registering an effect adds its boundary kind, and `docs/film-format.schema.json` lists each kind with its parameters and their bounds. `params` is required; a parameter left out of it takes the effect's own default. `FILM_SCENE_BOUNDARY_KINDS` in `film-schema.ts` is every kind in picker order.

Every kind but the cut has a **window**: the last frames of the outgoing Scene and the first frames of the incoming Scene are the same Film frames, and both Scenes keep animating through them. The effect runs over the two live pictures on every window frame. There is no ease yet: the window's progress rises in equal steps, for a fade and for an effect alike.

A window's length in frames is `durationMs` at the Film's exact rate, rounded to the nearest whole frame, with half a frame rounding up. A 1000 ms window is 30 frames at both 30 and 29.97 fps, 24 at 24, and 60 at 59.94 and 60. Progress is `windowFrame ÷ (windowFrames − 1)`: 0 on the window's first frame, which is the outgoing Scene alone, and 1 on its last, which is the incoming Scene alone. That holds for every kind. A window of one frame is at progress 0.5.

Three rules bound a window, whatever its kind. Each is a validation finding at `boundaries/<index>/durationMs` ([Validation](#validation)), not a schema rule, because frames depend on the Film's rate:

1. It lasts at least one frame.
2. It is no longer than the shorter of its two Scenes.
3. The windows on either side of one Scene do not meet, so at most two Scenes are ever on one frame.

Magic move comes later as a further field of a boundary (ADR-0068 §5).

No operation edits a boundary, so a fade or an effect reaches a Film only through its JSON. `composition.add-scene-from-starter` and `composition.add-open-to-film` add a `cut` with the Scene, `composition.remove-scene` takes one away with it, and `composition.reorder-scene` leaves the list alone ([`engine-architecture.md`](engine-architecture.md#the-scene-strip-and-scene-operations)).

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
3. The Film's length is the sum of its Scenes' frame counts, minus the frames that boundaries overlap. A cut overlaps none. A fade or an effect overlaps its window.
4. A Scene starts where the one before it ends, less the window of the boundary between them. So after a fade the incoming Scene's first frame is the window's first frame.

For example, three Scenes of 0.36 seconds at 24 fps are 9 frames each, so the Film is 27 frames. Rounding the summed 1.08 seconds would give 26, which is why seconds are never summed.

And a 6-second Scene, a 1-second fade, and a 6.7-second Scene at 30 fps are 180 and 201 frames sharing 30, so the Film is 351 frames. The window is Film frames 150 to 179. Film frame 165 is frame 165 of the first Scene and frame 15 of the second, at progress 15/29.

Every timing inside a Scene (0 to 1 windows, Motion Beats, captions, `posterSeconds`) means what it meant in the Preset, because it is measured against the Scene's own duration.

`src/lib/platform/film-playhead.ts` holds the frame maths: `filmFrameCount`, `filmSceneFrameOffsets`, `filmSceneBoundaryOverlaps`, `resolveFilmFrame` (Film frame to Scene and local frame), `resolveFilmBoundaryWindowFrame` (both Scenes of a window frame, each with its local frame, and the progress), and `filmFrameForSceneFrame` (the inverse, for either Scene). A frame outside the Film is an error, not a clamp.

Inside a window `resolveFilmFrame` names the outgoing Scene, until the window ends. That is the Scene a seek into the window opens.

Film time in seconds is a Scene's first Film frame as exact seconds, plus Scene time (`filmSecondsAtSceneTime` in `film-transport.ts`). The Film's duration in seconds is that reading at the end of its last Scene (`filmDurationSeconds`). A one-Scene Film runs exactly its Scene's `durationSeconds`. Frame counts, never seconds, decide how many frames a Film has.

## Export

An export is the whole Film in one file ([ADR-0068](adr/0068-films-scenes-and-live-scene-boundaries.md) §2, §9; [`engine-architecture.md`](engine-architecture.md#film-export) has the mechanism).

- **Picture.** Every Scene is rendered in order at the Film's rate, orientation, and format. The file has `filmFrameCount` frames, and each frame is the frame its Scene shows at that Scene time. A cut is exact: the last frame of one Scene is followed by the first frame of the next. Inside a window each frame is both Scenes, each rendered live at its own Scene time, composited on the GPU by the boundary's fade or effect.
- **Sound.** One track for the Film. Each Scene's cues and Video-clip audio start where its Scene starts and stop where its Scene stops. Nothing rings over a cut. **Sound fades with the picture** (decided by Scott, 2026-10-09): across every window, of a fade or an effect, the outgoing Scene's sound fades out and the incoming Scene's fades in. Cues, beds, and Video-clip audio all take the same gain. The curve is equal-power: at position `t` in the window, from 0 at its first sample towards 1 at its end, the outgoing Scene is multiplied by `cos(t × π/2)` and the incoming Scene by `sin(t × π/2)`. The two sounds are unrelated signals, so their powers add; this pair keeps the summed power level, where a linear pair would drop it by 3 dB at mid-window. A Film of cuts mixes to exactly the bytes it did before.
- **Output class.** The file is opaque only when every Scene is opaque. A Film with one transparent Scene exports transparent (`gfx-overlay`), and its opaque Scenes paint their fill inside that file.
- **Length.** A `development` host exports up to 600 seconds. The `public` and `hosted` profiles keep 15 seconds.
- **The Workspace afterwards.** The export leaves the Scene, the frame, and the Composition revision as they were, and saves nothing.

A one-Scene Film exports exactly as its Scene did as a lone composition.

## Validation

Validation has two ordered layers, the same as a Preset:

1. `FilmSchema` validates the structure. It also refuses two Scenes with the same id and a boundary list of the wrong length.
2. `validateFilmSemantics(film)` checks meaning:
   - Each Scene goes through `validatePresetSemantics`, as the Preset it would be alone. Findings are reported under `scenes/<index>/state/...`.
   - The Pack is checked once, at `pack`.
   - Every window fits its Scenes, whether it is a fade's or an effect's: at least one frame, no longer than the shorter of its two Scenes, and not meeting the window on the other side of a Scene. Findings are reported at `boundaries/<index>/durationMs`. An effect's `params` are checked by the schema, against the effect's own parameter schema.
   - The whole Film must fit in 600 seconds, counted in frames at the Film's rate. This is the ceiling one composition already has (ADR-0068 §9).

## From a Preset

`filmFromPreset(preset, origin)` makes a one-Scene Film. The Film takes the Preset's `name`, `description`, and `pack`, and its `orientation`, `fps`, and `format` from the Preset's transport. The Scene gets its own copy of the state.

`kind` is not carried. It classifies a catalogue entry, and a Film is not one.

`presetFromFilmScene(film, sceneId)` goes the other way for one Scene. The Preset takes the Film's `name`, `description`, and `pack`, a copy of the Scene's state under the Film's transport, and `kind: "deliverable"`.

### A legacy transition Preset

A Preset may state the legacy top-level `transition { from, to, effect, durationMs, params }` ([`preset-format.md`](preset-format.md)). It is read as a two-Scene Film with one boundary (ADR-0068 §3). This is a reader only ([ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md): accept-old); nothing writes the form.

| The Film's                     | Comes from                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `name`, `description`, `pack`  | The transition Preset.                                                                                         |
| `orientation`, `fps`, `format` | The transition Preset's transport.                                                                             |
| Scene `scene-1`                | An owned copy of the `from` Preset's state, named for that Preset, with `origin` `{ slug: from, contentKey }`. |
| Scene `scene-2`                | The same for the `to` Preset.                                                                                  |
| The one boundary               | `{ kind: effect, durationMs, params }`, with the effect's defaults filled into `params`.                       |

Four things differ from how the frozen-endpoint lane drew the same Preset:

- **Both Scenes play whole.** Each Scene keeps its own duration, and the transition is the window they share. The Film runs both Scenes' frames less the window. The transition Preset's own `durationSeconds`, and the rest of its own `state`, are not used; the old lane never drew that state once its endpoints were captured.
- **Both Scenes move through the transition.** The old lane wiped between two stills, each taken at the middle of its endpoint.
- **One Pack.** A Film has one Pack (ADR-0068 §1), the transition Preset's. The old lane drew each endpoint under the endpoint's own Pack.
- **Footage is allowed.** The old lane refused an endpoint with Video clips; a boundary renders each Scene live.

`filmFromPreset` needs a way to look the two endpoints up, `options.resolveLegacyTransitionEndpoint`, because it does not import the catalogue. `resolveLegacyTransitionEndpointFromCatalog` (`legacy-transition-endpoint-catalog.ts`) is the corpus lookup the preset route, `applyPreset`, and the lifecycle operations pass. An endpoint that is not in the catalogue, or an effect that is not registered, is refused.

The four corpus fixtures `transition-*-demo.json` stay Preset files and open through this reader.

## The open Film

The document open in the Workspace is a Film of one or more Scenes (ADR-0068 §4, §8). The code is `src/lib/platform/film-state.svelte.ts` and `src/lib/platform/open-film-document.ts`; [`engine-architecture.md`](engine-architecture.md#the-open-document-is-a-film) describes how they fit the engine.

- A corpus Preset opens as an unsaved one-Scene Film through `filmFromCorpusPreset`. Its Scene takes the Preset's name, and its `origin` is `{ slug, contentKey }`, with the content key the Preset's poster uses.
- A stored composition opens as the Film its record holds, with each Scene's real `origin`. A legacy Preset record is lifted to a one-Scene Film first; its Scene's `origin` is `{ slug: meta.forkedFrom, contentKey: null }`.
- An opened corpus Preset is never saved from its own page. `composition.create-film-from-open` (New Film, in the Add to Film menu) stores the open document, edits included, as a new Film under a new slug, and `composition.add-open-to-film` adds it to a stored Film as that Film's last Scene. Nothing is ever stored under the corpus Preset's own slug.
- The selected Scene's state is live in engine state. The Film keeps the Scene list, each `name` and `origin`, the state of every other Scene, and the boundaries beside it. A Film opens with its first Scene selected. Selecting another Scene, Film time, and the hard cut are described in [`engine-architecture.md`](engine-architecture.md#scenes-the-two-clocks-and-the-cut).
- `kind` is not a Film field. It travels beside the open Film as the legacy Preset envelope. It stays because the open document is also how a corpus Preset is shown, and a stored Film opens as a `deliverable`.
- What is saved is the Film with every Scene (`readOpenFilmAsUserCompositionDocument`). `readOpenFilmAsSavedPreset` is the selected Scene as one Preset, for inspection and verification.

Every existing operation still edits a Preset-shaped draft of the selected Scene and reports the Scene's own pointers, such as `/state/overlays`. Its receipt names the Scene in `sceneId`. An edit to `name`, `description`, `pack`, or the transport's `orientation`, `fps`, or `format` lands on the Film's own field, because a Film has one of each.

## To and from JSON

- `parseFilm(value, options?)` reads a Film document: `FilmIngressSchema`, then `validateFilmSemantics`. It throws one error that names every finding.
- `filmToWireFormat(film)` writes a Film as JSON. Each Scene's state is written the same way `presetToWireFormat` writes a Preset's state, so annotation bodies are text again. Parsing the result gives back the same Film.

## Stored records

Both User composition stores keep one record per composition: its metadata beside one composition document (`src/lib/platform/user-composition-record.ts`).

```jsonc
// Film. Every write saves this shape.
{ "meta": { "savedAt": "2026-10-08T12:00:00.000Z" }, "film": {/* gfx-film@1 */} }

// Legacy. Read, never written.
{ "meta": { "forkedFrom": "lower-third", "savedAt": "2026-10-01T12:00:00.000Z" }, "preset": {/* gfx@1 */} }
```

The disk store keeps this record as `<store>/<slug>.json`. The browser store keeps `savedAt` (and a legacy `forkedFrom`) flat on its own envelope, beside `film` or `preset`. A record holds exactly one of `film` and `preset`.

A Film record's `meta` holds `savedAt` only. Where a Scene came from is the Scene's own `origin`. `meta.forkedFrom` is read from a legacy record and carried through a save of it, so nothing a record already said is dropped.

### Reading

`readStoredUserCompositionRecord(record)` reads either shape and always returns a Film:

- A `film` record is parsed with `parseFilm`.
- A `preset` record is parsed as a Preset, so a document with the Legacy Supers schema id still loads ([ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)). It is then lifted with `filmFromPreset`. The Scene's `origin` is `{ slug: meta.forkedFrom, contentKey: null }`, or `null` when the record was not forked.
- A `preset` record whose Preset states a `transition` is lifted to the two-Scene Film [above](#a-legacy-transition-preset). Its endpoints are looked up through `options.resolvePreset`, which every store passes, and each Scene's `origin` has a `null` content key. The lifted Film is then checked as a Film. A record whose endpoint is gone, or whose transition is longer than an endpoint, is refused with the finding.

`userCompositionDocumentFromReading` turns that into what both stores hand back, a `UserCompositionDocument`: `{ film, legacyPresetEnvelope }`. A Film record's envelope is `{ kind: "deliverable" }`. A legacy record's envelope holds the `kind` its Preset stated.

A Film of several Scenes reads and opens whole, in both stores. A write is checked the same way: the disk store proves the media of every Scene servable before it accepts the document.

Reading never rewrites a record. One older rule remains in the browser store: a record in a Legacy Supers shape is rewritten in its current Preset form the first time it is read (ADR-0053). It stays a Preset record.

### Writing

Every writer emits a Film: both stores, the client transport, and JSON export (`userCompositionDocumentWireBody`). The first save of a legacy `{ meta, preset }` record therefore replaces it with `{ meta, film }`, and that includes a legacy transition record, which is saved as its two-Scene Film. `kind` is not saved: a user Film has none.

Neither store writes a record under a corpus Preset's slug. `/p/<corpus-slug>` always shows the pristine Starter, so both refuse with `UserCompositionStarterSlugError` (409 from the disk store).

### Posters

A User composition's poster key is `posterKeyForPreset` of the Film's first Scene as the Preset it would be alone (`storedPresetViewOfUserComposition`). A Film opens on its first Scene, so that is the Scene its card stands for; the card's Surface type and media are read from the same Scene. So the key changes when the first Scene's state changes, when another Scene becomes the first, and when the Film's `name`, `description`, `pack`, `orientation`, `fps`, or `format` changes, because those are part of that Preset. It does not change when a later Scene is edited, added, removed, or moved, or when any Scene is renamed. The Workspace captures the poster only while the first Scene is the open one (`isOpenFilmShowingPosterScene`); with another Scene open it waits. A one-Scene Film whose content equals a `deliverable` Preset has that Preset's key, so posters captured before stores wrote Films stay valid. A legacy record whose Preset said `kind: "fixture"` gets a new key once, because a Film does not save `kind`.

### The browser store's limits

A Public demo session keeps Films in the browser store under the limits it had before Films: 4 MiB for the session and 1 MiB for one composition (`PUBLIC_COMPOSITION_SESSION_STORAGE_LIMITS`, ADR-0068 §9). The store counts two bytes for each UTF-16 code unit of the key and the stored JSON, which is what the browser charges.

Measured on 2026-10-09 with Films of corpus Starters (`browser-user-composition-store.test.ts`):

| Film                                                       | Stored bytes | Share of 1 MiB |
| ---------------------------------------------------------- | ------------ | -------------- |
| 1 Scene (`lower-third`)                                    | 2,440        | 0.2%           |
| 3 Scenes (adds captions and the largest Starter, a Figure) | 44,082       | 4.2%           |
| 6 Scenes                                                   | 96,568       | 9.2%           |
| 12 Scenes                                                  | 146,920      | 14.0%          |
| 56 Scenes of `kinetic-type-field` (55 fit)                 | 1,067,264    | refused        |

There is no ceiling on the number of Scenes other than the schema's 200. A save that would take a Film past 1 MiB is refused with `limit_exceeded`, and a save the session has no room for with `quota_exceeded`; the stored Film is left as it was. `composition.add-open-to-film` and every operation that creates a Film report that refusal as their failure. An edit to the open Film, adding a Scene included, is applied in memory first and saved by autosave, so there the refusal shows as the save error in the composition inspector.
