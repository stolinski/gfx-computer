# ADR-0065 — Mosh windows and alpha footage on the Video track

## Status

**Designed, not built (decided 2026-10-05 with Scott; Dex epic for the video mosh, Brief [`video-mosh`](../briefs/video-mosh.md)).** Takes the opening [ADR-0043](0043-source-video-underlay.md) left — "a future explicit footage-grade operation may opt into combined processing without changing Source video ownership" — for one operation, the datamosh, and amends ADR-0043 / [ADR-0045](0045-composition-media-library-and-video-track.md) where they say footage always makes the output opaque.

Date: 2026-10-05

Builds on: [ADR-0043](0043-source-video-underlay.md) (deterministic decoder, final-present compositor), [ADR-0045](0045-composition-media-library-and-video-track.md) (Media library, Video track, Video clips), [ADR-0012](0012-effect-pack-context-progress-timestamp.md) (frame determinism), [ADR-0046](0046-seekable-simulation-and-deformation-families.md) (state that replays on seek), [ADR-0054](0054-webmcp-operation-transaction-and-security-contract.md) (operations, families, receipts)

## Context

A datamosh is a decoder that stops refreshing. At a dropped keyframe it keeps the last picture it had and keeps applying the incoming motion to it, so the old picture is dragged, smeared, and bloomed by the new one until a clean frame arrives. The look belongs to footage: a hard cut moshed into the next shot, or a shot melting into its own motion. The idea was captured in `docs/ideas/datamosh-effect.md` on 2026-08-07; Scott's ruling on 2026-10-05 is that the target is creator footage, not the GFX layers.

Three constraints shaped the decision.

1. **Effects never grade footage.** Ordinary Effects run on the premultiplied GFX result before the final present composites it over the Video clip. A datamosh in `effects[]` could not reach footage without changing that ordering for every Effect.
2. **A mosh is path-dependent.** Frame `F` inside a mosh depends on every frame since the mosh began. GFX requires that any frame, reached by playback, seek, or export, is the same pixels. Seekable simulations (ADR-0046) solved the same shape by replaying a fixed-step kernel from a known start.
3. **Clips differ.** Two clips on either side of a cut can have different dimensions, display rotation, and frame rate. A held frame from one must be pushed by the motion of the other.

Separately, the Video track discards alpha today: footage that covers every frame makes the output opaque (`isEngineStateOpaque`). Rendered transparent material — the Preset clips of [ADR-0066](0066-preset-clips-and-render-in-place.md) — needs its alpha to survive, and a mosh into or out of a transparent gap is only possible if a gap is genuinely transparent footage.

## Decision

1. **A mosh window is Video track state, not an Effect.** `state.media.videoTrack.moshes[]` holds ordered, non-overlapping **Mosh windows**: `{ id, startFrame, durationFrames, motion, blockSize, bleed, corruption, seed, healFrames }`. They are owned by the `media` operation family through `/state/media`, edited as ranges on the Video track, and never appear in `effects[]`. Effects and Pack chrome still never touch footage.
2. **Footage only.** A mosh processes the footage beneath the five Layers. GFX output composites over the moshed footage exactly as it composites over clean footage today, so titles and lower thirds stay crisp over the glitch.
3. **The vocabulary is a decoder's, constrained.**
   - At `startFrame` the footage stops refreshing: the **held frame** is the footage at `startFrame − 1`.
   - `motion: 'follow'` warps the held frame, block by block, by the motion between consecutive live footage frames (drag). `motion: 'repeat'` estimates the first step's motion once and applies it every frame (bloom / melt).
   - `blockSize` is the macroblock edge in native target pixels: 8, 16, or 32. Motion is constant within a block, which is the look.
   - `bleed` (0..1) is how much of the live frame's residual leaks into the held frame each step: 0 is pure mosh, higher slowly heals.
   - `corruption` (0..1) with a frozen integer `seed` makes a deterministic share of blocks lag a step, jump by a stale vector, or show stale data. A hash of seed, block, and frame index decides; nothing reads the clock or `Math.random`.
   - Every window heals out: over its last `healFrames` frames (1..duration) the smear blends back into the live footage on the `smooth` ease, and the frame after the window is clean footage.
