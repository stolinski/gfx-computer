# ADR-0068 — Films: Scenes, live Scene boundaries, magic move, and a Score

## Status

**Designed, not built — phase 1 in progress: schema, readers, open document, writers, and hard-cut playback landed** (planned 2026-10-08 with Scott; Dex epic `70u0qn13`). Built: §1–2, §3's first two points (fork-on-edit is gone and both stores write Films), §4's hard cut (a Film of several Scenes opens, any Scene can be selected, and play and scrub run through every Scene with a cut at each boundary), and §8's transaction core. The rest of this record is not engine truth until its phase lands. Until then the frozen-endpoint transitions of [ADR-0026](0026-transitions-v1-snapshot-and-wipe.md) remain current, and a stored document that carries a two-endpoint `transition` keeps the legacy Preset record shape.

One thing differs from §3 as written. Shadow records an older build left in a disk store are re-keyed by a one-time script, `scripts/migrate-user-composition-shadow-records.ts`, not at runtime.

Three notes on the cut as built (2026-10-09). Selecting a Scene is a platform function, not yet an operation: it records no undo entry and does not advance the Composition revision, and §8's `select` row lands with the Scene strip. Film time is not stored; it is read from the selected Scene and the Timeline's Scene time. A cut in live preview holds play while the incoming Scene mounts and settles, so playback is not real time across a cut; a paused frame is exact, and `scripts/cdp-film-cut-frames.mjs` is the check. Export still renders the selected Scene only.

Date: 2026-10-08

Builds on: [ADR-0002](0002-per-tool-routes-to-preset-engine.md) (one Preset engine), [ADR-0033](0033-sound-design-motion-emitted-cues.md) (deterministic mix), [ADR-0039](0039-pack-neutral-compositions-and-listing-hygiene.md) (both orientations, Pack-neutral), [ADR-0046](0046-seekable-simulation-and-deformation-families.md) (typed transition effects), [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (legacy readers before writers), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations), [ADR-0064](0064-kinetic-type-word-fields.md) (Motion Beats)

Supersedes when built: [ADR-0032](0032-gui-agent-parity-authoring.md) §3–4 (fork-on-edit, the User composition as a standalone Preset), the two-endpoint form of [ADR-0022](0022-multi-state-composition.md), and the frozen endpoints of [ADR-0026](0026-transitions-v1-snapshot-and-wipe.md)

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
- `scenes[]`: `{ id, origin, state }`
- `boundaries[]`: one entry per pair of neighbours
- `score?` (§6)

A one-off piece is a Film with one Scene. There is no second artifact kind.

A Film ships both orientations, each art-directed, exactly as a Preset does (ADR-0039 §4). Each Scene's state already carries its per-orientation placements and motion. The Film's orientation is the same dial the transport has today.

### 2. A Scene is an owned copy of a Preset

A **Scene** holds a complete engine state. It is seeded from a Preset and then belongs to the Film. `origin` records where it came from (`{ slug, contentKey }`, the content key that posters use, ADR-0061) and is `null` for a Scene started blank. Editing the source Preset never changes a Film. Nothing links back, and nothing re-syncs.

Each Scene keeps its own `transport.durationSeconds`, so every existing timing (0..1 windows, Motion Beats in ms, captions, `posterSeconds`) stays valid inside its Scene. Film length is the sum of the Scenes' frame counts minus the frames that boundaries overlap. Film time is counted in frames, never in summed seconds, so NTSC rates do not drift.

Scenes play strictly in order. Two Scenes share the frame only inside a boundary's window.

### 3. Forking and the two-endpoint transition Preset retire

- **Fork-on-edit goes, and a Preset's page never saves.** Opening a corpus Preset and editing it changes only the open document: undo, redo, and revisions work, nothing is stored, and leaving the page discards the changes. A Film is made on purpose, by one operation that stores the open document, edits included, as a new Film under a new slug with that Preset as its one Scene. Shadowing a Starter under its own slug, `?source=builtin`, and revert-to-starter all go, together with their operation rows, tools, and GUI. _Changed by Scott on 2026-10-09. This bullet first said the first edit to an opened corpus Preset creates the Film. His reason: "we don't want modifications of presets to trigger new films now that a film is several presets"; for a built-in Preset, "try freely, add to film or create new film from changes". Adding the open document to an existing Film belongs to the Scene operations (§8) and is not built._
- **User compositions become Films.** Both stores (disk and browser) read the old `{ meta, preset }` record and the new `{ meta, film }` record, and lift an old record to a one-Scene Film. Readers ship before writers (ADR-0053). Writers then emit Films only.
- **Transition Presets become two-Scene Films.** The top-level `transition { from, to, effect, durationMs, params }` form is read as a two-Scene Film with one boundary. This waits for §4, because under hard cuts the effect would be lost.
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

This per-frame swap is exact and is the law for export and for a paused playhead. It is not real-time. While a Film plays in the Workspace, a boundary window shows a proxy, and the proxy is marked as one. Real-time, pixel-exact boundary playback needs two Scene trees mounted at once, which means moving the three state singletons to per-tree context. That is phase 6 of the epic and is planned work, not a maybe.

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

- `composition` owns Scene membership (`/scenes`: add from a Starter, remove, reorder, select) and boundaries (`/boundaries`).
- Existing operations keep their `/state/...` pointers and act on the selected Scene. A receipt for a Scene-scoped change names that Scene in one added field, `sceneId`, and its pointers stay relative to the Scene; they are not prefixed. A receipt for a Film-level change (Scene membership, boundaries) names Film pointers and has no `sceneId`.
- `sound` owns the Score. `motion` owns Hit reactions and magic-move pairs.
- One **Composition revision** and one undo history cover the whole Film.

Every new capability lands with its inventory row and its GUI surface together (ADR-0054).

### 9. Length and profiles

- The local development profile gets its own export limit of 600 seconds, the schema's existing ceiling for one composition, applied to a whole Film.
- The `public` and `hosted` profiles keep 15 seconds. Films are local-first. Raising a hosted limit is a later decision made from measured browser export times.
- A Public demo session holds Films in the browser store with the same storage limits it has today.

### 10. What the Workspace shows

- A **Scene strip**: the Scenes in order, the selected one open for editing in the existing Timeline, the boundaries between them.
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
