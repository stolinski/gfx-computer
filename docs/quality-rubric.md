# GFX Quality Rubric

This rubric supplies deterministic rules and human review criteria. Critic prose is advisory; only closed-code measured failures route automatic rework, and only an exact-evidence-bound human approval supplies subjective acceptance.

The companion to [`docs/animation-rubric.md`](animation-rubric.md). Where the animation rubric governs how a preset *moves*, this rubric governs the *craft* of how it looks at every frame: composition, hierarchy, contrast, light coherence, effect discipline.

**This rubric is aesthetic-neutral.** It is the craft floor every preset clears regardless of which visual style it executes. The channel's specific aesthetic — the collage system, palette, material vocabulary, brand references — lives in the active Pack's aesthetic doc ([`docs/packs/<pack>/aesthetic.md`](packs/syntax/aesthetic.md)). Rules here describe *whether a preset is well-made*; they do not describe *whether it fits a particular look*. If a guideline only makes sense for one aesthetic, it belongs in that aesthetic's doc, not in this rubric.

Both rubrics must pass independently. Each rule below has a **Rule** (the measurable bar), a **Why** (the production reason), and a **How to apply** (the relevant `gfx@1` preset fields from [`docs/preset-format.md`](preset-format.md) or the pipeline behavior to verify).

> **Read this before you start.** The rules below are evaluated in a strict order. **Render Quality (R-rules) comes first and is non-negotiable** — no amount of good composition, hierarchy, or palette discipline saves a render that is blurry, banded, pixelated, or aliased. If any R-rule fails, the preset is **rejected outright** and the root cause is fixed *in the pipeline / shader code*, not by tweaking preset values. Only after R-rules pass do the craft rules (Q-rules) apply.
>
> Agents have repeatedly self-passed broken output by glancing at a screenshot and rubber-stamping the rubric. **The R-rule verification protocol requires named observations at named zoom levels** — not "looks good." A verification report without specific observations is itself a failure.

---

## Render Quality — Non-Negotiable

These rules govern the **technical quality of the rendered pixels**. They sit above every craft rule because a blurry render of a perfectly-composed frame is still trash, and a well-rendered frame of a mediocre composition can at least be fixed.

If a preset fails any R-rule, **do not adjust preset values to hide the defect.** Find the shader, effect, or pipeline pass that produced it and fix the implementation. Preset tweaks that paper over a broken render are explicitly rejected (R8).

**Authored signal-degradation scope.** R1, R4, and Q4 have one narrow alternate bar when the Preset explicitly declares a registered signal-model Effect such as `ntsc-signal` or `crt-tube`. These Effects intentionally model finite signal bandwidth, encode/decode separation, scan raster, and phosphor-mask structure; their predicted blur, chroma fringing, raster steps, and subpixel hues are not defects merely because they differ from a pristine source. This is not a general artistic-intent exemption for blur, chromatic aberration, low-resolution assets, compression, or arbitrary post-processing. The Critic must name the Effect and relevant parameters, then verify that the visible degradation matches that declared model numerically. Artifacts outside the model, outside the Effect's region, or beyond its authored strength still fail the pristine rule.

**Authored pixel-grid scope.** R1, R2, R4, R5, and R7 have a separate narrow alternate bar when the Preset explicitly declares the registered `pixelation` Effect. Its intentional output is a stable square grid at the authored integer `pixelSize`: one exact source texel held across each cell, with hard axis-aligned cell boundaries. The observed cell pitch must match the parameter in native output pixels; cells must stay frame-stable and carry the sampled premultiplied color without blur, palette remapping, luminance quantization, or alpha growth. Unaligned blocks, filtering between cells, color steps within a cell, codec blocks at another period, and artifacts outside this exact model still fail. This is not an exemption for low-resolution assets or arbitrary post-processing.

### R1. Text renders sharp at the export's native resolution

- **Rule** — Every glyph in the output has clean stroke edges with no visible blur, fuzz, double-edging, or chromatic fringing. Verified at **200% zoom** in the rendered screenshot at native target dimensions (3840×2160 horizontal / 2160×3840 vertical).
- **Why** — Soft text is the #1 signal of cheap output. Almost always it comes from sampling a lower-resolution intermediate texture (or a DOM rasterization at the wrong DPR) with bilinear filtering at a different scale than the source. The fix is in the rasterization or sampling, not the preset.
- **How to verify (evidence required)** — Open the rendered frame at 100% (1 screen pixel = 1 export pixel). Zoom the viewer to 200%. Pick the smallest body-text run in the frame. Trace one vertical stroke of one letter (e.g. the stem of an "l" or "k"). Report: *"At 200% zoom on `<smallest text region>`, the stroke edges are [crisp single-pixel transitions / fuzzy multi-pixel gradients / doubled / color-fringed]."* If the answer is anything other than "crisp single-pixel transitions," **FAIL**.
- **Authored signal degradation** — When the Preset declares a signal-model Effect, replace the pristine-edge verdict only inside that Effect's output with: *"At 200% on `<text region>`, `<Effect>` with `<bandwidth / delay / focus / raster parameters>` produces `<measured blur or fringe width>`; the degradation [matches / exceeds / contradicts] the declared signal model."* Matching, bounded degradation passes. Additional scale blur, ringing, doubled edges, or fringing not predicted by those parameters **FAILS**.
- **Authored pixel grid** — For `pixelation`, report the measured square-cell pitch and compare it with `pixelSize`. Block-shaped glyph edges pass only when every transition follows that stable grid and each cell is flat apart from the shared sub-LSB present dither. Soft boundaries, a second block period, or color processing beyond center-texel sampling **FAILS**.

