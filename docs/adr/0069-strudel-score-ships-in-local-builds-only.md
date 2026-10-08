# ADR-0069 — The Strudel Score is an internal tool; GFX stays FSL

## Status

**Designed, not built** (decided 2026-10-08 by Scott; Dex epic `70u0qn13`). Final after two reversals the same day (an AGPL relicence was written, applied locally, and undone before it was ever pushed). GFX is FSL-1.1-ALv2 and was never published under any other licence.

Date: 2026-10-08

Builds on: [ADR-0068](0068-films-scenes-and-live-scene-boundaries.md) §6 (the Score), [ADR-0052](0052-public-runtime-and-retention-architecture.md) (runtime profiles)

## Context

ADR-0068 gives a Film a Score written in Strudel. Strudel is licensed AGPL-3.0-or-later; GFX is FSL-1.1-ALv2. The AGPL's duties start when a work containing AGPL code is given to, or used over a network by, someone else. Private use carries none. This is an engineer's reading, not legal advice.

Scott's decision: "we make the tool just internal then and keep my fsl."

## Decision

1. **GFX is not relicensed.**
2. **The Score is an internal tool.** Strudel, the sandbox that runs it, the pattern editor, and Score baking exist only under the development runtime profile.
3. **No build served to another person contains Strudel.** The `hosted` and `public` builds carry no Strudel module, through the existing inventories and hosted stand-ins. A build check fails if one appears.
4. **Strudel stays in its own sandbox bundle**, exchanging only JSON hits and PCM with the app by message (ADR-0068 §6). Any code adapted from Strudel lives in that bundle's directory with Strudel's notices and licence.
5. **A Film with a Score plays and exports from its bake where Strudel is absent.** The baked PCM and Hit lanes are stored together; without Strudel a Score cannot be edited or re-baked.
6. **Samples** ship only with a verified licence recorded beside their files.
7. **Reopen this before** a Strudel-containing build is given to or served to anyone else.

## Rejected

- **Relicensing to AGPL.** Written and undone on 2026-10-08; GSAP's licence also made it more than a one-line change.
- **A private repository, a GFX-native sequencer, Strudel as a separate product.** Not wanted.
