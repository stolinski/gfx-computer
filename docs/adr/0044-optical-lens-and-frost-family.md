# ADR-0044 — Shared optical vocabulary for focal lenses and frame Effects

## Status

**Canon (v1 built).** **Amended 2026-10-01:** the frost's grow and melt ramps are sugar over the `growth` and `melt.progress` keyframe channels ([ADR-0063](0063-keyframed-effect-parameters.md) §8); the shader reads those params instead of composition progress, and the ramp's curve is the `smooth` ease rather than `smoothstep`.

Date: 2026-07-27
Builds on: [ADR-0012](0012-effect-pack-context-progress-timestamp.md) (frame-deterministic Effect context), [ADR-0015](0015-identity-spec-per-pipeline.md) (truthful Pipeline claims), [ADR-0018](0018-collapse-effects-to-frame-only.md) (one frame Effect chain), [ADR-0023](0023-pack-is-appearance-only.md) (motion stays outside Packs)

## Context

`fluted-glass` is architectural ribbed glass. It cannot express a smooth local lens or rough frosted transmission without turning unrelated materials into flute variants. The existing `magnify` focal Annotation also overstated its implementation: it claimed independently re-rasterized glyphs and surrounding dimming while sampling the native DOM texture and returning zero dim. Its fixed UV-space pill stretched differently across orientations and cropped long phrases too aggressively.

Observed optical UI work supplied behavioral reference points: bounded magnification, edge refraction, clear and rough transmission, reticles, and interaction ripples. Supers cannot import an interactive component model or pointer history into deterministic motion output, and no third-party source, shader, defaults, or assets are needed to implement those optical fundamentals.

## Decision

Supers uses one independently authored optical vocabulary across focal and frame-scoped consumers:

- `shape: circle | rounded-rect`
- normalized `region: { x, y, width, height }`
- magnification, thickness, refraction, roughness, dispersion, reflection, rim light, tint, and tint strength

`src/lib/utils/optical-geometry.ts` owns normalized region validation/packing and stable shape codes. Local regions are authored against the canonical 3840x2160 composition, then preserve their physical pixel size, aspect, and normalized center when the target changes; an explicit full-frame region remains target-filling. Optical SDFs are evaluated in native composition pixels, not raw UV distance, so circles and bevel widths remain physical across 3840x2160 and 2160x3840 targets.

Local lens and frost Effects resolve those normalized regions to padded native-pixel execution bounds. The Effect chain clears a scratch target, scissors expensive fragment work to that region, then clear-composites the processed pixels over the untouched native input. Full-frame frost stays on the direct native path; final output resolution and outside-region alpha remain unchanged.

Three consumers remain distinct:

1. **`magnify` stays a focal Annotation.** Mark geometry chooses a circle for a compact single-line mark and a bounded rounded rectangle for a wrapped phrase. `marks.timings[index].intensity` scales constrained optical strength. The paper composition shader applies a nonzero context dim floored by `surface.backgroundVisibility`, sharp cubic native-texture reconstruction, bounded rim distortion/dispersion, a Pack-colored scanner reticle, and one progress-addressed inspection ripple. Its smooth iris envelope derives from the authored Mark's absolute duration so entry and exit stay inside G6 across legal focal windows. It does not claim independent DOM re-rasterization.
2. **`refractive-lens` is an ordinary Effect.** It transforms only an authored normalized circle or rounded rectangle, leaves pixels outside that region unchanged before final quantization, and preserves the input alpha silhouette. It can magnify or stay near 1x while expressing bevel, refraction, dispersion, reflection, and tint.
3. **`frosted-glass` is an ordinary Effect.** It combines deterministic three-scale coverage, derivative relief refraction, a bounded 169-tap isotropic gaussian transmission kernel, tint, and sparse highlights. `growFrom`/`growTo` author the frost front in Timeline progress. Optional melt geometry is a pure function of current progress and therefore reverses/refreezes without cursor history.

Both frame Effects unpremultiply sampled color only for material work, then repremultiply against the original local alpha. They do not create coverage outside the composed silhouette. Their GUI Editors write the same params that Presets and agents author, and Workspace deep-tracks nested region/melt changes while paused.

Frost remains inside the existing single-pass Effect contract in v1. The weighted kernel is bounded, runs only inside the pane after derivative work, and composites at native resolution through the existing `rgba16float` chain. A reusable multi-pass resource contract is deferred until measured quality or performance demonstrates a need; it is not added speculatively.

## Considered options

- **Add clear/frost shapes to `fluted-glass`** — rejected. Flutes are the defining geometry of that Effect, not a generic glass mode selector.
- **Port a third-party component or shader** — rejected. Supers needs deterministic Timeline motion, TypeGPU integration, Pack neutrality, and premultiplied-alpha behavior; the implementation is clean-room optical math.
- **Keep Magnify's UV-space fixed pill** — rejected. It distorts physical shape by orientation and cannot truthfully claim a lens body.
- **Re-rasterize marked DOM at a larger size immediately** — rejected for v1. Native 4K source pixels with restrained 1.12–1.18x sampling stay readable; a separate high-resolution focal capture should only be claimed if it is actually implemented and proven.
- **Add a multi-pass Effect runner for frost now** — rejected. The bounded one-pass kernel meets the current proving renders without introducing intermediate-resource ownership, cache, and disposal semantics.
- **Preserve pointer trails for melt/refreeze** — rejected. Stateful history is not seekable without reset/replay or checkpoints; v1 melt is authored and frame-addressable.

## Consequences

- `fluted-glass`, `refractive-lens`, and `frosted-glass` are three searchable material claims with no mode ambiguity.
- One Preset can use the same aspect-preserving optical regions in both orientations; no orientation-specific Effect geometry exists.
- Magnify's Identity Spec now describes the actual native-texture path and observable dim/reticle/motion behavior.
- Transparent overlays retain their original alpha silhouette through both Effects.
- The Effect registry remains open and schema-validated; no global Effect enum or composition branch is added.
- Future stateful liquid or persistent melt work must first ship deterministic reset/replay or checkpoint semantics.
