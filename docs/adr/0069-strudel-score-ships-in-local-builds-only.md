# ADR-0069 — The Strudel Score ships in local builds only; GFX is not relicensed

## Status

**Designed, not built** (decided 2026-10-08 by Scott; Dex epic `70u0qn13`). This record was first written the same day as a move to AGPL-3.0-or-later. Scott reversed that within the hour: the repository is going private, so the licence that works is the one GFX already has, with one boundary. The AGPL plan was never applied.

Date: 2026-10-08

Builds on: [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) §6 (the Score), [ADR-0052](0052-public-runtime-and-retention-architecture.md) (runtime profiles), [ADR-0053](0053-gfx-namespace-and-legacy-supers-compatibility.md) (development-only surfaces)

## Context

ADR-0068 gives a Film a Score written in Strudel. Strudel (`@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/webaudio`, `superdough`) is licensed AGPL-3.0-or-later. GFX is licensed FSL-1.1-ALv2.

The AGPL's duties start when a work that contains AGPL code is given to someone else, or when other people use it over a network. Then the whole work must be offered to them under the AGPL, with source. Using AGPL code privately, in software you do not give to anyone, carries no such duty and needs no licence change.

Two facts decide this:

- Scott is making the repository private (2026-10-08).
- gfx.computer serves the app to visitors. A build served there is given to other people. If it contained Strudel, its source would have to be offered to them, which a private repository cannot do.

This is a reading of the licence text by an engineer, not legal advice.

## Decision

1. **GFX is not relicensed.** `LICENSE.md` and `package.json` stay FSL-1.1-ALv2.
2. **The Score is a development-only surface.** Strudel, the sandbox that runs it, the pattern editor, and Score baking exist only under the development runtime profile, beside the disk-backed composition store that Films already need (ADR-0053).
3. **No build served to another person contains Strudel.** The `hosted` build (gfx.computer) and the `public` production artifact carry no Strudel module and no code adapted from Strudel. They get stand-ins through the existing inventories (`public-surface-inventory.ts`, `IS_HOSTED_ORIGIN`, the hosted stand-ins in `vite.config.ts`), never scattered conditionals. A build check fails if a Strudel module appears in either bundle.
4. **A Film with a Score still plays and exports where Strudel is absent, from its bake.** The baked PCM and the derived Hit lanes are data GFX's own code reads. Where Strudel is absent, a Score cannot be edited or re-baked, and the GUI does not offer it.
5. **No Strudel code enters the repository while it is public.** The Strudel tasks in the epic wait until the repository is private. Adding the npm dependency and the adapted offline render both count.
6. **Notices and samples.** Strudel's notices stay with any code adapted from it. Sample packs ship only with a verified licence recorded beside their files; Dirt-Samples and tidal-drum-machines do not ship until theirs is verified.
7. **This decision is reopened before any of these happen:** a Strudel-containing build is served to anyone but Scott; the repository or a build containing Strudel is given to a customer, contractor, or collaborator; the Score is wanted on gfx.computer. Each one is distribution, and each needs either the AGPL with source offered or a different music engine.

## Consequences

- No licence change, no dependency audit, and no source link in the app.
- gfx.computer cannot write or change music. It can play and export a Film whose Score was baked locally, within its 15-second limit.
- The bake and the Hit lanes must be complete enough to stand alone, because they are the only form of the Score that leaves the development profile. The baked Hit lanes are therefore stored with the bake, keyed by the same hash, not re-derived where Strudel is absent.
- Anyone given access to the private repository receives Strudel-derived code. Decision 7 covers that.

## Rejected

- **Relicensing GFX to AGPL-3.0-or-later.** The first decision of the day. It needs the source offered to every visitor of gfx.computer, which a private repository rules out.
- **Putting Strudel in the hosted build anyway.** A private repository cannot meet the AGPL's source offer.
- **A GFX-native sequencer, or Strudel as a separate program.** Both avoid the question; Scott wants Strudel patterns edited and heard inside GFX.
