# Optical vignette

**Kind:** pipeline
**Slug:** optical-vignette
**Pack:** syntax
**Verification preset:** `optical-vignette-demo`
**Progress:** The Effect, its proving fixture, GPU pixel evidence (`pnpm probe:optical-vignette`), and the documentation boundary were implemented 2026-10-05 under Dex `3ox55rfp`. Human aesthetic approval of the exact render evidence for realism and restraint is still open, so this Brief stays active.

## Pitch

A finishing treatment that makes a frame read as if it came through a lens: the light falls away toward the corners, smoothly and without colour, the way a real lens image does. It is the restrained last touch on a full-frame segment or bumper and a quiet edge on a transparent overlay — never a black radial gradient laid on top. Anything louder than real optics is a different tool.

## Surface(s) involved

None. `optical-vignette` is an ordinary post-process Effect in `effects[]`, so it composes with every Surface and runs in the existing GFX-before-footage chain: it darkens what GFX draws and never grades creator video, which the final present composites underneath afterwards.

## Content sample

The verification fixture `optical-vignette-demo` is a full-frame title card on the `plain` Surface over the Pack field (`backgroundFill: "pack"`), with the composition of the `title-card-chapter-heading` Starter:

- Label: `OPTICAL VIGNETTE`
- Headline: `Through the lens`

A flat field is the hardest case for a vignette — any synthetic ellipse, ring, or band would show — and it carries no baked-in falloff of its own, unlike the bundled coast photograph, which already has a strong lens vignette.

## Motion plan

No motion of its own. The field is a pure function of the params and the native frame size, so every frame of a static vignette is identical and preview equals export. Every numeric param is an ordinary keyframe channel (ADR-0063), so an author who wants the lens to breathe or the optical centre to drift keyframes it like any other Effect param; the Effect itself never reads time.

In the fixture the type fades in over 250–650 ms on `smooth`, holds, and fades out over 3500–3750 ms of the 4-second piece, while the field and its vignette stay constant, so every frame shows the same falloff with and without type over it.

## Channel chrome notes

Pack-neutral. The Effect carries no colour, texture, or Pack Role, so it looks the same under every Pack and darkens whatever field, ink, and accent the Pack supplies by one shared factor per pixel. It is not a Pack chrome recipe.

Intentional omissions — each remains its own composable capability: CRT bezel and tube vignette (`crt-tube`, `crt-screen`), scanlines, grain (`paper-grain`), blur and depth of field, bloom and halation, chromatic aberration (`chromatic-aberration`), colour grading, and the substrate-local legibility darken pools some Surfaces render for their own text.

## Engine work required

- ✅ `src/lib/pipelines/effects/optical-vignette/`: a renderer-free `definition.ts`, the lazy TypeGPU renderer `index.ts`, the exposure model `optical-vignette-falloff.ts`, and `Editor.svelte` built from `EffectParamRow`, so absent params read their defaults and nothing is written on mount.
- ✅ The exposure model is the cos⁴ law of natural illumination falloff, E = cos⁴ θ = 1 / (1 + tan² θ)². Distance is measured in native pixels from the optical centre and normalised so the farthest frame corner sits at 1; `exposureLoss` sets that corner's field angle so it loses exactly that many stops (tan² θ = 2^(stops / 2) − 1), and nothing in the frame loses more. A softplus ramp on the squared radius, set by `onset` and `feather`, shapes how the field angle grows toward the corner: zero slope at the centre, monotonic, and smooth everywhere, so the field has no cusp, ring, or hard edge at any bounded setting. `roundness` 1 is a round lens in both orientations; lower values stretch toward the frame's own ellipse. The optical centre may be placed anew per orientation through `params.orientationOverrides` (ADR-0039 §4).
- ✅ Exposure is light, so the pass applies it in linear light: it loads each texel exactly, un-premultiplies, decodes sRGB, scales by the exposure, encodes, and re-premultiplies, leaving alpha untouched. Scaling the encoded values directly would darken about twice as many stops as authored. A texel at full exposure (everywhere at zero loss, and the optical centre) or with no coverage is returned bit for bit; transparent pixels stay transparent; no background is painted. The default takes one stop of linear light from the farthest corners, about what a lens gives near wide open; the human gate decides whether that is restrained enough.
- ✅ Registered in `definition-registry.ts` and `runtime-loader.ts`. The existing registry-derived `layer.add-effect`, `layer.remove-effect`, `layer.reorder-effect`, `appearance.set-effect-params`, keyframe-channel, and history operations discover it; no new operation was added.
- ✅ Tests: schema defaults and rejected params, packing, WGSL structure, the exposure model's identity, corner loss, monotonic smooth falloff, round lens shape, and an end-to-end add / edit / refuse / undo / redo / remove through the operations.
- ✅ GPU pixel evidence: `pnpm probe:optical-vignette` (`scripts/probe-optical-vignette-gpu.ts`) runs the real pass at 3840×2160 and 2160×3840 and records zero-loss RGBA bit identity, unchanged alpha at nonzero loss, an equal linear-light loss across channels, per-texel CPU-model agreement, exact corner loss, monotonic centre-to-corner falloff, and an unstretched lens in `docs/browser-probes/optical-vignette-gpu.json`.
- ✅ `docs/engine-architecture.md` and `docs/preset-format.md` list the Effect and its params.

## ADR required?

no — the ordinary Effect contract is unchanged; the probe-only export of `compileEffect` exposes the existing pass without changing it.

## Open questions

## What 'done' looks like

`optical-vignette-demo` renders deterministically at native horizontal (3840×2160) and vertical (2160×3840) under every Pack, with no orientation-specific or Pack-specific sibling Preset, and its exact evidence bundle receives human aesthetic approval for realism and restraint. `pnpm check`, `pnpm test`, `pnpm verify-presets`, `pnpm verify:layout-contract`, `pnpm audit:planning`, and `pnpm probe:optical-vignette` pass on the integrated tree, and production is rebuilt and smoke-checked after integration. This Brief is then retired through the Delivery process.
