# ADR-0068 — Films: Scenes, live Scene boundaries, magic move, and a Score

## Status

**Canon for phases 1 and 2, built 2026-10-09: Films of Scenes with hard cuts, and live Scene boundaries (the Scene frame stepper, the fade, the transition effects, the legacy transition Preset read as a two-Scene Film, and boundary authoring). The mark on the playback proxy, and phases 3–7, are designed, not built.** Planned 2026-10-08 with Scott; Dex epic `70u0qn13`.

| Section            | Built in phase 1                                                                                                                                                                                                                                                           | Designed, not built                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| §1 Film            | The `gfx-film@1` format, its validation, and its frame maths. A Film is the open document and the only thing either store writes.                                                                                                                                          | `score`.                                                                       |
| §2 Scene           | Owned copies with a recorded `origin` and an optional `name`; Film time in frames; whole-Film export.                                                                                                                                                                      | Nothing.                                                                       |
| §3 Forking retires | Fork-on-edit, shadowing, `?source=builtin`, and revert-to-starter are gone. A corpus Preset's page never saves. New Film and Add to Film make a Film. A Preset that states the two-endpoint `transition` is read as a two-Scene Film; the frozen-endpoint lane is deleted. | Nothing.                                                                       |
| §4 Scene boundary  | The hard cut, in preview and in export. The Scene frame stepper, the per-frame swap inside a window, the fade, and the four transition effects on two live Scenes: exact in export and under a paused playhead; a midpoint cut while playing. Sound fades across a window. | The mark on the playback proxy, and two mounted Scene trees.                   |
| §5 Magic move      | Nothing.                                                                                                                                                                                                                                                                   | All of it.                                                                     |
| §6 Score, §7 Hits  | Nothing.                                                                                                                                                                                                                                                                   | All of it.                                                                     |
| §8 Operations      | Five Scene operations in `composition`; one boundary operation in `motion`; `sceneId` in Scene-scoped receipts; one revision and one undo history for the Film; selection advances the revision.                                                                           | The `sound` rows for the Score; the `motion` rows for Hit reactions and pairs. |
| §9 Length          | 600 seconds on a `development` host, for picture and sound; 15 seconds on `public` and `hosted`; Films in the browser store under its existing limits.                                                                                                                     | Nothing.                                                                       |
| §10 Workspace      | The Scene strip, the Starter picker, and the Add to Film menu. Boundaries on the strip as selectable junctions, with their fields in the inspector.                                                                                                                        | The arrangement, the step grid, and the pattern editor.                        |

The phases, in order: 1 Film and hard cuts (built); 2 live Scene boundaries (built, but for the mark on the playback proxy); 3 magic move; 4 the Score; 5 Hit reactions; 6 real-time boundary preview with two mounted Scene trees; 7 the proof, a 60-second launch Film in both orientations. A section that is not built is not engine truth until its phase lands. The frozen-endpoint transitions of [ADR-0026](0026-transitions-v1-snapshot-and-wipe.md) are retired (2026-10-09): a stored document that states a two-endpoint `transition` reads as a two-Scene Film and is saved as one.

