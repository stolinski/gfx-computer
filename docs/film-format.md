# GFX Film format (`gfx-film@1`)

> **Stored, opened, selected, and played with hard cuts.** This format implements [ADR-0068](adr/0068-films-scenes-and-live-scene-boundaries.md) §1–3 and §8. The schema, ingress, and frame maths exist and are tested. A User composition is a Film: both stores read and write Film records (see [Stored records](#stored-records)), standalone JSON export writes a Film, and import reads one. The document open in the Workspace is a Film, and the edit transaction core, undo, and the Composition revision work on that Film (see [The open Film](#the-open-film)). A Film of several Scenes opens with its first Scene selected, any Scene can be selected, and playback runs through all of them with a hard cut at each boundary (ADR-0068 §4). Not built yet: a Scene GUI, operations that add, remove, or reorder Scenes, and any boundary but a cut. Export renders the whole Film (see [Export](#export)). A corpus Preset is still a Preset; [`preset-format.md`](preset-format.md) describes it and each Scene's `state`.

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

Film time in seconds is a Scene's first Film frame as exact seconds, plus Scene time (`filmSecondsAtSceneTime` in `film-transport.ts`). The Film's duration in seconds is that reading at the end of its last Scene (`filmDurationSeconds`). A one-Scene Film runs exactly its Scene's `durationSeconds`. Frame counts, never seconds, decide how many frames a Film has.

## Export

An export is the whole Film in one file ([ADR-0068](adr/0068-films-scenes-and-live-scene-boundaries.md) §2, §9; [`engine-architecture.md`](engine-architecture.md#film-export) has the mechanism).

- **Picture.** Every Scene is rendered in order at the Film's rate, orientation, and format. The file has `filmFrameCount` frames, and each frame is the frame its Scene shows at that Scene time. A cut is exact: the last frame of one Scene is followed by the first frame of the next.
- **Sound.** One track for the Film. Each Scene's cues and Video-clip audio start where its Scene starts and stop where its Scene stops. Nothing rings over a cut.
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
   - The whole Film must fit in 600 seconds, counted in frames at the Film's rate. This is the ceiling one composition already has (ADR-0068 §9).

## From a Preset

`filmFromPreset(preset, origin)` makes a one-Scene Film. The Film takes the Preset's `name`, `description`, and `pack`, and its `orientation`, `fps`, and `format` from the Preset's transport. The Scene gets its own copy of the state.

Two Preset fields are not carried:

- `kind`. It classifies a catalogue entry, and a Film is not one.
- `transition`. A transition Preset becomes a two-Scene Film in a later phase (ADR-0068 §3).

`presetFromFilmScene(film, sceneId)` goes the other way for one Scene. The Preset takes the Film's `name`, `description`, and `pack`, a copy of the Scene's state under the Film's transport, and `kind: "deliverable"`. `presetFromSingleSceneFilm(film)` is the same for a Film of exactly one Scene, and throws for any other number: it serves the one legacy record shape that can hold only one Preset (see [Writing](#writing)).

## The open Film

The document open in the Workspace is a Film of one or more Scenes (ADR-0068 §4, §8). The code is `src/lib/platform/film-state.svelte.ts` and `src/lib/platform/open-film-document.ts`; [`engine-architecture.md`](engine-architecture.md#the-open-document-is-a-film) describes how they fit the engine.

- A corpus Preset opens as an unsaved one-Scene Film through `filmFromCorpusPreset`. Its Scene takes the Preset's name, and its `origin` is `{ slug, contentKey }`, with the content key the Preset's poster uses.
- A stored composition opens as the Film its record holds, with each Scene's real `origin`. A legacy Preset record is lifted to a one-Scene Film first; its Scene's `origin` is `{ slug: meta.forkedFrom, contentKey: null }`.
- An opened corpus Preset is never saved from its own page. `composition.create-film-from-open` (New Film, in the Add to Film menu) stores the open document, edits included, as a new Film under a new slug, and `composition.add-open-to-film` adds it to a stored Film as that Film's last Scene. Nothing is ever stored under the corpus Preset's own slug.
- The selected Scene's state is live in engine state. The Film keeps the Scene list, each `name` and `origin`, the state of every other Scene, and the boundaries beside it. A Film opens with its first Scene selected. Selecting another Scene, Film time, and the hard cut are described in [`engine-architecture.md`](engine-architecture.md#scenes-the-two-clocks-and-the-cut).
- `kind` and `transition` are not Film fields. They travel beside the open Film as the legacy Preset envelope. `kind` stays because the open document is also how a corpus Preset is shown, and a stored Film opens as a `deliverable`. `transition` goes when a transition Preset is read as a two-Scene Film.
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

// Legacy. Read, and written only for a transition (below).
{ "meta": { "forkedFrom": "lower-third", "savedAt": "2026-10-01T12:00:00.000Z" }, "preset": {/* gfx@1 */} }
```

The disk store keeps this record as `<store>/<slug>.json`. The browser store keeps `savedAt` (and a legacy `forkedFrom`) flat on its own envelope, beside `film` or `preset`. A record holds exactly one of `film` and `preset`.

A Film record's `meta` holds `savedAt` only. Where a Scene came from is the Scene's own `origin`. `meta.forkedFrom` is read from a legacy record and carried through a save of it, so nothing a record already said is dropped.

### Reading

`readStoredUserCompositionRecord(record)` reads either shape and always returns a Film:

- A `film` record is parsed with `parseFilm`.
- A `preset` record is parsed as a Preset, so a document with the Legacy Supers schema id still loads ([ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)). It is then lifted with `filmFromPreset`. The Scene's `origin` is `{ slug: meta.forkedFrom, contentKey: null }`, or `null` when the record was not forked.

`userCompositionDocumentFromReading` turns that into what both stores hand back, a `UserCompositionDocument`: `{ film, legacyPresetEnvelope }`. A Film record's envelope is `{ kind: "deliverable" }`. A legacy record's envelope holds the `kind` and `transition` its Preset stated.

A Film of several Scenes reads and opens whole, in both stores. A write is checked the same way: the disk store proves the media of every Scene servable before it accepts the document.

Reading never rewrites a record. One older rule remains in the browser store: a record in a Legacy Supers shape is rewritten in its current Preset form the first time it is read (ADR-0053). It stays a Preset record.

### Writing

`userCompositionWriteShape(document)` chooses the shape, in one place, for both stores, the client transport, and JSON export:

- **A Film**, in every case but one. The first save of a legacy `{ meta, preset }` record therefore replaces it with `{ meta, film }`. `kind` is not saved: a user Film has none.
- **The legacy Preset**, while the document's envelope carries a `transition` (ADR-0068 §3). A Film cannot hold a two-endpoint transition until the live Scene boundaries change reads a transition Preset as a two-Scene Film. Until then such a record keeps `{ meta, preset }`, with its `kind`, so the recipe is not lost.

Neither store writes a record under a corpus Preset's slug. `/p/<corpus-slug>` always shows the pristine Starter, so both refuse with `UserCompositionStarterSlugError` (409 from the disk store).

### Posters

A User composition's poster key is `posterKeyForPreset` of the Film's first Scene as the Preset it would be alone (`storedPresetViewOfUserComposition`). A Film opens on its first Scene, so that is the Scene its card stands for; the card's Surface type and media are read from the same Scene. A one-Scene Film whose content equals a `deliverable` Preset has that Preset's key, so posters captured before stores wrote Films stay valid. A legacy record whose Preset said `kind: "fixture"` gets a new key once, because a Film does not save `kind`.
