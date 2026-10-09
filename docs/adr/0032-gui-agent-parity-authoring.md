# ADR-0032 — GUI ↔ agent parity: local round-trip authoring on the shared Preset

## Status

**Canon.** Fork/autosave persistence, create-from-blank, schema coverage, the three-zone authoring interface, standalone interchange, GUI validation/verification, shared agent store access, and deterministic automated rendering are shipped. Operational workflows are documented in [`user-composition-workflows.md`](../user-composition-workflows.md).

**§3–4 superseded by [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) phase 1 (2026-10-09).** Fork-on-edit (§3), revert as discarding the fork (§4), and the User composition as a standalone Preset are gone. A User composition is now a Film stored under its own slug, made on purpose with **New Film** or **Add to Film**; a corpus Preset's page never saves; and nothing is stored under a Starter's slug. The stores began writing Films on 2026-10-08, and the supersession was complete when phase 1 closed. The rest of this record stands; where §2, §5, or §6 says "fork", read "a Scene of a Film seeded from a Starter template".

Date: 2026-06-26
Relates to: [ADR-0002](0002-per-tool-routes-to-preset-engine.md) (one preset engine), [ADR-0014](0014-pack-preset-split.md) / [ADR-0023](0023-pack-is-appearance-only.md) (Pack/Preset split, appearance-only), [ADR-0004](0004-recipe-cookbook-over-schema-chrome.md) (Starter templates), [ADR-0025](0025-static-linter-checks-safety-and-readability-only.md) (linter scope)

## Context

The north star is **GUI ↔ agent parity**: a human in the GUI and an agent are co-equal authors over one composition model — either creates a piece end-to-end, or they collaborate. Today the GUI is preview/tune only; this is the remaining critical path (engine arc done, corpus delivered).

The grill that produced this ADR reframed the work. The GUI is **not net-new**: it already two-way-binds a single reactive `engineState` (`engine-state.svelte.ts`) that holds a _fully editable_ composition tree — surface type, all content text, typography, background fill, add/remove overlays, add/remove text-animations, the effects chain, every mark through the editor, timeline scrub. The expensive 80% exists. What is missing is:

1. **User composition storage** — there is no `engineState → Preset` serializer, no write path, no `fs.writeFile` anywhere; `src/routes/api/` has only the ProRes export endpoint. Edits vanish on reload.
2. **Coverage** — no UI for `transport`, `state.stage` (depth/camera/focus), the active `pack`, overlay placement, or some text-animation params.

So parity is **a save seam plus incremental coverage**, not a from-scratch app.

One tension forces the design: the presets in `src/lib/presets/` are **build-harness reference artifacts** — Critic-accepted, git-tracked proof the engine hits the bar. GUI editing must never mutate them in place (it would corrupt the corpus and pollute git). So GUI-authored output needs somewhere else to live.

## Decision

### 1. Scope: single-user local authoring tool, architected Electron-ready

Parity targets one local author (you, building your channel), **not** a multi-user product with its own document model (that is a downstream arc, deferred). The save seam is the browser-side **`UserCompositionStore`** (`loadUserComposition(slug) → Preset`, `saveUserComposition(slug, Preset)`, `listUserCompositions()`), backed today by SvelteKit API routes over the local filesystem and swappable later to Electron main-process IPC **with zero GUI changes**. The GUI never calls `fetch` directly — it calls `userCompositionStore`. Electron is not planned, but nothing may foreclose it.

### 2. Two stores; corpus presets are read-only Starter templates

A **Preset** lives in one of two stores (see CONTEXT.md):

- **Corpus** — git-tracked `src/lib/presets/`, Critic-accepted, **read-only from the GUI**. These serve as **Starter templates** (ex-[ADR-0004](0004-recipe-cookbook-over-schema-chrome.md), long "designed, not built" — this ADR gives it its mechanism).
- **User store** — a separate user-writable location holding **User compositions**.

Both hold the identical Preset format; the engine loads either the same way. "One composition model" stays literal — GUI and agent produce/consume the same standalone JSON, differing only by store/provenance.

### 3. Fork-on-first-edit + autosave

Opening a corpus preset is **read-only**. The **first param change forks** a standalone **User composition** (a full, independent Preset — _not_ a patch/override layer bound to the base) into the user store, autosaves it, and the GUI shows a **"forked" state**. Every later edit autosaves to the fork. There are **no save / new / duplicate buttons** (house rule: autosave on change, never a save button).

### 4. Revert = discard the fork

**Revert** throws the fork away — deletes the User composition and returns to the pristine read-only starter template. It does not keep a reset-but-named slot.

### 5. Lossless round-trip is a hard contract

On save the GUI **preserves the originally-loaded Preset** and patches back **only the GUI-owned subtree**; fields the GUI has no control for (`state.stage`, `transport`, exotic params) **pass through untouched**. The gate is a **byte-identical round-trip test**: load → serialize == original, for every unedited corpus preset. This is what makes save safe with _partial_ coverage — opening an agent-authored depth-stage preset and saving can never silently drop the depth stage. Each new control simply **widens the owned subtree** behind the already-proven save path. Parity **accretes**; it never has to land big-bang.

### 6. v1 is fork-from-template only

The whole model is template-centric, so **create-from-blank is a fast-follow** — it is just forking a minimal default Preset — not v1.

## Alternatives rejected

- **Override-layer / patch document bound to the base.** Needs a merge engine at load, couples a User composition to the base's version and shape (base changes → comp breaks), and splits "one composition model" into two artifact types. Cleverness that rots. Rejected for fork-on-save (full standalone copy).
- **Total-state-mirror save gate** (the GUI must model 100% of the schema before save is allowed). Front-loads all coverage, blocks incremental delivery, big-bang. Rejected for preserve-and-patch + the round-trip test.
- **Productized multi-user document model.** Downstream of parity, undesigned; task-ifying it now produces rot. Deferred.

## Non-goals (not addressed here)

- **Verification parity** — whether/how the **Preset linter** or the **Critic** apply to GUI-authored User compositions. The stated direction stays "the human in the GUI is the live critic," but the mechanism (e.g. surfacing the linter live) is **out of scope for this ADR** and specified separately.
- Multi-user, cloud sync, real Electron packaging/distribution.
- Create-from-blank UX (fast-follow, §6).

## Consequences

- The **Starter template** concept finally has a mechanism: a corpus preset opened read-only as a fork-base.
- New surfaces to build: a **user store**, the browser-side **User composition store** + a local-FS write API, and the **`engineState → Preset` serializer** (today's `applyPreset` has no inverse).
- The current coverage gaps (`transport`, `state.stage`, pack picker, overlay placement, structural layer editing) become **incremental tasks behind the proven save path**, not blockers.
- **Electron migration is a port swap**, not a rewrite — the GUI stays unaware of the transport.
- Tracked in dex; see [`roadmap.md`](../roadmap.md) § GUI ↔ agent parity.

**Implementation note (2026-07-13).** The local persistence routes now run the same registry-derived semantic Preset validator as catalog loading and `parsePreset` on list/load/create/update. A schema-valid User composition with an unknown Pack, renderer, variant, Effect params, Stage, substrate, or broken text target is rejected before it is stored or reopened. This is artifact validity, not the deferred GUI linter/Critic surface in § Non-goals.

**Operational parity note (2026-07-23).** Item GET/PUT now share one standalone wire-Preset contract; the GUI imports/exports that artifact and surfaces live schema/semantic/static-linter issues; Verify adds the current rendered visual audit; agents use the same API; and `scripts/supers.ts` drives serial render/batch jobs through the mounted Workspace's existing export controller and frame renderer.