4. **Motion is estimated from the footage on the GPU.** Each live frame is resolved into native target space, then a block-matching search compares it with the previous live frame at quarter resolution within a bounded radius. This is a codec's motion search, not optical flow: its blockiness is part of the vocabulary. Motion is estimated on live footage only, never on the moshed result.
5. **A mosh runs in native target space.** Inside a window, every live footage frame is first resolved into a target-sized texture with the final present's own cover crop and display rotation. Held frames, motion fields, and the result all live in that space, so clips with different sizes, rotations, or rates mosh into each other. The final present then samples the moshed texture with an identity mapping. Outside windows, footage takes today's path unchanged, bit for bit.
6. **Replay on seek, step on playback.** A window is at most 3 seconds at the transport rate. The runtime keeps the mosh state for the last processed frame. Playback and export ask for the next frame and step once. A seek to frame `F` inside a window replays from the held frame: decode `startFrame − 1 … F` sequentially and step each. Preview and export run the same processor on the same decoded samples, so a frame is the same pixels however it was reached. The cap bounds a worst-case seek to about 90 decoded frames at 30 fps.
7. **Alpha is opt-in per Media library entry.** A Media library entry may declare `alpha: 'keep'`. The decoder then keeps the asset's alpha, the upload stores premultiplied colour, and the final present composites GFX over premultiplied footage. An entry without the declaration discards alpha exactly as today, so existing compositions and their output class do not change. Declaring `alpha: 'keep'` on bytes without alpha is a validation error from the probe, not a silent no-op. The declaration is authored intent, not a volatile probe observation, so output classification stays computable from the Preset: the output is opaque only when the Video track covers every frame with clips whose entries discard alpha (or a `backgroundFill` / stage applies).
8. **Gaps are transparent footage inside a mosh.** A window may touch a gap. Inside a mosh a gap frame is fully transparent footage: a window over a clip's tail into a gap holds the last frame and heals out to nothing (a mosh-out); a window from a gap into a clip's head bleeds the clip in from nothing (a mosh-in). Moshing carries premultiplied alpha with colour, so smears move coverage too. Nothing invents opaque pixels: every non-zero pixel came from footage.
9. **Validation.** Windows lie inside the transport, never overlap, last 1 frame to 3 seconds, have `startFrame ≥ 1`, and need footage or a gap defined at every frame from `startFrame − 1` through the end. `healFrames ≤ durationFrames`. A window over a gap is valid only when the clips it touches keep alpha, so a mosh-out never reveals a gap the output class calls opaque. Moving or trimming clips is refused by the `media` operations when it would leave a window invalid; semantic validation reports the same finding for hand-edited JSON.
10. **Operations.** Three rows in the `media` family: `media.add-video-mosh`, `media.update-video-mosh`, `media.remove-video-mosh`. Each takes the caller's Composition revision, applies atomically, records one undo entry, focuses the window, and returns a bounded receipt. Enums and bounds are derived from the schema. The Library entry's `alpha` declaration rides the existing library-entry operations.

## Consequences

- Footage now has exactly one processing operation, and it is explicit and visible on the Timeline. A general footage-grade family remains unbuilt; this ADR does not open `effects[]` to footage.
- Seeking inside a mosh costs a bounded replay. Scrubbing deep into a 3-second window is visibly slower than scrubbing clean footage; export is unaffected because it steps.
- The final present gains a second input mapping (identity, target space) for moshed frames. Clean footage keeps the cover/rotation mapping and its pixels.
- Output classification gains one input, the per-entry alpha declaration. Every existing composition classifies as before.
- The processor needs a few target-sized GPU textures while a window is active (held frame, live frame, previous live frame, motion field at quarter resolution); they are released outside windows.
- A mosh over transparent footage is the mechanism by which [ADR-0066](0066-preset-clips-and-render-in-place.md)'s Preset clips mosh into each other and into or out of alpha. Nothing in this ADR depends on Preset clips.

## Rejected

- **A datamosh Effect in `effects[]`.** It could only mosh GFX output, which is not the requested target, and its replay would re-render the whole composition per seek frame.
- **Moshing the combined GFX + footage frame.** Graphics would stop being clean, and replay would need full composition renders instead of decodes.
- **Engine-known motion only** (Overlay transforms, Stage camera). Most footage has no engine-known motion at all.
- **Checkpoint caches for seek.** About 66 MB of GPU memory per 4K checkpoint, for a scrub that the 3-second cap already bounds.
- **Byte-level codec corruption** (removing keyframes from the encoded file, as Supermosh does). It ties the look to each asset's codec and GOP structure, cannot cross clips with different codecs, and is not reproducible across decoders.
- **Inferring alpha from the probe.** The probe is a volatile observation (ADR-0045); output classification must not change when a decoder upgrade reports differently.