Current descriptions of what is built: [`../film-format.md`](../film-format.md) for the format and the stored record, [`../engine-architecture.md`](../engine-architecture.md#the-open-document-is-a-film) for the engine, and [`../user-composition-workflows.md`](../user-composition-workflows.md) for what an author and an agent do. The notes below record how phase 1 was built where this record did not say, and the list after them records each decision Scott changed along the way.

One thing differs from §3 as written. Shadow records an older build left in a disk store are re-keyed by a one-time script, `scripts/migrate-user-composition-shadow-records.ts`, not at runtime. A shadow record in a browser-scoped store is not migrated: it stays listed and can be deleted, its card opens the corpus Preset, and the store will not save over it.

Three notes on the cut as built (2026-10-09). Selecting a Scene is `composition.select-scene`, over the platform function `selectOpenFilmScene`; §8 says what selection does to the revision. Film time is not stored; it is read from the selected Scene and the Timeline's Scene time. A cut in live preview holds play while the incoming Scene mounts and settles, so playback is not real time across a cut; a paused frame is exact, and `scripts/cdp-film-cut-frames.mjs` is the check. _Export rendered the selected Scene only until 2026-10-09; see the export note below._

The fade as built (2026-10-09). [`../film-format.md`](../film-format.md#a-scene-boundary) is the format and [`../engine-architecture.md`](../engine-architecture.md#live-scene-boundaries) the engine.

- **`{ kind: 'fade', durationMs }`, a linear cross-fade in premultiplied alpha.** No authored ease. Its length in frames is `durationMs` at the Film's exact rate, rounded to the nearest frame. Progress is `windowFrame ÷ (windowFrames − 1)`, so the window's first frame is the outgoing Scene alone and its last the incoming Scene alone.
- **One function renders a Scene, and a window frame is two calls.** The Scene frame stepper (`film-scene-frame-stepper.ts`) is §4's steps 1 and 2. Export renders every frame through it. _The legacy snapshot controller, which did not use it, was deleted on 2026-10-09 when the transition Presets became two-Scene Films._
- **`fade` is not in the transition effect registry.** §4 lists the fade beside "an effect from the transition registry", as a kind of its own, and registering it would also offer it on a legacy two-endpoint transition. It is written to the registry's pass contract (a from-view, a to-view, a progress), so a boundary drives it and will drive a registered effect through the same compiled seam.
- **A Film frame inside a window names the outgoing Scene.** A seek into a window opens the outgoing Scene, until the window ends. §4 did not say.
- **A Scene has room for both its windows.** Validation refuses a fade shorter than one frame, longer than the shorter of its two Scenes, or meeting the fade on the other side of a Scene. The third rule is what keeps §2's "two Scenes share the frame only inside a boundary's window" true.
- **Paused is exact when the playhead arrives; an edit to a Scene shows the open Scene.** A Film-time seek or step into a window, and a pause inside one, render both Scenes and hold the blend on the canvas. Scrubbing the open Scene's own Timeline, selecting a Scene without a frame, or editing a Scene shows the open Scene alone until the playhead next arrives. Rendering the blend again after every edit would hold the composition in transit and refuse the next edit. _Two cases were made exact on 2026-10-09: a click inside a boundary's band on the Scene strip (and `composition.select-scene` on a stated frame) parks the playhead there and shows the blend, and `motion.set-scene-boundary` shows the blend again once it has applied._
- **The playback proxy is a cut at mid-window and is not marked yet.** §4 says the proxy is marked as one. No existing Workspace indicator fits a mark on the canvas, and none was invented; the mark waits for Scott's choice. _2026-10-09: the mark was moved to the Scene strip (the band of the boundary being played through). The Timeline and the transport have no in-progress treatment to reuse there either, so it is still not drawn._
- **Sound in a window was a plain sum.** _Replaced the same day: sound fades with the picture (see "Decisions changed during the build")._
- **Nothing edited a boundary at first.** _Replaced the same day by `motion.set-scene-boundary` and the strip's junctions; see "Boundary authoring as built" below._

The transition effects as boundaries, as built (2026-10-09). [`../film-format.md`](../film-format.md#a-scene-boundary) is the format and [`../engine-architecture.md`](../engine-architecture.md#live-scene-boundaries) the engine.

- **One boundary kind per registered effect.** `{ kind: '<effect type>', durationMs, params }`, built from the transition registry. A window's bounds are the fade's, and so is its linear progress.
- **Both Scenes are live on every window frame.** The stepper renders the outgoing and the incoming Scene into the two targets and the effect runs over them, in export and under a paused playhead, where the fade runs. The shaders did not change, as §4 expected.
- **No effect needed a redesign.** None of the four keeps state between frames or cuts its geometry from the picture: each is a function of the two views, the progress, and its params. So each is seekable and repeatable with moving inputs. `particle-dissolve` reads the outgoing picture's brightness to bias its dissolve, and now reads it from a picture that moves; whether that reads well is Scott's call, as the Consequences section says of every effect.
- **Sound fades with the picture.** See the 2026-10-09 decision below. This replaces "Sound in a window is a plain sum" above.
- **Playback is still the midpoint cut.**

The legacy transition Preset as built (2026-10-09). [`../film-format.md`](../film-format.md#a-legacy-transition-preset) is the reader.

- **A reader, not a migration.** `filmFromPreset` reads a Preset that states `transition { from, to, effect, durationMs, params }` as a two-Scene Film: Scene 1 an owned copy of the `from` Preset, Scene 2 of the `to` Preset, each named and with its `origin`, and one boundary of the effect. The four corpus fixtures stay Preset files. Nothing writes the form (ADR-0053: accept-old).
- **The Film takes the transition Preset's name, description, Pack, and transport.** The transition Preset's own duration and state are not used.
- **One Pack changes three fixtures.** The frozen lane drew each endpoint under the endpoint's own Pack. A Film has one Pack (§1), so both Scenes are drawn under the transition Preset's. Three of the four fixtures go from a `syntax` Preset to its `clean-light` re-dress, and under one Pack those two Scenes look much alike. Whether those fixtures should name another `to` Preset is Scott's call.
- **Both Scenes play whole.** The Film is the two Scenes less the window, where the frozen lane played only the wipe.
- **A stored legacy transition record** reads the same way and is saved as `{ meta, film }`. The writer's legacy-shape exception is deleted, and `LegacyPresetEnvelope` holds `kind` alone.
- **Deleted with the lane:** `transitionState`, the snapshot controller, the frame renderer's prepared-transition branch, the RootInspector's Transition section, `motion.set-composition-transition` and `motion.clear-composition-transition`, the audit's transition endpoint manifests, and the rule that refused Video clips on a transition Preset and its endpoints. The stepper decodes each Scene's own Video frame straight before it renders that Scene, so a boundary between two Scenes with footage needs no rule.

Boundary authoring as built (2026-10-09). [`../engine-architecture.md`](../engine-architecture.md#setting-a-scene-boundary) is the current description.

- **One operation, `motion.set-scene-boundary`,** in the family and exposure the deleted `motion.set-composition-transition` had, so the WebMCP tool count did not grow (it fell by one). It names a boundary by the Scene it follows.
- **`motion` owns what a boundary is; `composition` owns the list's membership.** See the §8 note.
- **The junction is a button on the Scene strip,** in its arrow-key order. Its fields show in the RootInspector where the Transition section was, through the same field components and each effect's own editor.
- **The proxy mark is not drawn.** See the fade note above.

A Scene has an optional `name` (2026-10-09), which §1 did not list. A Scene made from a corpus Preset takes the Preset's name; [`../film-format.md`](../film-format.md#scene-names) says what is shown for a Scene without one.

Export as built (2026-10-09). [`../engine-architecture.md`](../engine-architecture.md#film-export) is the current description.

- **The whole Film exports, picture and sound, on both lanes.** The plan is the Film's (`filmFrameCount`, one rate, orientation, and format); each frame is resolved to a Scene and a Scene frame; the swap to the next Scene is awaited, so a cut is frame-exact (§4).
- **Export does not select Scenes.** §8 says a change of the selected Scene advances the revision, however it happened. Export makes each Scene live through the same swap, inside an export bracket that is not a selection: it records no revision advance, holds the composition in transit for the whole export of a Film of several Scenes, and puts the author's Scene and frame back when the export is delivered, fails, or is cancelled. The revision, the undo history, and the stored Film are the same afterwards. The rule in §8 is unchanged: outside the bracket, `selectOpenFilmScene` is still the only way selection moves the revision, and it is refused while a bracket is open.
- **One mix (§6's "Scene sound cues are offset into Film time").** Each Scene's schedule is placed at its Scene's start sample and cut at its Scene's end. A hard cut is hard for sound too; a boundary with a duration will need its own rule for sound.
- **Opaque only when every Scene is.** Otherwise the file is transparent and an opaque Scene paints its fill inside it. §1 did not say; this is the reading that never paints a background a Scene did not ask for and never drops one it did.
- **The playhead tools are on Film time.** `playhead.inspect` and `playhead.seek-frame` report and take Film frames and seconds and name the Scene and Scene frame. A seek into another Scene is a selection (§8).
- **§9's 600 seconds now covers sound.** The audio bed is uploaded in parts ([ADR-0052](0052-public-runtime-and-retention-architecture.md), amended 2026-10-09).

The Scene operations and the Scene strip as built (2026-10-09, look chosen by Scott from mock-ups). [`../engine-architecture.md`](../engine-architecture.md#the-scene-strip-and-scene-operations) is the current description.

- **Five operations in `composition`, all core tools.** Add a Scene from a Starter, remove, reorder, select, and add the open Starter to a stored Film. They did not fit the WebMCP ceilings, so Scott raised them ([ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) 2026-10-09 amendment).
- **Select is a `view` operation**, not a write: it advances the revision and records no undo entry, as §8 decided. **Adding the open document to a Film is a lifecycle operation**, like New Film: it replaces the open document, so the history restarts and there is no undo entry.
- **Boundary rules, to revisit when a boundary can be more than a cut (§4).** A new Scene brings one `cut` on its leading side (trailing side when it is added first). Removing a Scene drops the boundary on its leading side (trailing side when it was first). Reordering leaves the boundary list alone, so kinds stay by position.
- **The `+` picker is visual.** Scott, 2026-10-09: "since presets are so visual we need a way to represent that". It shows the Starters as the home library's poster cards with one search field.
- **Not built from §8 and §10:** `sound` and `motion` rows for the Score, Hit reactions, and magic-move pairs; the arrangement, step grid, and pattern editor. _Boundaries on the strip were built later the same day._

Posters and the browser store as built (2026-10-09).

- **A Film's poster is its first Scene.** The content key is that Scene as the Preset it would be alone ([ADR-0061](0061-committed-composition-posters.md)), so an edit to a later Scene keeps the poster. The Workspace captures it only while the first Scene is the open one. It never opens the first Scene to take the picture.
- **The browser store's limits did not change (§9).** A 12-Scene Film of real Starters measures about 147 kB of the 1 MiB one composition may occupy. The store refuses a Film past the limit when it is saved, as `limit_exceeded`, and no ceiling on the number of Scenes was added.

### Decisions changed during the build

Each of these changed or settled what this record said when it was planned. The sections below are worded as decided now; where a sentence was replaced, it says so in place.

- **2026-10-09, §3 — a built-in Preset's page never saves.** As planned, the first edit to an opened corpus Preset created the Film. Scott: "we don't want modifications of presets to trigger new films now that a film is several presets"; for a built-in Preset, "try freely, add to film or create new film from changes".
- **2026-10-09, §3 — a Film is made on purpose.** **New Film** stores the open document as a new Film, and **Add to Film** adds it to a stored Film as that Film's last Scene. Nothing else creates one from a Preset's page.
- **2026-10-09, §3 — `?source=builtin` is deleted.** `/p/<corpus-slug>` always shows the corpus Preset, so the route takes no source parameter.
- **2026-10-09, §3 — shadow records are migrated once, by a script.** Not at runtime, and only in a disk store. Shadow copies in a browser session are ignored.
- **2026-10-09, §8 — selecting a Scene advances the Composition revision and records no undo entry.**
- **2026-10-09, §8 — a Scene-scoped receipt names its Scene in `sceneId`.** Its pointers stay relative to the Scene.
- **2026-10-09, §8 — five Scene operations, all in `composition`, all core tools.** They did not fit the WebMCP ceilings, so the core ceiling rose from 20 to 23 and the disclosed ceiling from 37 to 42 ([ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md), amended the same day).
- **2026-10-09, §1 — a Scene has an optional `name`.** A Scene made from a corpus Preset takes the Preset's name.
- **2026-10-08 and 2026-10-09, §9 — the `development` profile's 600 seconds is a profile of its own, and covers sound.** The profile's limits landed on 2026-10-08. On 2026-10-09 the audio bed became an upload in ordered parts, and the finished file a stream to disk instead of a Blob held in the page ([ADR-0052](0052-public-runtime-and-retention-architecture.md), amended on each date).
- **2026-10-09, §4 and §6 — sound fades with the picture.** Decided by Scott. In every boundary window with a duration, of a fade or an effect, the outgoing Scene's sound fades out and the incoming Scene's fades in, on an equal-power curve (`cos` and `sin` of a quarter turn), for cues, beds, and Video-clip audio alike, in the one deterministic Film mix. As first built, both Scenes sounded at full level through a window. A Film of cuts mixes to the same bytes as before.
- **2026-10-09, §8 — `motion` owns what each boundary is.** As planned, `composition` owned boundaries whole. The boundary operation replaced the deleted transition row one for one, in the `motion` family, so the tool count did not grow. `composition` keeps the membership of the boundary list, which grows and shrinks with the Scene list.
- **2026-10-09, §10 — the Starter picker is visual.** Scott: "since presets are so visual we need a way to represent that".
- **2026-10-09, §10 — Add to Film is one menu.** New Film is its first entry and each stored Film follows, so an unsaved Starter's top bar has one action.

Date: 2026-10-08

Builds on: [ADR-0002](0002-per-tool-routes-to-preset-engine.md) (one Preset engine), [ADR-0033](0033-sound-design-motion-emitted-cues.md) (deterministic mix), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (both orientations, Pack-neutral), [ADR-0046](0046-seekable-simulation-and-deformation-families.md) (typed transition effects), [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (legacy readers before writers), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations), [ADR-0064](0064-kinetic-type-word-fields.md) (Motion Beats)

Supersedes: [ADR-0032](0032-gui-agent-parity-authoring.md) §3–4 (fork-on-edit, the User composition as a standalone Preset), since phase 1 on 2026-10-09

Supersedes: the two-endpoint form of [ADR-0022](0022-multi-state-composition.md) and the frozen endpoints of [ADR-0026](0026-transitions-v1-snapshot-and-wipe.md), since phase 2 on 2026-10-09

Depends on: [ADR-0069](0069-strudel-score-ships-in-local-builds-only.md) (the Score is an internal tool; GFX is not relicensed)

## Context

GFX makes one-off pieces. A Preset is one composition with one duration, and nothing connects one Preset to the next. A person who wants a launch video, an explainer, or any piece with more than one idea has to export each Preset and cut them together in an editor. The roadmap even said so: "transitions remain editorial decisions in DaVinci Resolve."

The reference Scott brought on 2026-10-08 is the Paper Mono launch video and the tool that made it: one 60-second film of 15 shots over 27 bars of music written in Strudel. Every shot starts on a bar. A step grid shows kick, snare, hats, and bass for the current bar, and motion lands on those hits. Scott's direction: "we need to massively step up our game."

His model, in his words: "a preset is a preset, a scene is the application of that preset used within a film." A film moves between scenes by magic-move transforms, fades, or shader effects. And: "to me this replaces forking presets conceptually."

Three things in the engine stand in the way:

- **One engine state.** `engineState`, `packState`, and `animState` are module singletons read by 136 files. Two compositions cannot be mounted at once.
- **Frozen transitions.** ADR-0026 renders each endpoint once, at mid-progress, and wipes between two stills. Nothing moves during a transition.
- **Export stops at 15 seconds.** `PUBLIC_EXPORT_RUNTIME_LIMITS` applies on the local origin too.

[ADR-0066](0066-preset-clips-and-render-in-place.md) tried to connect Presets by rendering one into footage and was withdrawn the day it was written. This record does not revive it: a Scene is live composition state, never rendered media.

## Decision

### 1. A Film is the only thing a user makes

A **Film** is an ordered list of **Scenes**, a **Scene boundary** between each pair of neighbours, and one optional **Score**. Its wire format is `gfx-film@1`:

- `name`, `description?`
- `pack`: one Pack for the whole Film
- `orientation`, `fps`, `format`: one transport for the whole Film, stamped into each Scene's transport at ingress so `EngineStateSchema` does not change
- `scenes[]`: `{ id, name?, origin, state }` (`name` added 2026-10-09)
- `boundaries[]`: one entry per pair of neighbours
- `score?` (§6)

A one-off piece is a Film with one Scene. There is no second artifact kind.

A Film ships both orientations, each art-directed, exactly as a Preset does (ADR-0039 §4). Each Scene's state already carries its per-orientation placements and motion. The Film's orientation is the same dial the transport has today.

### 2. A Scene is an owned copy of a Preset

A **Scene** holds a complete engine state. It is seeded from a Preset and then belongs to the Film. `origin` records where it came from (`{ slug, contentKey }`, the content key that posters use, ADR-0061) and is `null` for a Scene started blank. Editing the source Preset never changes a Film. Nothing links back, and nothing re-syncs.

Each Scene keeps its own `transport.durationSeconds`, so every existing timing (0..1 windows, Motion Beats in ms, captions, `posterSeconds`) stays valid inside its Scene. Film length is the sum of the Scenes' frame counts minus the frames that boundaries overlap. Film time is counted in frames, never in summed seconds, so NTSC rates do not drift.

Scenes play strictly in order. Two Scenes share the frame only inside a boundary's window.

### 3. Forking and the two-endpoint transition Preset retire

- **Fork-on-edit goes, and a Preset's page never saves.** Opening a corpus Preset and editing it changes only the open document: undo, redo, and revisions work, nothing is stored, and leaving the page discards the changes. A Film is made on purpose, by one operation that stores the open document, edits included, as a new Film under a new slug with that Preset as its one Scene. Shadowing a Starter under its own slug, `?source=builtin`, and revert-to-starter all go, together with their operation rows, tools, and GUI. Shadow records an older build stored in a disk store are re-keyed once, by a script; shadow copies in a browser session are ignored. _Changed by Scott on 2026-10-09. This bullet first said the first edit to an opened corpus Preset creates the Film. His reason: "we don't want modifications of presets to trigger new films now that a film is several presets"; for a built-in Preset, "try freely, add to film or create new film from changes". Adding the open document to an existing Film is `composition.add-open-to-film` (§8), built the same day._
- **User compositions become Films.** Both stores (disk and browser) read the old `{ meta, preset }` record and the new `{ meta, film }` record, and lift an old record to a one-Scene Film. Readers ship before writers (ADR-0053). Writers then emit Films only.
- **Transition Presets become two-Scene Films.** The top-level `transition { from, to, effect, durationMs, params }` form is read as a two-Scene Film with one boundary. This waits for §4, because under hard cuts the effect would be lost. _Built 2026-10-09 as a reader; the open document's legacy envelope `transition` field and the writer's legacy-shape exception are deleted. See "The legacy transition Preset as built" under Status._
- **Corpus Presets do not change.** A Preset under `src/lib/presets/` stays a single Preset with its checks, matrix lanes, and committed poster. It is the catalogue a Film draws Scenes from.

### 4. A Scene boundary is live on both sides

A boundary is one of:

- `cut`: no shared frames.
- `fade`: a cross-fade.
- an effect from the transition registry (`mask-wipe`, `particle-dissolve`, `sheet-peel`, `seeded-shatter`, and later ones).
- any of the above with a **magic move** (§5).

A boundary with a duration overlaps the tail of the outgoing Scene and the head of the incoming one. **Both Scenes keep animating through the window.** This replaces ADR-0026's frozen mid-progress stills.

How a window frame is made, given one engine state:

1. Apply the outgoing Scene's state, scrub it to its local frame, wait for a real paint, and capture it to texture A.
2. Do the same for the incoming Scene into texture B.
3. Run the boundary effect over A and B. The four registered effects already take a from-view and a to-view per frame, so their shaders do not change.

This per-frame swap is exact and is the law for export and for a paused playhead. It is not real-time. _Built 2026-10-09 for the fade and for the four registered effects: steps 1 and 2 are the Scene frame stepper, and step 3 is the fade or the effect, through one compiled pass contract. No effect's shader changed. See "The fade as built" and "The transition effects as boundaries, as built" under Status._ While a Film plays in the Workspace, a boundary window shows a proxy, and the proxy is marked as one. Real-time, pixel-exact boundary playback needs two Scene trees mounted at once, which means moving the three state singletons to per-tree context. That is phase 6 of the epic and is planned work, not a maybe.

A hard cut swaps the engine state at the boundary frame. In export the swap is awaited, so the cut is frame-exact.

### 5. Magic move

A **magic move** carries a shared element from where it sits in the outgoing Scene to where it sits in the incoming Scene, in one continuous motion, while the rest of the frame runs the boundary's fade or effect.

- **Pairs are authored.** `boundary.magicMove.pairs` is a list of `{ from: { kind, id }, to: { kind, id } }`. When an element in each Scene has the same kind and id, the pair is suggested; the author confirms it.
- **Mechanism.** In each Scene pass the paired element is left out of the Scene's capture and captured alone in its own frame-sized root, and its bounds are measured. After the two Scene textures composite, one quad is drawn with the rect and rotation interpolated from A to B and the two element textures cross-faded. Geometry is measured per orientation, never stored.
- **What can move, in order of delivery:** Overlays; then Diagram `node`, `label`, and `stat-callout` primitives and Kinetic Words.
- **What cannot:** marks, surface messages, and checklist items (their ids are positions in a list), the Surface itself, Stage bodies, chart marks, and an Overlay that runs its own shader pass. Semantic validation refuses a pair that names one, with its path.

### 6. The Score

A Film may carry one **Score**: music written as Strudel pattern code, a tempo, and named sections measured in bars.

- **Bars place Scenes.** With a Score, a Scene start and a boundary snap to bars. The Score, not a seconds field, is then the clock the author reads. V1 has one tempo per Film, so every bar is the same length.
- **Hits come from the pattern.** Strudel's `queryArc` returns the pattern's events for any time span without playing sound. GFX queries it and derives **Hit lanes**: named, ordered lists of hit times (kick, snare, hats, bass, or whatever the pattern labels). Lanes are derived from the pattern, never hand-authored, the way sound cues are derived from motion today. They are kept with the bake so a build without Strudel can read them (ADR-0069).
- **Sound is baked.** Strudel's synthesis uses `Math.random` for noise, reverb, and oscillator phase, so two renders of one pattern differ. GFX requires preview and export to match. So a Score is rendered once, offline, at 48 kHz stereo, to PCM keyed by a hash of the pattern, tempo, and sample set. The mix and every export use that bake. Changing the pattern makes the bake stale, and the GUI shows it. Live Strudel playback is for writing the pattern; the bake is what ships.
- **The bake joins the existing mix.** It enters `renderAudioMix` as one more PCM source, summed by the same hand-written loop that keeps the mix byte-stable. Scene sound cues are offset into Film time and summed with it.
- **Pattern code runs in a sandbox.** Strudel evaluates a pattern with `Function()`, so a pattern is arbitrary JavaScript. A Film can arrive from a file or from an agent. GFX therefore evaluates patterns, queries hits, and bakes audio inside a sandboxed frame with no access to the app's origin, storage, or network, and takes back only JSON hits and PCM.
- **Samples are vendored.** No sample is fetched from another origin at preview or export time. Only packs with a clear licence ship (CC0 and Unlicense first). Synth voices need no samples.

### 7. Hits drive motion

A **Hit reaction** binds a Hit lane to an animatable channel of one element: on every hit in the lane, the channel takes a short authored impulse (amount, attack, decay). This is the generalisation of Motion Beats (ADR-0064): a Motion Beat is one named moment an author places by hand, and a Hit lane is many moments the Score supplies. Motion Beats stay as they are. Reactions are evaluated per frame from the derived hit list by the one animation manifest, so preview equals export.

### 8. Operations

Films add no sixteenth operation family.

- `composition` owns Scene membership (`/scenes`: add from a Starter, remove, reorder, select) and the membership of the boundary list (`/boundaries`: a boundary arrives and leaves with its Scene). `motion` owns what each boundary is (`/boundaries/*`: its kind, duration, and effect params). _Built 2026-10-09 as five `composition` rows, all core tools: `composition.add-scene-from-starter`, `remove-scene`, `reorder-scene`, `select-scene`, and `add-open-to-film`. The WebMCP ceilings rose to 23 core and 42 disclosed tools to hold them (ADR-0054). Changed 2026-10-09: this bullet first gave `composition` the boundaries whole. `motion.set-scene-boundary` took the place of the deleted `motion.set-composition-transition`, so no ceiling moved, and the two families split the pointer the way `layer` and `placement` split an Overlay._
- Existing operations keep their `/state/...` pointers and act on the selected Scene. A receipt for a Scene-scoped change names that Scene in one added field, `sceneId`, and its pointers stay relative to the Scene; they are not prefixed. A receipt for a Film-level change (Scene membership, boundaries) names Film pointers and has no `sceneId`.
- `sound` owns the Score. `motion` owns Hit reactions and magic-move pairs.
- One **Composition revision** and one undo history cover the whole Film.
- **Changing the selected Scene advances the Composition revision and records no undo entry.** _Decided by Scott on 2026-10-09._ Existing operations act on the selected Scene, so an operation that carries a revision read before the Scene changed would otherwise land in a Scene its caller never looked at. It now fails as `stale_revision` and applies nothing. This holds however the Scene changed: a direct selection, a Film-time seek that crosses into another Scene, or a playback cut. Selecting the Scene that is already selected changes nothing. Selection is not an edit, so there is nothing to undo, and what could be redone stays redoable. Undo and redo restore the whole Film as the edit left it, including which Scene was open, so undoing an edit made in another Scene opens that Scene; that is one advance of the revision, the undo's own. A Film-level edit may move the selection as part of what it changes (removing the selected Scene), but one that changes nothing else is refused as a defect, so `selectOpenFilmScene` is the only way selection alone moves the revision.

Every new capability lands with its inventory row and its GUI surface together (ADR-0054).

### 9. Length and profiles

- The local development profile gets its own export limit of 600 seconds, the schema's existing ceiling for one composition, applied to a whole Film. _Built 2026-10-08 and 2026-10-09: the limit covers picture and sound, the audio bed is uploaded in ordered parts, and the finished file is streamed to disk (ADR-0052)._
- The `public` and `hosted` profiles keep 15 seconds. Films are local-first. Raising a hosted limit is a later decision made from measured browser export times.
- A Public demo session holds Films in the browser store with the same storage limits it has today. _Confirmed 2026-10-09: 4 MiB a session and 1 MiB a composition, unchanged, with no ceiling on the number of Scenes._

### 10. What the Workspace shows

- A **Scene strip**: the Scenes in order, the selected one open for editing in the existing Timeline, the boundaries between them. _Built 2026-10-09: a row between the transport and the Timeline of a stored Film, one segment per Scene, each as wide as its share of the Film's frames; a cut is the line between two segments, and since the same day each junction is a button: a boundary with a duration is a band over the frames its two Scenes share, and selecting a junction opens the boundary's fields in the inspector. Its `+` opens a visual picker of the Starters, shown as the home library's poster cards. An unsaved Starter has no strip; its top bar has one action, the **Add to Film** menu._
- With a Score: an **arrangement** of sections and bars with the Scenes laid against it, and a **step grid** of the Hit lanes for the bar under the playhead.
- A code editor for the pattern.

These are visual work. Each is shown to Scott as frames before it is verified, and no control is added that the direction did not ask for.

## Consequences

- One artifact kind for users. "Start from a Preset" and "add another idea" are the same act.
- The user store, the edit transaction core, undo, autosave, posters, the home listing, and about 25 operation test files move from one Preset to one Film. This is the largest single change in the epic.
- ADR-0026's snapshot controller becomes a per-frame Scene stepper. Its frozen-progress constant and prepared-once cache are deleted.
- Shatter and dissolve will show moving content inside their shards. Whether that reads well is Scott's call per effect.
- Export inside a boundary window costs two Scene renders per frame, roughly two to three times the per-frame time there.
- Until phase 6, playback through a boundary is a proxy. Paused frames and exports are exact.
- GFX uses a music engine it does not own, in local builds only (ADR-0069), and a sandbox to hold it. Where Strudel is absent a Film plays and exports from its bake.

## Rejected

- **A live link from a Scene to its Preset, with overrides.** Preset edits would silently change finished Films, and it needs an override model plus a broken-link story. Scott chose the owned copy.
- **Keeping the User composition beside the Film.** Two artifact kinds for one act. Scott chose one.
- **Rendering a Scene to footage** (ADR-0066's render in place). A boundary needs live motion on both sides and a magic move needs live geometry.
- **Starting with two mounted Scene trees.** It is the right end state and a 136-file refactor. The per-frame swap proves the model, the effects, and magic move first, and is already how the snapshot controller and the audit loop work.
- **Caching boundary frames on the GPU.** One 3840×2160 frame is 33 MB; a half-second window is about 1 GB per boundary.
- **A music engine of our own, or Strudel as a separate program.** Scott chose to bundle Strudel, in local builds only (ADR-0069).
- **Detecting hits from an imported audio file.** Hits would be guesses that the author then corrects by hand.
- **Using Strudel's live output in export.** It is not repeatable; the bake is.
- **Stacked tracks, Films inside Films, footage that spans Scenes.** GFX is not an editor. After Effects is the quality ceiling, not the architecture.
