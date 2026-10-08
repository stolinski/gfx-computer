# ADR-0069 — GFX moves to AGPL-3.0-or-later so the Score can bundle Strudel

## Status

**Canon** (decided and applied 2026-10-08 by Scott; Dex epic `70u0qn13`, task `4vv4mwis`). The licence change in §1–§4 is applied. The Strudel boundary in §6 is a rule the Score tasks of [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) must build to; no Strudel code is in the repository yet.

For about an hour on 2026-10-08 this record said the opposite (keep the FSL, make the repository private, keep Strudel to local builds). Scott reversed that the same day: the repository stays public and GFX takes the AGPL.

Date: 2026-10-08

Builds on: [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) §6 (the Score)

## Context

ADR-0068 gives a Film a Score written in Strudel. Strudel (`@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/webaudio`, `superdough`, and the rest) is licensed AGPL-3.0-or-later. GFX was licensed FSL-1.1-ALv2, the repository is public, and the app is served to visitors at gfx.computer.

The AGPL requires that a work which includes AGPL code is offered, as a whole, under the AGPL to the people who receive it or use it over a network. The FSL forbids competing use for two years. The AGPL does not allow that extra restriction on a combined work. The two licences cannot both cover one shipped app.

This is a reading of the licence texts by an engineer, not legal advice. Scott should have a lawyer confirm §5 and §6 before a build containing Strudel is served to anyone else.

Three ways out were put to Scott on 2026-10-08:

1. Write a GFX-native sequencer and use no Strudel code.
2. Keep Strudel a separate program and import its audio and hits.
3. Bundle Strudel and license GFX under the AGPL.

Scott chose the third: "whatever to get us compliant."

## Decision

1. **GFX is licensed AGPL-3.0-or-later.** `LICENSE.md`, `package.json`'s `license` field, and the README say so.
2. **Earlier versions stay FSL-1.1-ALv2.** A licence already granted is not withdrawn. Git history is not rewritten.
3. **The licence change lands before any Strudel code.** It has.
4. **The app offers its source.** The AGPL's network clause requires that a person using the app over a network can get the source of the running version. The home page links to the public repository at the commit the running build was made from (`gfxSourceUrl`, from the `gfx-release` identity), on every origin.
5. **GSAP gets an additional permission.** GSAP ships under its own no-charge Standard License, which is not an open-source licence and cannot be offered under the AGPL. `LICENSE.md` therefore carries the Free Software Foundation's standard additional permission (AGPL section 7) allowing GFX to be combined with GSAP. Break Code LLC can grant that only for code it owns. It cannot grant it for Strudel.
6. **So Strudel and GSAP never meet in one program.** Strudel lives only in the Score sandbox of ADR-0068 §6: its own bundle, in its own sandboxed frame, exchanging only JSON hits and PCM samples with the app by message. That bundle contains Strudel, GFX glue code, and nothing that is not AGPL-compatible: no GSAP, no code under any licence the AGPL does not accept. The app bundle contains no Strudel module. A build check enforces both directions and fails the build when either is broken.
7. **Third-party notices are kept.** Strudel's copyright and licence notices ship with the sandbox bundle. Sample packs ship only with a verified licence recorded beside their files; packs whose licence cannot be verified (Dirt-Samples and tidal-drum-machines at the time of writing) do not ship.
8. **Copyright holder.** Break Code LLC holds the copyright in GFX and makes this change as licensor. Every commit in the repository on 2026-10-08 was authored by Scott Tolinski or by his own automation (`Supers Factory`, `T3 Code`); there is no outside contribution to clear.

## Dependency audit (2026-10-08, `pnpm licenses list --prod`)

| Licence                                | Packages | Reading                                                                                               |
| -------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| MIT, ISC, BSD-2/3-Clause, Apache-2.0   | 187      | Compatible with AGPL-3.0.                                                                             |
| BlueOak-1.0.0                          | 5        | Permissive; compatible.                                                                               |
| MPL-2.0 (`mediabunny`, `lightningcss`) | 3        | Compatible through MPL 2.0's secondary-licence clause.                                                |
| OFL-1.1 (bundled fonts)                | 16       | Fonts are separate works shipped alongside the program; the OFL allows that.                          |
| CC-BY-4.0 (`caniuse-lite`)             | 1        | Data used at build time; not part of the shipped program.                                             |
| FSL-1.1-MIT (`@sentry/cli`)            | 2        | A build tool that uploads source maps; not part of the shipped program.                               |
| GSAP Standard License (`gsap`)         | 1        | **Not AGPL-compatible.** Covered by the additional permission in §5 and kept away from Strudel by §6. |

## Consequences

- The FSL's two-year protection against competing use ends for new versions. Anyone may run and modify GFX, including commercially, provided they offer their changes under the AGPL to their own users.
- Any new runtime dependency must be AGPL-compatible or get its own additional permission, and must never enter the Score sandbox unless it is AGPL-compatible.
- Whether the sandbox and the app are separate programs in the AGPL's sense rests on how they talk: plain data over messages, no shared code. Keeping that exchange small and plain is a licence requirement, not only a security one.
- Customer Pack work and anything else built into the app ships under the same terms. A Pack that must stay private has to stay out of a distributed build.

## Rejected

- **A GFX-native sequencer.** No licence change, but no Strudel patterns, and a music engine to write and maintain.
- **Strudel as a separate product outside the app.** No in-app pattern editing or live playback.
- **Keeping the FSL, taking the repository private, and keeping Strudel to local builds.** Compliant, and briefly the decision; it rules out writing music on gfx.computer and reopens every time a build or the repository is shared. Scott chose to stay public.
- **Dual-licensing GFX.** The shipped app that talks to Strudel would still have to be offered under the AGPL.
- **Replacing GSAP.** It would remove the need for §5 and §6, and it means rewriting the engine's animation layer. Not for this.
