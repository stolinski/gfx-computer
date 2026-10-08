# ADR-0069 — GFX moves to AGPL-3.0-or-later so the Score can bundle Strudel

## Status

**Designed, not built** (decided 2026-10-08 by Scott; Dex epic `70u0qn13`). The repository is still licensed FSL-1.1-ALv2 until the licence task in that epic lands. No Strudel code may enter the repository before it does.

Date: 2026-10-08

Builds on: [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) §6 (the Score)

## Context

ADR-0068 gives a Film a Score written in Strudel. Strudel (`@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/webaudio`, `superdough`, and the rest) is licensed AGPL-3.0-or-later. GFX is licensed FSL-1.1-ALv2 (`LICENSE.md`, `package.json`), the repository is public, and the app is served to visitors at gfx.computer.

The AGPL requires that a work which includes AGPL code is offered, as a whole, under the AGPL to the people who receive it or use it over a network. The FSL forbids competing use for two years. The AGPL does not allow that extra restriction on a combined work. The two licences cannot both cover one shipped app.

This is a reading of the two licence texts by an engineer, not legal advice.

Three ways out were put to Scott on 2026-10-08:

1. Write a GFX-native sequencer and use no Strudel code.
2. Keep Strudel a separate program and import its audio and hits.
3. Bundle Strudel and license GFX under the AGPL.

Scott chose the third.

## Decision

1. **GFX is licensed AGPL-3.0-or-later** from the change that lands this decision. `LICENSE.md`, `package.json`'s `license` field, the docs site, and any licence text the app shows all change in that one change.
2. **Earlier versions stay FSL-1.1-ALv2.** A licence already granted is not withdrawn. Git history is not rewritten.
3. **The licence change lands before any Strudel code.** No Strudel package is added to `package.json`, vendored, or copied into the tree while the repository is FSL.
4. **The app offers its source.** The AGPL's network clause requires that a person using the app over a network can get the source of the running version. The app links to the public repository at the commit it was built from (the `gfx-release` identity `/api/health` already reports), on the local origin and on gfx.computer.
5. **Third-party notices are kept.** Strudel's copyright and licence notices ship with the build. Sample packs ship only with a verified licence, each recorded beside its files; packs whose licence cannot be verified (Dirt-Samples and tidal-drum-machines at the time of writing) do not ship.
6. **Copyright holder.** Break Code LLC holds the copyright in GFX and makes this change as licensor. Before the licence task lands, Scott confirms no outside contribution in the repository was accepted under terms that prevent relicensing.

## Consequences

- The FSL's two-year protection against competing use ends for new versions. Anyone may run and modify GFX, including commercially, provided they offer their changes under the AGPL to their own users.
- Every dependency must be AGPL-compatible. The licence task audits the dependency tree and the bundled fonts and assets once, and records the result.
- Customer Pack work and anything else built into the app ships under the same terms. A Pack that must stay private has to stay out of a distributed build.
- The docs site and the home page state the new licence.

## Rejected

- **A GFX-native sequencer.** No licence change, but no Strudel patterns, and a music engine to write and maintain.
- **Strudel as a separate program.** Keeps the FSL, but there is no in-app pattern editing or live playback, and the legal line between "separate program" and "combined work" is not a bright one.
- **Dual-licensing GFX.** The shipped app that contains Strudel would still have to be offered under the AGPL, so the FSL copy would describe a build that does not exist.