### R2. Resampled or transformed content stays sharp at its final scale

- **Rule** — Any region of the frame produced by sampling, scaling, or transforming a source texture is as sharp at its final on-screen scale as content rendered natively at that scale. If part of the frame looks softer than the rest, that part fails.
- **Why** — The dominant failure mode is sampling a lower-resolution source with bilinear filtering at a larger scale, which produces visible blur. Acceptable fixes (in the pipeline, not the preset) include re-rasterizing the source at a resolution sufficient for the maximum on-screen scale, sampling with at least bicubic, or issuing a fresh DOM paint at the target scale.
- **How to verify (evidence required)** — For any region where on-screen scale differs from source scale, zoom the viewer to 200%. Compare that region against same-screen-size content from elsewhere in the frame. Report: *"At 200% zoom, content in `<region>` is [equally sharp / softer / blocky / pixel-doubled] compared to same-screen-size content outside it."* Any answer other than "equally sharp" **FAILS**, and the failure lives in the shader / sampling code, not the preset. N/A if no part of the frame is resampled.
- **Substrate asset resolution** — a photographic backdrop / image substrate asset (`atmosphere-*`, pullquote-on-photo substrates) must be authored at **≥ the target long-edge (3840 px) at the asset's maximum on-screen magnification**: a 2048×1152 plate pushed past 4K under a camera move is an R2 failure the instant it carries any in-focus detail. The sole exemption is a **permanently-defocused** asset — held out of focus for the entire piece (e.g. atmosphere haze) — where the softness is authored, not a sampling artifact and invisible by construction. When a substrate is ever meant to be read sharp, regenerate it at ≥ 4K.
- **Authored pixel grid** — `pixelation` intentionally replaces local detail with native-pixel cells. It passes this alternate bar only when cell interiors are flat, boundaries are hard rather than bilinear-soft, and the measured cell pitch equals `pixelSize`; the source still must meet the native-resolution rule before the Effect samples it.

### R3. Shadows have gaussian-quality falloff — no banding, no stairstep, no hard rim

