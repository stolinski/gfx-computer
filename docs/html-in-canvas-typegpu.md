# HTML-In-Canvas + TypeGPU: Hard-Won Lessons And Concrete Patterns

Read this before designing any tool that mixes html-in-canvas with shaders or programmatic pixel access. The 2D-context path of the proposal has implementation quirks that make it the wrong default for shader work. The canonical pattern is the WebGPU variant.

**Canonical model:** [WICG webgpu-jelly-slider example](https://github.com/WICG/html-in-canvas/tree/main/Examples/webgpu-jelly-slider). This is the reference implementation maintained by WICG. Match its shape before improvising. The patterns below are distilled from it and from this project's research-paper pipeline.

## The working pipeline shape

- Single `<canvas layoutsubtree>` element with DOM children inside.
- `canvas.getContext('webgpu')` — the canvas's context is WebGPU from the start.
- `device.queue.copyElementImageToTexture(domChild, width, height, { texture })` writes the DOM child's rasterization directly into a GPU texture.
- Texture usage: `TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT` (`0x14`).
- Shader passes (WGSL) sample the texture, compose, output to the canvas's swap chain.
- `canvas.onpaint` is the right place to re-upload the DOM texture (fires when the layoutsubtree children need repainting). `canvas.requestPaint()` triggers it manually after state edits.
- GFX records `PaintEvent.changedElements` by direct layoutsubtree child. A paint with no changed elements settles the browser snapshot without invalidating the resident 4K DOM texture; export still forces one upload after each post-scrub paint acknowledgment.

## Concrete code patterns (TypeGPU 0.11.x)

### 1. Host setup

Live shape from `src/lib/platform/gpu-host.ts`:

```ts
import tgpu, { type TgpuRoot } from 'typegpu';

const root = await tgpu.init();
const context = canvas.getContext('webgpu') as GPUCanvasContext;
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device: root.device, format, alphaMode: 'premultiplied' });
```

### 2. DOM texture for `copyElementImageToTexture`

Use raw `device.createTexture` (TypeGPU's `createTexture` doesn't expose `COPY_DST + RENDER_ATTACHMENT` cleanly for this use case). Define numeric flags locally to dodge the missing `GPUTextureUsage` global type:

```ts
const DOM_TEXTURE_USAGE =
	0x04 /* TEXTURE_BINDING */ | 0x02 /* COPY_DST */ | 0x10; /* RENDER_ATTACHMENT */

const domTexture = device.createTexture({
	size: [domWidth, domHeight, 1],
	format: 'rgba8unorm',
	usage: DOM_TEXTURE_USAGE
});
```

Size the DOM texture to the source element's natural rendered dimensions (`element.getBoundingClientRect()` scaled by `devicePixelRatio`). Don't force it to canvas size — the browser rasterizes the element AT the texture's `(w, h)` and you lose detail if those don't match the element's natural size.

### 3. Bind group layout + structs

TypeGPU's typed layout and uniform schema:

```ts
import tgpu, { d } from 'typegpu';

const PaperUniforms = d.struct({ paperRect: d.vec4f });

const composeLayout = tgpu.bindGroupLayout({
	domTexture: { texture: d.texture2d(d.f32) },
	marksTexture: { texture: d.texture2d(d.f32) },
	samp: { sampler: 'filtering' },
	uniforms: { uniform: PaperUniforms }
});
```

### 4. Shader entry points

Use the template-literal form for vertex and fragment functions. Fullscreen triangle vertex with passed-through UVs:

```ts
const vsTriangle = tgpu['~unstable'].vertexFn({
	in: { vertexIndex: d.builtin.vertexIndex },
	out: { position: d.builtin.position, uv: d.vec2f }
}) /* wgsl */ `{
	var positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
	var uvs = array<vec2f, 3>(vec2f(0, 1), vec2f(2, 1), vec2f(0, -1));
	return Out(vec4f(positions[in.vertexIndex], 0, 1), uvs[in.vertexIndex]);
}`;
```

Fragment with bind-group access. **The whole layout is passed via `.$uses({ layout: composeLayout })`**, then referenced in WGSL as `layout.$.fieldName`. TypeGPU resolves this during codegen.

```ts
const composeFs = tgpu['~unstable'].fragmentFn({
	in: { uv: d.vec2f },
	out: d.vec4f
}) /* wgsl */ `{
	let rect = layout.$.uniforms.paperRect;
	let localUv = (in.uv - rect.xy) / rect.zw;
	let isInside = localUv.x >= 0.0 && localUv.x <= 1.0 && localUv.y >= 0.0 && localUv.y <= 1.0;
	let inside = select(0.0, 1.0, isInside);
	let safeUv = clamp(localUv, vec2f(0.0), vec2f(1.0));
	let domSample = textureSample(layout.$.domTexture, layout.$.samp, safeUv);
	let domColor = domSample * inside;
	let marksColor = textureSample(layout.$.marksTexture, layout.$.samp, in.uv);
	let outAlpha = marksColor.a + domColor.a * (1.0 - marksColor.a);
	let outRgb = marksColor.rgb + domColor.rgb * (1.0 - marksColor.a);
	return vec4f(outRgb, outAlpha);
}`.$uses({ layout: composeLayout });
```

### 5. Bind group + uniform buffer

```ts
const sampler = root['~unstable'].createSampler({
	magFilter: 'linear',
	minFilter: 'linear',
	addressModeU: 'clamp-to-edge',
	addressModeV: 'clamp-to-edge'
});

const uniformBuffer = root
	.createBuffer(PaperUniforms, { paperRect: d.vec4f(0, 0, 0, 0) })
	.$usage('uniform');

const bindGroup = root.createBindGroup(composeLayout, {
	domTexture,
	marksTexture,
	samp: sampler,
	uniforms: uniformBuffer
});
```

### 6. Pipeline + draw

```ts
const pipeline = root['~unstable']
	.withVertex(vsTriangle, {})
	.withFragment(composeFs, { format })
	.createPipeline();

// Per frame:
uniformBuffer.write({ paperRect: d.vec4f(x, y, w, h) });

pipeline
	.with(bindGroup)
	.withColorAttachment({
		view: context.getCurrentTexture().createView(),
		clearValue: [0, 0, 0, 0],
		loadOp: 'clear',
		storeOp: 'store'
	})
	.draw(3);
```

### 7. DOM upload wiring

Use `canvas.onpaint` so the browser tells you when the DOM changed; trigger it with `canvas.requestPaint()` after Svelte state edits:

```ts
canvas.onpaint = () => {
	device.queue.copyElementImageToTexture(domChild, domWidth, domHeight, { texture: domTexture });
	renderFrame(currentTimestamp);
};
canvas.requestPaint(); // initial

// Svelte $effect that touches state-affecting fields:
$effect(() => {
	state.title;
	state.body;
	state.fontFamily; // touch
	canvas.requestPaint();
});
```

Do not treat Svelte's `tick()` as a browser-paint barrier. Export ordering is DOM mutation → `tick()` → request and await the next `onpaint` → `copyElementImageToTexture`. This prevents the first or previous recorded snapshot from leaking into a deterministic export frame.

### 8. Mixing 2D-drawn overlays (annotations, etc.)

When a tool has CPU-drawn 2D content alongside DOM, render it to an `OffscreenCanvas` and upload as a second GPU texture each frame with `copyExternalImageToTexture`:

```ts
const marksCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
const marksContext = marksCanvas.getContext('2d', { alpha: true })!;

// Each frame:
marksContext.clearRect(0, 0, canvasWidth, canvasHeight);
drawAnnotationMarks({ context: marksContext, ... });
device.queue.copyExternalImageToTexture(
	{ source: marksCanvas },
	{ texture: marksTexture },
	[canvasWidth, canvasHeight]
);
```

This is the cleanest way to keep existing 2D-canvas drawing code working while moving the final composition to WebGPU.

## TypeGPU pitfalls

- **`layout.$.field` is codegen-mode-only.** Reading it at JS level (e.g. `.$uses({ srcTex: layout.$.src })`) throws "Accessed view 'src' outside of codegen mode." Pass the whole layout (`.$uses({ layout: composeLayout })`) and reference `layout.$.field` inside the WGSL template.
- **The `~unstable` API surface is real, not optional.** `tgpu['~unstable'].vertexFn / fragmentFn / createTexture / createSampler` are the entry points for shader work in 0.11.x. `tgpu.bindGroupLayout`, `root.createBuffer`, `root.createBindGroup` are stable.
- **Bind groups attach at draw time** via `pipeline.with(bindGroup)`. Recreate the bind group if any underlying resource (texture, buffer) is recreated (e.g. on resize).
- **TypeGPU's `createTexture` may not expose `COPY_DST + RENDER_ATTACHMENT` together cleanly for the html-in-canvas upload use case.** Drop to raw `device.createTexture` for the DOM-receiving texture. The output remains usable by TypeGPU's bind group system because TypeGPU's texture schemas (`d.texture2d(d.f32)`) accept raw `GPUTexture` resources.
- **WebGPU global types like `GPUTextureUsage` aren't declared in `lib.dom.d.ts` as values.** Define the numeric usage flags locally rather than fighting the type system.

## WGSL pitfalls

- **`textureSample` must be in uniform control flow.** Conditional sampling based on per-pixel UV (`if (uv.x >= 0) { textureSample(...) }`) violates this and the shader fails to compile. Pattern: clamp UV, sample unconditionally, multiply the result by a 0/1 mask computed via `select(0.0, 1.0, condition)`.
- **WGSL has `&&` and `||` for booleans** and accepts `vec2f >= vec2f` returning `vec2<bool>`. `all()` and `any()` reduce a bool vector to a scalar.

## Why NOT the 2D path (`drawElementImage`) for shader work

- A canvas can have only one context type — `2d` or `webgpu` or `webgl`. They are mutually exclusive. A 2D canvas can't host shaders directly; you would need a second canvas with a GPU context plus a bridge between them. The bridge is broken in practice (next bullets).
- `drawElementImage(liveElement, ...)` on a layoutsubtree canvas writes through Chrome's compositor overlay, NOT into the canvas's readable bitmap. The canvas displays correctly to the user, but `copyExternalImageToTexture` (via WebGPU upload), `drawImage(canvas → canvas)`, and similar bitmap-readback paths see nothing — only what was written via standard 2D API calls (`fillRect`, `stroke`, etc.) survives there. `getImageData` reads a different buffer than `drawImage(canvas)` sources from.
- `canvas.captureElementImage(element)` returns an `ElementImage` object (sync, not a Promise, not an `ImageBitmap`). It has `width`, `height`, `close`, and is designed as a source argument to `drawElementImage`. It is not directly accepted by `drawImage` or `copyExternalImageToTexture`.
- `drawElementImage(snapshot)` (snapshot source on a regular canvas) writes pixels to the bitmap **only when the destination canvas is at or near the snapshot's natural dimensions**. On a much-larger destination (e.g. 4K) it silently no-ops. This makes the snapshot → bridge → 4K-canvas approach unworkable.

## Capturing a sub-element: only direct layoutsubtree children rasterize

- `copyElementImageToTexture(el, w, h, { texture })` only produces pixels when `el` is a **direct child of the `<canvas layoutsubtree>`**. Passing a *nested* descendant (a wrapper `div` inside the captured root, even one that is frame-sized, `position: absolute; inset: 0`, fully visible, `opacity: 1`) writes an **all-transparent texture** — no error, just blank. Verified for ADR-0027 (DOF plane capture): wrapping `SurfaceMount` / `OverlayMount` in nested layers and capturing each → blank; the same content captured via the root `.composition` → full pixels.
- `contain: paint` on the nested wrapper does **not** make it capturable — paint containment is not what the API keys on.
- Consequence: to capture two layers separately (e.g. depth planes), each must be its **own direct child** of the canvas, not siblings nested under a shared parent. ADR-0027's split hoists the Overlay layer into a sibling `.overlay-root` (a second direct child) only while DOF is active; the non-DOF path keeps the single merged `.composition` child untouched. [ADR-0057](adr/0057-filmed-canvas-camera-pose-and-posed-planes.md) extends the same rule to posed Overlays on the depth stage: each Overlay with a `pose` or an explicit `z` gets its own frame-sized direct child (`data-posed-overlay-root`, at most four) so it can be captured into its own plane texture, and its rendered centre is measured against that root.
- This pairs with the layer-promotion drop ([ADR-0017](adr/0017-paper-surface-paint-bug-fix.md)): capturing the root **drops** descendants promoted to their own compositing layer (`will-change`, animated `top`, `transform: translate3d`, **and `opacity < 1`**). So a descendant is either captured-with-the-root (normal flow) or not captured at all (promoted) — and capturing the descendant *directly* doesn't work either. Plan the DOM so each independently-captured unit is a direct, non-promoted layoutsubtree child.
- **`opacity < 1` is a promoter → it drops, so it's BINARY, not a fade.** An element with `style:opacity={v}` for `0 < v < 1` is promoted to a compositing layer and captures as **fully transparent** (not at `v`); at `v == 1` it captures normally. So a surface content fade via `style:opacity` snaps full→gone the instant it leaves 1.0 — it does *not* fade. Verified 2026-06 (`docs/critic-captures/text-fade-bug-investigation.md`): captured surface alpha was `1` at opacity 1.0 and `0` at 0.996. **Fix:** keep the DOM element opaque (so it captures), and apply the fade as a **GPU alpha-multiply** on the captured texture (e.g. a `paperVisibility` uniform in a shaderPass/composite). Per-unit text-anim opacities are **NOT fine either** (measured 2026-07, chapter-card-descent Critic run): on the transformed unit spans (`display:inline-block` + `translate3d`) a partial `style.opacity` captures quantized — near-full above ~0.5 and the span **drops entirely below ~0.5** — so an opacity tween pops mid-window instead of fading. `filter: opacity()` is no better (inert on those spans; on unpromoted elements it promotes-and-drops). The channel that rasterizes an honest partial fade is **paint-level text colour alpha** — text-animation strategies write unit fades via `applyTextAnimationUnitFade` (`src/lib/text-animations/unit-style.ts`), which scales the span's colour alpha and touches `style.opacity` only at the true-zero cutoff.

## Hiding the layoutsubtree canvas

- `display: none` — children don't lay out; `drawElementImage` fails.
- `visibility: hidden` — removes paint records; `drawElementImage` throws "No cached paint record for element."
- `opacity: 0` — keeps paint records but `drawElementImage` produces zero-alpha pixels.
- The right answer for the canonical WebGPU pattern is **don't hide it** — it IS the visible canvas. If a multi-canvas setup is ever required, use offscreen positioning (`transform: translate(200%)`) — that preserves paint records and the bitmap.

## The app's CSS reset applies inside captured Surfaces

- **Graffiti clamps media to its container.** `@drop-in/graffiti` (imported in `src/routes/+layout.svelte`) ships `img, picture, video, canvas, svg { max-inline-size: 100% }` in its reset. Captured DOM is ordinary DOM, so the reset reaches every Surface. A media element laid wider than its container is clamped to the container's width while it keeps its explicit block size: the picture squashes horizontally, with no error, and the container's background shows past it.
- **Fix:** any Surface that lays media larger than the frame (a crop into a page, an oversized substrate, pan-and-scan) sets `max-inline-size: none` on that element, as the filmed page in `src/lib/pipelines/surfaces/website-screenshot/CanvasSource.svelte` does.
- **Diagnosis:** when a filmed or cropped plane shows unexplained background, render it under the default camera before touching the camera math. Found 2026-09-01: a 5120×4000 capture rendered at 75% width in horizontal and 42% in vertical, which read as a camera fault until a frontal capture showed the plane itself was mostly empty.

## Standard browsers without HTML-in-Canvas: the hard capability gate

Since qju2qity, a browser without CanvasDrawElement renders **nothing approximate**. `selectDomFrameCaptureMode` (`src/lib/platform/standard-browser-dom-capture.ts`) is a hard gate: it resolves `canvas-draw-element` when **both** `GPUQueue.copyElementImageToTexture` and `HTMLCanvasElement.requestPaint` are present, and otherwise throws naming the flag and the launch command — it never falls back. The root layout reads `isCanvasDrawElementCaptureAvailable` before mounting anything and replaces the whole app with a full-screen notice (`.capability-gate`) carrying `CDP_BROWSER_MODE=agent scripts/launch-cdp-chrome.sh`, so `window.__gfxDomFrameCaptureMode` stays truthful: `canvas-draw-element`, or absent because the app is gated. The gate stops rendering, not WebMCP: the layout starts the WebMCP tool controller before it decides whether to mount, so a WebMCP browser without the flag still registers its tools behind the notice and can author a composition through them ([ADR-0054](adr/0054-webmcp-operation-transaction-and-security-contract.md) §5). The default local agent browser is the combined-flag `agent` mode (CanvasDrawElement + WebMCP, CDP 9229), because the operations that render need it.

The `dom-rasterization` lane — native-resolution DOM clone rasterization with `html2canvas` (`rasterizeCompositionDomElement` in `src/lib/platform/composition-dom-rasterizer.ts`), selected for the since-descoped public demo by the live probe in [`standard-browser-rendering-probe.md`](standard-browser-rendering-probe.md) — is **mothballed**: unreachable from app code, kept in-tree (`@deprecated`, Dex qju2qity) for a possible future public demo. Everything below about that lane describes the mothballed implementation as it stands.

What the rasterization lane keeps identical to the WICG lane:

- **Timestamp ownership.** The rasterizer reads whatever the timeline already wrote to the DOM; it never advances animation. Preview and export still seek first, then request a paint.
- **The paint contract.** `StandardBrowserDomCaptureScheduler.requestPaint` rasterizes every direct canvas child at the canvas's native bitmap size, commits those rasters as one atomic set, and then dispatches the same paint event, so `CanvasPaintGenerationTracker` and `settleCompositionPaint` work unchanged. A burst of requests during one raster collapses onto a single follow-up pass; a failed or aborted pass publishes nothing and rejects rather than settling on a stale frame.
- **GPU upload ordering.** The upload still happens inside the frame's own render pass through `getDomFrameCaptureQueue().captureElementToTexture(...)` — `copyExternalImageToTexture` with `premultipliedAlpha: false`, so the straight-alpha rgba8 the premultiply and compose passes expect is unchanged.
- **Transparency.** The raster is taken with `backgroundColor: null`. A declared `backgroundFill` still arrives from the effect chain, so the lane never paints a background the composition did not ask for.
- **Font readiness.** The rasterizer awaits `fontsReady()` before every capture, so a standard-browser frame cannot contain OS-fallback glyphs.

The clone is required, not incidental: the source element inside the canvas has no layout in a standard browser, so the clone is mounted `position: fixed` at native size (fixed positioning keeps a 3840×2160 element out of the document's scrollable overflow) with the source's resolved custom properties copied onto it, then removed. It must stay visible — an opacity or visibility trick rasterizes to an empty frame, the same failure mode as the canonical lane.

Cost and reach measured by the probe: 191–208 ms per native frame, 91–98% pixel agreement with native rendering of the same DOM. That suits correctness-first export and low-rate preview, not 30/60 fps playback.

### How each composition branch reaches the lane

Only two modules may name the flag-only API: `html-in-canvas.ts` (which chooses the lane) and `standard-browser-dom-capture.ts` (which is the standard lane's paint tick). `scripts/test-dom-capture-lane-seam.ts` enforces that in `pnpm test:structural`, so a new branch cannot quietly reintroduce a second capture path that only works in flagged Chrome.

| Branch                                              | How it reaches the standard lane                                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Surface — plain, paper, web-document, iMessage | All twelve registered Surfaces build their runtime from `createPlainPipeline` or `createPaperPipeline`, and both upload through `getDomFrameCaptureQueue`.                                                |
| Blocks, Annotations, diagrams, chart chrome         | DOM inside `.composition`, so the composition-root raster carries them. The analytic chart marks and annotation marks are separate 2D/GPU uploads that never touched the DOM capture in either lane.     |
| Multiple Layers and the plane split                 | The paint tick rasterizes every **direct** canvas child, so the hoisted Overlay root — and each posed Overlay's own root on the depth stage — is captured as its own plane and committed in the same atomic set as the Surface plane. |
| Depth of field, depth stage, Effects                | `CompositionPlanes.captureOverlay` goes through the same queue; premultiply, bokeh composite, depth stage, and the effect chain are pure GPU passes downstream of it.                                    |
| Image substrate and Video underlay                  | Uploaded from an `ImageBitmap` and a decoded `VideoFrame` with `copyExternalImageToTexture`, so they are lane-independent by construction.                                                               |
| Text animations                                     | The rasterizer reads whatever the timeline already wrote — `CompositionDomRasterRequest` carries no timestamp, so the lane can never become a second clock.                                              |
| Transitions                                         | Each endpoint's snapshot waits for an acknowledged composition paint after its state swap. A layout flush is not a paint: without this the from/to snapshots capture the previous endpoint's DOM.        |
| Transparent and opaque output                       | The raster is taken with `backgroundColor: null` and the clone never gets a background, so a declared `backgroundFill` still arrives from the effect chain and nothing else paints one.                  |
| Both orientations                                   | The clone is sized to the canvas's native bitmap — 3840×2160 or 2160×3840 — which is also what makes `.composition`'s `container-type: size` resolve `cq` units at frame scale.                          |
| Every Pack                                          | The clone is reparented to `<body>`, so it carries the source's resolved custom properties **and** its resolved inherited typography; otherwise Pack type would silently fall back to the editor chrome. |
| Audio-relevant timing                               | Export renders audio once before the frame loop and drives frames by index, so the standard lane's slower raster changes export wall-clock but never audio/video alignment.                              |
| Poster capture                                      | Awaits a settled composition paint. Requesting a paint and waiting a frame is a WICG-only equivalence — the rasterization lane takes far longer than a frame.                                            |

Resource cleanup the lane owns: the clone is removed in a `finally`, so a failed or aborted raster leaves nothing mounted; and each commit releases the rasters of children the composition dropped, so toggling the plane split or unmounting the Workspace cannot retain 4K canvases or answer a later capture with a frame that is no longer in the composition. `standardBrowserDomCapture.readRetainedRasterAccounting()` — published as `window.__readGfxRetainedCompositionRasters` — reports what the lane is holding right now, so that release is verified rather than assumed.

### Measuring a composition a standard browser never lays out

Canvas fallback content is not rendered in a browser without HTML-in-Canvas, so **every rect inside the canvas is 0×0 there** — not merely unpainted. Anything that measures the composition through `getBoundingClientRect` therefore reads zeros on the public path and fails rather than returning wrong numbers.

`measureCompositionDomRoot` (`composition-dom-rasterizer.ts`) is the lane-neutral answer: it measures the in-canvas root directly when that root is laid out, and otherwise mounts the same native-size clone the raster is taken from, measures synchronously inside it, and removes it. Geometry then describes exactly the DOM the frame was rasterized from, in either lane. `window.__captureGfxDeterministicFrameGeometry` goes through it.

The wider readable/layout audit surface in `runtime-audit.ts` still measures live document rects and remains a **flagged-lane authority**: `pnpm verify:layout-contract` and the deliverable render matrix run on CDP port 9223. What the combined-flag agent browser renders is verified by the two-browser gate below.

### Verifying the two sanctioned browsers against each other

`pnpm verify:browser-render` (`scripts/verify-browser-render-matrix.mjs`) renders one bounded coordinate per composition branch in **both** sanctioned browsers — the established canvas harness on CDP port 9223 and, since qju2qity, the combined-flag agent Chrome on 9229 (the default local agent mode) — and compares lane identity, native resolution, blankness, output class, font readiness, frame determinism, geometry, alpha coverage, retained rasters, and per-frame cost. The branch list, the coordinates, the tolerances, and the performance budget live in `scripts/browser-render-verification.ts`; the recorded run is [`browser-probes/browser-render-verification.json`](browser-probes/browser-render-verification.json). A branch with no coordinate, or a coordinate whose evidence is missing, fails the gate rather than going unmeasured.

The property it decides is browser parity: WebMCP-driven authoring must render on exactly the pixels the canvas harness verifies. A defect the established lane already has is reported by name and left to `output-class-mismatch` in the deliverable render matrix, so this gate never charges a pre-existing composition or Pack defect to the compared browser.

The retired standard-lane comparison — the mothballed `dom-rasterization` lane on the standard WebMCP Chrome (CDP 9225), read in [`standard-browser-rendering-probe.md`](standard-browser-rendering-probe.md#two-lane-render-verification) — is reachable only behind `GFX_PUBLIC_DEMO_LANE=1` and is **public-demo-only**: the gated app never mounts in that browser, so the opt-in is meaningful solely against a future demo build that re-enables the lane.

### What a settled frame has to mean here

Both lanes share one settle seam, and the rasterization lane made three of its assumptions false. `seekDeterministicTimelineFrame` seeks and flushes the DOM **before** requesting the settling paint, because this lane reads the DOM when the request lands rather than on the browser's paint tick. `settleCompositionPaint` awaits the requested pass and then `videoUnderlayRuntimeController.settleQueuedPreview()`, because the paint handler only *queues* the composite that uploads the raster and submits the frame's GPU work. A reader that needs pixels — `window.__settleGfxDeterministicCompositionFrame` — additionally awaits submitted GPU work and two frame boundaries, since `toBlob` reads the canvas's presented image and the first `requestAnimationFrame` still runs before the paint that presents it.

## Test discipline

- Chrome's html-in-canvas behavior is undocumented in edge cases (size limits, bitmap vs compositor, snapshot semantics). When something behaves unexpectedly, **probe in DevTools console with `getImageData` and prototype enumeration before refactoring code**. One probe answers a question; refactoring on a hunch wastes hours.
- Always test html-in-canvas via browser automation unless the user says not to.
- **Vite HMR holds a detached capture element.** WebGPU pipelines keep their capture-element reference across a hot update — a hot-swapped `CanvasSource` leaves the pipeline pointing at a detached element until full page reload (`copyElementImageToTexture` logs `source undefined`). Harmless; reload clears it. Don't debug it as a capture regression after an HMR cycle.
