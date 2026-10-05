# Video mosh

**Kind:** domain
**Slug:** video-mosh
**Pack:** syntax
**Verification preset:** `video-mosh-review` (a review composition assembled at review time in a jailed store from local footage; never committed)

## Pitch

Datamosh the creator's footage, the real way: at a mosh window the footage stops refreshing, the last frame is held, and the incoming shot's own motion drags it, block by block, until the window heals back to clean footage. Over a hard cut it is the classic keyframe-drop transition; inside one shot it is a melt. Graphics stay crisp on top. A window may also run into or out of a transparent gap, so material with alpha moshes in from nothing or out to nothing. Decided in [ADR-0065](../adr/0065-video-track-mosh-windows-and-alpha-footage.md).

## Surface(s) involved

None. A **Mosh window** is Video track state (`state.media.videoTrack.moshes[]`), beneath all five Layers, owned by the `media` operation family. No Surface, Layer, Effect, or Pack Role is added. Footage keeps its ADR-0043 ownership; Effects and Pack chrome still never touch it.

## Content sample

The human review uses Scott's handheld 4K60 portrait clip already in the local asset store (`user-assets/850b5f8bd11c1d3c97e8fef56b1af488cbcfa25b7e80cab722b5e8336b2420ab.mov`), cut against itself: clip A from about 0–5 s of source, clip B from about 10–15 s, with a `follow` mosh window starting on the cut. It is review material only: it stays in the local store and is never committed. A second review case uses a generated transparent clip with a gap after it and a mosh-out to alpha. Probes generate their own synthetic footage (moving gradients, a translating checkerboard, a hard cut) at run time.

## Motion plan

The mosh has no motion of its own; it borrows the footage's.

- **Hold:** the held frame is the footage at `startFrame − 1`.
- **Follow:** each step warps the held frame by the block motion between consecutive live frames — drag.
- **Repeat:** the first step's motion is applied every frame — bloom and melt.
- **Bleed:** each step leaks that share of the live frame's residual into the held frame.
- **Corruption:** a seeded share of blocks lag, jump by a stale vector, or show stale data.
- **Heal:** over the last `healFrames` frames the smear blends back to live footage on the `smooth` ease; the next frame is clean.

Windows last 1 frame to 3 seconds. In the review case the window starts exactly on the cut and runs about 1.5 s with a 0.4 s heal.

## Channel chrome notes

Pack-neutral and Pack-immune: footage is creator material and the mosh adds no colour, texture, or Pack Role. GFX layers over it render exactly as over clean footage. Intentional omissions: no moshing of GFX layers, no RGB split, scanlines, noise, or VHS treatment — those are other tools — and no keyframed mosh params in v1.

## Engine work required

- **Schema and validation.** `moshes[]` with `{ id, startFrame, durationFrames, motion: 'follow' | 'repeat', blockSize: 8 | 16 | 32, bleed, corruption, seed (frozen), healFrames }`; the ADR-0065 §9 rules; the optional `alpha: 'keep'` declaration on Media library entries, checked against the probe; output classification reading it. `preset-format.md` and the generated schema.
- **Mosh processor (GPU).** Target-space resolve of a decoded frame (the final present's cover crop and rotation into a native target texture); quarter-resolution block-matching motion search; the step pass (warp, repeat, corruption hash, bleed, heal) over premultiplied RGBA. A CPU reference of the step for small frames, unit tests, and a GPU parity probe.
- **Runtime.** `VideoUnderlayRuntimeController` steps on playback and export and replays from the held frame on a seek inside a window; the final present samples moshed frames with an identity mapping; footage outside windows is bit-identical to today. Probes: seek equals sequential, preview equals export, outside-window identity, bounded seek replay.
- **Alpha footage.** Decode with alpha kept through Mediabunny for entries that declare it (transparent WebM VP9 and ProRes 4444 first, as a spike), premultiplied upload, premultiplied final composite, gaps as transparent footage inside a mosh. Probes with generated transparent media.
- **Operations.** `media.add-video-mosh`, `media.update-video-mosh`, `media.remove-video-mosh` inventory rows, WebMCP tools derived from the schema, agent selection and safety evals, the parity audit, and clip move/trim refusals that would invalidate a window.
- **GUI.** Mosh windows drawn on the Video track timeline row, drag to place and resize with snapping to cuts, and a small inspector of `EffectParamRow`-style controls when a window is selected. No new panel.
- **Docs.** `engine-architecture.md`, `preset-format.md`, `CONTEXT.md`, and the user composition workflow guide as each piece lands.

## ADR required?

already-filed: [0065-video-track-mosh-windows-and-alpha-footage](../adr/0065-video-track-mosh-windows-and-alpha-footage.md)

## Open questions

## What 'done' looks like

Mosh windows can be added, edited, removed, undone, and redone from the GUI and WebMCP; `follow`, `repeat`, bleed, corruption, and heal behave as specified; alpha footage keeps its alpha and moshes into and out of gaps. Deterministic probes prove seek/sequential equality, preview/export equality, outside-window identity, and GPU/CPU parity at native 3840×2160 and 2160×3840. `pnpm check`, `pnpm test`, `pnpm test:structural`, `pnpm verify-presets`, and `pnpm audit:planning` pass. The review composition exports at native horizontal (3840×2160) and vertical (2160×3840), and the exact evidence — the cut mosh on Scott's clip and the mosh-out to alpha — receives human aesthetic approval. Production is rebuilt and smoke-checked after integration, and this Brief is then retired through Delivery.