- **Rule** — Every shadow in the frame falls off with visually-continuous opacity. **No banding** (visible discrete steps in the alpha gradient), **no stairstep edges** (visible pixel-aligned discontinuities along the shadow boundary), **no hard rim** (alpha discontinuity at the shadow's outer edge). Verified at **400% zoom** on a shadow edge.
- **Why** — Box-blur shadows have visible bands. Single-sample shadows have a "ghost rectangle" feel. Low-bit-depth intermediate buffers introduce posterization. All three signal "cheap" instantly. Real shadows have continuous gaussian (or near-gaussian) falloff because that's how diffuse light wraps an occluder.
- **How to verify (evidence required)** — Pick any shadow in the frame. Zoom to 400% on its outer edge and pan slowly along it. Report: *"At 400% zoom on `<which shadow>`, the falloff is [continuous gaussian / shows N discrete bands / has stairstep edge / cuts off hard at outer radius]."* Anything other than "continuous gaussian" **FAILS**. The fix is in the shadow shader: switch to a multi-sample gaussian or two-zone SDF approach (see Q16), increase sample count, or render shadows to a float buffer.

### R4. No aliasing or pixelation on any non-axis-aligned edge

- **Rule** — Every diagonal, curved, or otherwise non-axis-aligned edge in the frame has anti-aliased coverage. No visible single-pixel stairstep on any oblique line.
- **Why** — Aliased edges are 1990s computer graphics. They appear when geometry is rasterized at output resolution without coverage sampling (or with insufficient MSAA / superresolution / SDF threshold smoothing).
- **How to verify (evidence required)** — Zoom to 400% on the longest diagonal or curved edge in the frame. Report: *"At 400% zoom on `<which edge>`, the edge transition shows [smooth fractional coverage over 1–2px / hard single-pixel stairstep / inconsistent step pattern]."* Anything other than smooth coverage **FAILS**. Fix lives in the geometry shader (MSAA enable, or SDF + smoothstep over a 1–2px band).
- **Authored signal degradation** — A declared scan raster or phosphor mask may quantize an edge according to its authored `lines` or `maskPitchPx`; judge whether the observed step period matches those parameters and stays deterministic across the frame. Geometry coverage before the signal model, bezel/curvature boundaries, and any edge outside the Effect remain subject to the pristine smooth-coverage bar. Irregular steps or pixelation unrelated to the declared raster **FAIL**.
- **Authored pixel grid** — A `pixelation` Effect may staircase oblique edges only on its exact `pixelSize` square lattice. The staircase must be stable, axis-aligned, and free of sub-cell jaggies or filtered halos; any other step period **FAILS**.

### R5. No banding or posterization in tonal regions

- **Rule** — Any flat or smoothly-varying tonal region shows visually-continuous color. No visible discrete steps in tone. Verified at **200% zoom** by panning slowly across a smooth region.
- **Why** — Banding shows up when an effect renders to an 8-bit intermediate, when texture density is too low to dither away quantization steps, or when a blur uses too few samples to produce smooth falloff. It's a hard visual signal that the pipeline is dropping bit depth somewhere.
- **How to verify (evidence required)** — Zoom to 200%. Find the largest visually-uniform tonal region in the frame and pan across it. Report: *"At 200% zoom on `<which region>`, the tonal transition is [continuous / shows N visible bands / is dithered acceptably]."* "Continuous" or "dithered acceptably" passes. "Shows visible bands" **FAILS**. Fix: render to a higher-bit-depth intermediate (rgba16float), or add dither, or increase blur samples.
- **Authored pixel grid** — `pixelation` may turn a smooth gradient into one sampled tone per spatial cell. That passes only when tone changes occur exactly at the authored cell boundaries and the Effect introduces no luminance quantization independent of those cells.

### R6. Output renders at the native target resolution — no upscaling

- **Rule** — Horizontal presets export at 3840×2160. Vertical presets export at 2160×3840. The pipeline must not produce a smaller intermediate (e.g. 1920×1080) and upscale it to the target. A 1080p source upscaled to 4K is not a 4K render — it carries the softness of 1080p plus the artifacts of the upscaler.
- **Why** — Upscaled output is universally soft and is one of the most common silent failure modes. It often comes from a hardcoded canvas backing-store size, a wrong `devicePixelRatio`, or an export pipeline that snapshots the preview canvas (which is sized for the screen) instead of rendering at target dimensions.
- **How to verify (evidence required)** — Check the exported file's pixel dimensions match the target exactly. Then: zoom the exported frame to 200% and compare against text rendered at the same physical size in the browser at 4K viewport. Report: *"Export dimensions: `<WxH>`. Target: `<WxH>`. At 200% zoom, exported text sharpness vs native 4K browser text is [equal / noticeably softer]."* Dimension mismatch or softer-than-native **FAILS**.
- **The backing-store report is authoritative.** Verify dimensions against the capture harness's **backing store**, not the CSS rect: `scripts/cdp-capture.mjs` clips from `canvas.width/height` and its banner prints `backing=<WxH>`. The CSS `getBoundingClientRect()` height × device-scale rounds short (3840×2157 for a true 3840×2160 backing) — a rounding artifact of the capture path, not an upscale. A capture whose backing report reads the target exactly passes; do not fail R6 on the CSS-rect rounding.

### R7. Export has no compression or codec artifacts visible to the eye

- **Rule** — The exported video (or frame) has no visible 8×8 block patterns, no color bleed around high-contrast edges, no smear on motion, no chroma subsampling artifacts on saturated regions. Verified at **400% zoom** near high-contrast edges and saturated regions.
- **Why** — GFX output is composited over other footage in an NLE. Lossy artifacts compound through the editor's render pipeline. A WebM/VP9 export with `alpha: 'keep'` and a high enough bitrate / quality setting is the floor; if the export shows visible compression, the encoder settings or codec choice is wrong.
- **How to verify (evidence required)** — Zoom to 400% near any high-contrast edge in the exported frame. Then zoom to 400% on a saturated-color region. Report: *"At 400% zoom near `<edge>`, the edge shows [clean transition / 8×8 block boundaries / mosquito noise]. At 400% on `<saturated region>`, the color shows [clean fill / chroma bleed beyond the geometry / chroma blocks]."* Any blocking / bleed / mosquito noise **FAILS**. Fix: raise encoder quality, switch codec, or render the test as a sequence of PNG/EXR frames to isolate whether the defect is pre- or post-encode.
- **Authored pixel grid** — For `pixelation`, distinguish the authored `pixelSize` lattice from codec macroblocks by comparing a lossless frame with the encoded frame. New 8×8 or codec-shaped subdivisions, ringing, mosquito noise, or chroma bleed inside or beyond authored cells **FAILS**.

### R8. R-rule failures are pipeline bugs — do not hide them in the preset

- **Rule** — If any of R1–R7 fail, the next action is **identify the responsible shader / effect / pipeline pass** and fix it. Adjusting preset values (turning off the magnify, reducing the shadow opacity, choosing a different font size) to hide a render defect is **rejected**. A preset that "works" only because it avoids the broken code path will fail again the next time content lands on that code path.
- **Why** — The user has repeatedly seen agents ship broken renders because the agent reasoned "the rubric says it must look right; this screenshot looks right enough; mark it passed" or "the rubric says X must be sharp; if I make X smaller it'll look sharp enough; ship it." Both are failures. The defect is real and lives somewhere specific in the code; the rubric exists to surface it for repair, not to be gamed.
- **How to apply** — When R1–R7 produce a FAIL, the agent's next deliverable is **(a) the file and function that produced the defect** (located by grepping for the relevant shader / effect / render pass in the current pipeline layout — paths drift as the platform is restructured, so resolve them at the time of the failure rather than from memory), and **(b) the proposed fix to the implementation**. Only after the implementation is fixed and R-rules pass on the same preset is the preset re-evaluated against the Q-rules.

---

## Verification Protocol

Every preset goes through this protocol **before** the agent claims the preset is done. The protocol exists because casual "evaluate this screenshot against the rubric" passes broken output. This format makes that style of self-passing impossible.

Render the preset at native target resolution and capture the densest-content frame (or, for focal marks, the peak-amplitude frame of each mark). For each R-rule, the agent writes one line in this exact format:

```
R1 (text sharpness):   At 200% on <region>, observed: <description>.   PASS / FAIL
R2 (resampled):        At 200% on <resampled region>, observed: <comparison>.   PASS / FAIL  /  N/A
R3 (shadow quality):   At 400% on <shadow edge>, observed: <falloff>.   PASS / FAIL
R4 (edge AA):          At 400% on <diagonal edge>, observed: <coverage>.   PASS / FAIL
R5 (banding):          At 200% on <tonal region>, observed: <tonal transition>.   PASS / FAIL
R6 (resolution):       Export dimensions: <WxH>. Target: <WxH>. Sharpness vs native: <equal/softer>.   PASS / FAIL
R7 (compression):      At 400% near <high-contrast edge>, observed: <artifacts>. At 400% on <saturated region>, observed: <chroma>.   PASS / FAIL
```

Each line must name the specific region inspected. *"R3 PASS"* on its own is **not a valid report** — without an observation it is indistinguishable from rubber-stamping, which is exactly the failure mode the protocol exists to prevent.

For R1 or R4 under the authored signal-degradation scope, append `PASS (AUTHORED SIGNAL DEGRADATION: <Effect>)` and include the relevant Effect parameters plus the measured blur, fringe, raster, or mask period. For R1, R2, R4, R5, or R7 under the authored pixel-grid scope, append `PASS (AUTHORED PIXEL GRID: pixelation)` and include `pixelSize`, the measured native-pixel cell pitch, grid stability, and the rule-specific observation. A bare claim that the piece is "supposed to look degraded" is invalid and fails the protocol.

If any line is FAIL, the agent stops. Per R8, they identify the responsible code path and propose an implementation fix before continuing. They do **not** edit the preset to make the rendered output appear to pass.

Only after every R-line is PASS does the agent proceed to evaluate Q-rules and per-layer rules.

**Temporal coherence of optical transitions.** The stills protocol above samples frames independently, so it cannot catch a focal feature that **blinks out** at one instant and pops back the next — an authored optical transition (rack focus, a feature resolving into focus, a lift settling) must resolve *continuously*. When a preset authors such a transition, additionally sample the transition window (≥ 3 frames, timeline order) and run `probe-temporal-energy.ts <frames…> --region <x,y,w,h>` over the focal feature. It tracks the region's alpha-weighted luminance and **FAILS a non-monotonic dip deeper than 25% of the settled value**; a smooth resolve in either direction passes. This catches what every still-frame samples as fine — e.g. the type-hero accent-rule that blinked out mid-rack-focus.

---

## Foundations of Craft

### Q1. Every visual element commits to one identity

- **Rule** — Every distinct surface, layer, or element in the composition has one coherent visual identity — its material, style, texture, and edge behavior all describe the same thing. Mixing identities on a single element is rejected; two identities means two elements.
- **Why** — Mixing identities on one element is the fastest way to make an output look generated. Whatever the element is — a printed page, a collage shape, a flat block, a photographic cutout — the viewer's eye reads it as one thing or doesn't read it at all.
- **How to apply** — Each element's effect / treatment stack serves a single identity. When a second identity is needed, it lives on a separate element with its own coherent stack.

### Q2. Texture is intentional, multi-scale, and tuned to viewing distance

- **Rule** — Any texture in the output is multi-scale, deterministic, and tuned so that it reads as supporting material at the intended viewing size. Single-scale noise, periodic patterning, and texture heavy enough to compete with the content are all rejected.
- **Why** — Real-world textures are irregular at multiple scales. Single-scale noise reads as camera noise; high-density texture reads as patterning. The combination that reads as material is *low density + at least two scales*. Texture is a supporting layer; it should never compete with the foreground.
- **How to apply** — Verify the texture at both 100% on a monitor and at small-thumbnail size. If it reads as a pattern at thumbnail size, it is too strong. If it disappears entirely, it is too weak.

### Q3. One light direction across the composition

- **Rule** — Every depth cue in the composition agrees on **one** light source position. All shadows match in direction, softness, and distance scaling.
- **Why** — Multi-directional shadows are the loudest "this was built in PowerPoint" tell. A single light direction is the universal sign of a considered composition, regardless of aesthetic.
- **How to apply** — Shadow parameters across all elements derive from a single shared light configuration. The rule is *consistency*, not a specific direction.

### Q4. Palette restraint — limited and distinct

- **Rule** — Total saturated hues visible at once ≤ 3. Each saturated hue occupies a distinct region of color space (one warm, one cool, one contrast) — never two of the same hue family.
- **Why** — The eye reads >3 saturated colors as noise. Two saturated colors from the same hue family look like one of them was supposed to be the other. Palette discipline is the dominant signal of "this was designed."
- **How to apply** — The composition's saturated-color count is bounded across every visible element at every frame, not just within one layer. Specific palette values come from the channel's aesthetic doc, not this rubric.
- **Authored signal degradation** — Chroma sidebands and phosphor-subpixel colors generated by a declared signal-model Effect do not count as independently authored palette hues. Measure the perceptual palette at viewing distance by downsampling the frame before hue counting (`probe-hue-count.ts --downsample 4` for `ntsc-signal`, `crt-tube`, or `crt-scanline`). The downsampled semantic palette still obeys the ≤ 3 saturated-hue cap; hues that survive downsampling or do not follow the declared subcarrier/mask structure count normally and can **FAIL** Q4.

### Q5. Every element commits to a physical or formal identity and obeys its physics

- **Rule** — Every visual element in the composition reads as *something* — a tool, material, instrument, or formal mode — and its execution matches that claim. A translucent claim is translucent. A pressure-varied stroke is pressure-varied. A geometrically-exact claim is geometrically exact. The execution and the claim agree, always.
- **Why** — The single most common quality failure is an element whose execution contradicts what it appears to be: an "opaque highlight" that occludes its content, a "hand-drawn" circle rendered as a perfect ellipse, a "marker stroke" with no pressure variation, a "lens" that is just a backward-mapped sample with no body. Picking what the element is, then committing to its physics, is the craft baseline.
- **How to apply** — Each rendering pipeline enforces the physics of the identity it claims. When a new element is added to the system, its identity is declared up front and its renderer is judged against that claim.

### Q6. Anything that claims hand-made character carries deterministic imperfection

- **Rule** — Any element that claims a hand-made identity (drawn stroke, torn edge, hand-set type, hand-cut shape) has small intentional irregularity in path, weight, and termination. All variation is **seeded deterministically**, not randomized at render time.
- **Why** — Perfect geometry reads as vector software; small intentional irregularity reads as a person reaching for a tool. The visible craft is the signal that a human was here. Determinism is required so preview matches export (animation rubric G9).
- **How to apply** — Renderers for hand-claiming elements include irregularity parameters with sensible defaults. If an element instead claims a vector / geometric identity, the variation is zero — and Q5 then requires the geometry to be exact.

### Q7. Hierarchy uses weight + color + casing, not size alone

- **Rule** — Hierarchy in a multi-line block (lower-third, title card, kicker/title/subtitle stack) combines at least two of: weight contrast, color contrast (full-strength vs reduced ink), and casing (small caps, all caps, sentence case). Size contrast alone is not enough. **Single-voice exception:** under a Pack whose type law forbids weight contrast (a uniform-weight voice such as a single-weight mono), a **size ratio ≥ 4× cap-height** paired with tracking and/or casing is a valid Q7 pairing — the extreme ratio does the work weight cannot, and the tracked/cased small line still reads as a label, not a shrunken paragraph line. A sub-4× size step remains size-only and still fails.
- **Why** — Three differently-sized lines of the same weight and color read as a paragraph. The trick used in every editorial tradition — print, web, motion — is that the small label gets the tracked-out treatment, the headline gets weight, and the subhead gets a quieter color. Size-only hierarchy reads as templated. The exception exists because a single-voice Pack _cannot_ reach for weight without breaking its own law, and a 4–7× cap-height ratio plus tracking reads unambiguously as hierarchy — failing it on the named channels would force weight contrast into a Pack whose identity is the absence of it.
- **How to apply** — Configure rendered weight/color per slot in the pipeline (e.g. kicker: 600 + reduced ink + uppercase; title: 700–800 + full ink; subtitle: 400 + reduced ink). The engine should not render all three slots in one weight at one color. Under a single-voice Pack, verify the ratio: measure the large slot's cap-height against the small slot's — ≥ 4× with tracking/casing on the small slot passes; anything less needs a second named channel (color contrast still works in a single-voice Pack).

### Q8. Measure and line-height are typographically correct

- **Rule** — Body text line length sits between 45 and 75 characters. Line height is 1.35–1.55 for serif body, 1.45–1.65 for sans body. Outside those bands the paragraph reads as either crowded or dissolved.
- **Why** — These are the Bringhurst measure and the modern web/print standard for line height. They are not aesthetic preferences; they are how the eye saccades and groups lines into paragraphs. Violating them produces text that is harder to read regardless of style.
- **How to apply** — Surface pipelines respect these bounds when wrapping `surface.content.body`. Reject preset content where the chosen type size at the chosen surface width produces a measure outside the band.

### Q9. Negative space is a design element

- **Rule** — ≥ 30% of every frame is visually quiet (paper showing through, transparent area, neutral surface). "Ink coverage" — the sum of body text, marks, overlays, and decorative elements — never exceeds 70%.
- **Why** — Density without breathing room reads as a slide deck. Every design tradition that values quality — editorial, brutalist, collage, minimalist — uses negative space as the loudest element. The 30% floor is the bar across all of them.
- **How to apply** — Review the densest frame of the animation. If less than 30% of the frame is quiet, trim copy, increase margins, or split the preset into two beats.

### Q10. One hero focal point per beat

- **Rule** — At any given timestamp, exactly **one** element is primary. If two marks animate simultaneously, one is primary (larger, more saturated, or motionful) and the other supports.
- **Why** — The viewer's eye lands in one place. Competing emphases force a choice (frustrating) or split attention (dilutes both). This is the still-frame corollary of animation rule A2.
- **How to apply** — Across all currently-visible elements at a given progress, rank them. There must be a clear #1. If two would tie, demote one (smaller, lower opacity, no animation that beat).

### Q11. Edges and corners agree with the material

- **Rule** — Surface edges and corners are executed in a way that matches the chosen identity. A material that implies tool marks (paper, torn page) has irregular edges; a material that implies a manufactured object (index card) has consistent radius and clean corners; a material that implies vector (a flat color shape) has exact geometry. Mixing — a "torn" paper with axis-perfect right angles, or a vector shape with random jitter — is rejected.
- **Why** — The viewer reads the edge before they read the content. Edges that contradict the implied material break the composition's coherence. The specific edge treatment is aesthetic; the rule that *the edge must agree with the material* is craft.
- **How to apply** — Pipeline rendering for each surface variant chooses edge behavior consistent with its identity. Future surface variants must declare their edge behavior as part of the variant definition.

### Q12. Effect stacks have discipline — one hero, ≤ 2 supports

- **Rule** — On any single layer, at most **three** effects stack: one *hero* (the dominant treatment), up to two *supports* (tonal adjustments, grain, subtle modulation). A fourth effect either replaces one of the three or moves to a different layer.
- **Why** — Effect stacking compounds. Five effects on one layer produce muddy output where no single effect reads. The discipline of picking one technique and letting it carry is what separates considered work from "I added another filter."
- **How to apply** — When tempted to add a fourth effect, tune the existing three harder, or move the new effect to a different layer where it can be the hero.

### Q13. Additive elements render below transforming elements

- **Rule** — When elements layer in the composition, those that *add to* the surface (decorate, annotate, sit on top of it) render below those that *transform* the surface (lift it, magnify it, tear it, reorganize it). Reversing the order is rejected.
- **Why** — The visual logic only works one way: an additive mark sits *on* the surface, and a transforming mark lifts the surface *off* its plane. A transform under an additive mark is physically incoherent — the transform would have to magnify or lift the additive mark too, but it doesn't.
- **How to apply** — The composition shader enforces this. Authoring order does not affect render order.

### Q14. The still frame must hold at every progress

- **Rule** — A preset must look intentional and well-composed at **any** paused frame, not only during motion. Verify at progress 0.0, 0.25, 0.5, 0.75, 1.0; each must hold as a still composition under Q1–Q13.
- **Why** — YouTube viewers pause, scrub, and screenshot. A preset that only works in motion fails the use case. The animation rubric governs the choreography; this rule governs what the choreography leaves on screen at every instant.
- **How to apply** — Pause-and-review during preset development. If a mid-animation frame looks unfinished or chaotic, the motion is hiding a composition problem — fix the composition.

### Q15. Effects animate in AND out — never pop

- **Rule** — Every element that appears on the canvas (mark, lens, overlay, decorative chrome, drop shadow) reaches its final state through a continuous fade/scale envelope, and recedes through one too. The visible enter/exit range satisfies the corresponding [G6](animation-rubric.md#g6-animation-duration-baseline) absolute ms band — enters ≥ 250 ms, exits ≥ 180 ms. The 10%-of-element-lifetime rule still applies on presets short enough that 10% lands inside G6's band (sub-2.5 s element lifetime); on longer presets G6's absolute ms floor IS the no-pop guarantee. An element whose enter/exit range falls below G6's floor (~150 ms) is rejected as a pop.
- **Why** — A "pop in" cue is the loudest signal of cheap motion design. Real physical objects accumulate presence (light catches an edge, then a face, then the body); real digital interfaces do the same to imply weight. An element that appears instantly reads as "the developer forgot the easing." This includes secondary elements like shadows, specular highlights, and chrome — those must enter with the parent element, not after a delay or with their own snap. The 10%-of-lifetime rule was originally written assuming short presets where 10% of an element's on-screen time naturally landed inside G6's ms band; tying Q15 to G6 resolves the conflict that surfaced on long-hold elements (a 7 s on-screen surface would need a 700 ms exit by the bare 10% rule but reads as overstayed at that length — G6's 180–280 ms exit is the perceptually correct floor).
- **How to apply** — Mark / focal-slot / overlay renderers compute a `reveal ∈ [0, 1]` envelope from the element's mark / transition `progress`, typically `smoothstep(0, enterFrac, p) * (1 - smoothstep(1 - exitFrac, 1, p))` with the resulting visible-range duration in ms inside G6's bands. All visual contributions for that element — alpha, scale, shadows, specular, every component — multiply by `reveal` (not by a separate gate) so they fade as one body. The shader-side smoothstep that maps amplitude to alpha must have a range wide enough that the first frame above the threshold is invisible to the eye (e.g. `smoothstep(0, 0.4, magnifyAmount)`, not `smoothstep(0, 0.05, …)`).
- **Exemption: speech-welded caption tracks** — cues in `state.captions` enter and exit as hard cuts by identity declaration (broadcast captions cut with the voice; a fade would smear the weld). This is the one sanctioned pop: it applies only to the caption track's cue/word boundaries, never to the band's placement or to any other element. See the speech-welded carve-out under [Captions & Subtitles](animation-rubric.md#captions--subtitles).

### Q16. Shadows are multi-zone with soft falloff

- **Rule** — Any drop shadow / contact shadow uses at least two zones: a tight contact occlusion (small offset, ~30–40% strength, falls off within ~30% of object radius) plus a diffuse far shadow (larger offset, ~15–20% strength, falls off over ~100% of object radius). The combined falloff is smooth — at no pixel does the shadow alpha change by more than ~30% over a 1px distance.
- **Why** — A single-zone shadow with a hard rim reads as either a CSS box-shadow at one blur or an Illustrator drop-shadow effect — both of which signal "generic UI." Physical objects cast layered shadow: ambient occlusion in the contact region, plus a softer hemispheric falloff. The two-zone approximation captures enough of the physics to read as photographic without going full ray-traced.
- **How to apply** — Shadow contribution combines a close zone and a far zone, both offset toward the same direction (Q3 — single light), both riding the same reveal envelope as their parent (Q15).

### Q17. Content sits below full contrast against its surface

- **Rule** — Text and content layered on a surface render at less than full tonal contrast against that surface (typically ~92–96% of full strength on a light surface, ~88–94% on a dark surface). Pure-black-on-pure-white (or its inverse) is rejected.
- **Why** — Maximum-contrast text has an edge harshness that doesn't exist in physical print or in considered display typography. It signals "default web rendering" rather than designed output, and it leaves no headroom for emphasis — anything added on top has nowhere to go because the body is already loudest.
- **How to apply** — Body and supporting content render at sub-maximum contrast against the surface they sit on. Emphasis elements (marks, highlights, focal moments) then have room to push above the body without leaving the achievable contrast range.

### Q18. ≤ 2 typeface families per composition

- **Rule** — A single output uses at most two typeface families — one for body / running content, one for display / labels if needed. Three or more families is rejected.
- **Why** — Three families in one composition reads as a yard sale. The discipline of restraint here is what separates designed typography from templated typography; weight, casing, and color (Q7) carry the variation that a third family would otherwise tempt the eye toward.
- **How to apply** — When a third family is tempting, escalate hierarchy through weight/casing/color on one of the existing two families instead.

---

## Anti-Patterns — Avoid Because

These are general quality failure modes. They are *principles*, not a banned-techniques list ([ADR-0016](adr/0016-anti-patterns-loadbearing-when.md)): a move on this list earns its place when it is **load-bearing for a declared Identity Spec dimension** on the element that carries it — chromatic offset implementing ink-bleed on an aged-newsprint Surface, a multi-zone occlusion shadow implementing a `material` dimension — or when the content otherwise explicitly calls for it; the bar is making the choice work harder than the alternative. The same move as decorative chrome on a non-claiming element still fails.

- **Full-frame gradient washes** — they imply a light source that doesn't match the surface light (Q3) and break the transparent-delivery contract (animation rubric G12). If atmosphere is needed, build it from the surface material, not an overlay gradient.
- **Drop-shadow stacking** — the "soft + medium + tight" technique signals Figma's default elevation system. On video it reads as "app screenshot." One shadow, consistent direction (Q3).
- **Fully-saturated RGB primaries as inks** — `#ff0000`, `#0000ff`, `#ffff00` are display states, not pigments (Q5). Even a saturated mark color should sit in pigment color space.
- **Lens flares, chromatic aberration, bloom, light leaks** — camera artifacts on a non-camera surface (E2).
- **Bevel / emboss / inner-glow on type or marks** — signals Word 97 / early-2000s Photoshop. Hierarchy comes from weight, color, casing (Q7).
- **Perfect bilateral symmetry of the entire composition** — symmetry used as a default reads as a slide template. Asymmetric balance is the editorial convention (Q10 implies a single hero, which symmetry contradicts).
- **Three or more typeface families in one composition** — reads as a yard sale (Q18).
- **Hover/UI affordance cues on overlays** — focus rings, click-me shadows, card-component shadows. The overlay is not interactive.
- **Hand-drawn-claiming marks rendered as vector-perfect geometry** (Q5/Q6) — or its mirror, vector-claiming marks with random jitter applied.
- **Generic stock motion-graphics templates** — kinetic typography on a gradient background, swoosh transitions, animated underscores. Signals "downloaded" and contradicts considered craft.
- **Color grading on the export** (E4).

When in doubt: *would a skilled designer consider this finished work*? If a rule above is invoked without a content-driven reason, the answer is usually no.

---

## Compatibility With the Animation Rubric

A handful of rules are restated from each angle, intentionally:

- **Layer stack order** — Q13 (still-frame logic) and the engine's shader behavior (render order). Same rule.
- **One emphasis per beat** — animation A2 (temporal: one element animating at a time) and Q10 (spatial: one hero per still frame).
- **Transparent output** — animation G12 (no opaque background) plus the anti-pattern against full-frame washes and the anti-pattern against export color grading. Same constraint, multiple angles.
- **Determinism** — animation G9 (deterministic motion) extends to Q6 (deterministic imperfection on hand-claiming elements).
- **Safe zones** — animation G2 / G3 cover placement; this rubric assumes the animation rubric's safe-zone rules are already enforced.

Where the rubrics could appear to conflict: this rubric describes the still composition, the animation rubric describes its change over time. Both must hold.

---

## Authoring Checklist

The pass/fail bar before a preset is considered done. Apply alongside the animation rubric's checklist.

**Render Quality is gating — every R-rule below must pass before any Q-rule is even considered.** Each R-line must include a named observation per the Verification Protocol; a bare "PASS" is not a valid report.

1. **R1** — Glyph edges at 200% zoom are crisp single-pixel transitions on every text run, unless a declared signal-model Effect or `pixelation` produces parameter-matched, measured degradation.
2. **R2** — Any resampled / scaled / transformed region is *equally sharp* at 200% as same-screen-size content rendered natively, except exact cell sampling under the authored `pixelation` alternate bar. N/A if nothing in the frame is resampled.
3. **R3** — Every shadow's falloff at 400% zoom is continuous gaussian — no banding, stairstep, or hard rim.
4. **R4** — Every diagonal/curved edge at 400% zoom shows smooth fractional coverage, except parameter-matched raster/mask quantization from a declared signal-model Effect or the exact authored `pixelation` lattice.
5. **R5** — Every flat / gradient / paper region at 200% zoom transitions continuously — no visible banding beyond exact spatial cells from a declared `pixelation` Effect.
6. **R6** — Export dimensions exactly match the target; exported text is as sharp as native browser text at the same physical size.
7. **R7** — At 400% near high-contrast edges and saturated marks: no codec blocks, chroma bleed, or mosquito noise beyond any exact authored `pixelation` lattice.
8. **R8** — If any R-rule above fails, the failure is fixed *in the pipeline / shader code* (with the file and function named) before continuing. Preset values are not adjusted to hide the defect.

Only after every R-line is PASS:

9. **Q1** — Every element commits to one coherent visual identity.
10. **Q2** — Texture (when used) is multi-scale and tuned to viewing distance.
11. **Q3** — One light direction; all shadows agree.
12. **Q4** — ≤ 3 saturated semantic hues at once after viewing-distance downsampling; declared signal-model subpixel hues do not count independently.
13. **Q5** — Every element commits to an identity and obeys its physics.
14. **Q6** — Hand-claiming elements carry deterministic imperfection; vector-claiming elements are exact.
15. **Q7** — Hierarchy uses weight + color + casing, not size alone.
16. **Q8** — Body measure 45–75 chars; line height in band.
17. **Q9** — ≥ 30% of every frame is quiet.
18. **Q10** — One clear hero focal point per beat.
19. **Q11** — Edges and corners agree with the chosen material.
20. **Q12** — ≤ 3 effects per layer; one hero, ≤ 2 supports.
21. **Q13** — Additive elements layer below transforming elements.
22. **Q14** — Composition holds as a still at progress 0.0 / 0.25 / 0.5 / 0.75 / 1.0.
23. **Q15** — Every element fades / scales in AND out over ≥ 10% of its own duration; nothing pops on or off.
24. **Q16** — Shadows are multi-zone (contact + diffuse), single light direction, both zones ride the parent's reveal envelope.
25. **Q17** — Content sits below full contrast against its surface; emphasis has room to push above body.
26. **Q18** — ≤ 2 typeface families per composition.
27. **Anti-patterns** — no item from "avoid because" is present without an explicit content-driven reason.
28. **Aesthetic compliance** — separate check against the active Pack's aesthetic doc ([`docs/packs/<pack>/aesthetic.md`](packs/syntax/aesthetic.md)); this rubric does not enforce that lane.

If a preset passes both the R-tier and the Q-tier above, plus the animation checklist, it has cleared the craft floor. Whether it fits the channel's aesthetic is a separate, additional check.

### Hard rejection rules

These supersede everything else. Any of these means **STOP and fix the implementation** — no preset edits, no "we'll address it later."

- Any text in the frame is not crisp at 200% zoom without parameter-matched evidence from a declared signal-model Effect or the exact authored `pixelation` lattice (R1) → magnify/lift-out or the underlying rasterization is broken.
- A resampled / scaled / transformed region is softer than equivalent natively-rendered content without the exact authored `pixelation` cell-sampling evidence (R2) → the responsible shader is bilinear-sampling a too-small source.
- Any shadow shows banding, stairstep, or a hard outer rim (R3) → the shadow blur is box-blur, low-sample, or rendered at the wrong bit depth.
- Visible jaggies / stairstep on any diagonal edge that do not match a declared signal raster/mask period or the exact authored `pixelation` lattice (R4) → MSAA off or SDF threshold not smoothstepped.
- Export dimensions don't match target (R6) → the export pipeline is snapshotting the preview canvas instead of rendering at target res.
- Verification report uses bare "PASS" without a named observation → the verification was not actually performed; redo it.
