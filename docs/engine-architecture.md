# GFX Engine Architecture

Delivery routes objective rendered safety from a fresh exhaustive **Layout Contract Matrix**: numeric native geometry, readable identity, safe-area, size, clipping, timing, and deterministic-layout evidence with no screenshots. Missing or incomplete evidence pauses without claiming failure. Pixel diagnostics are explicit release/debug operations; Critic observations have no transition authority; subjective acceptance remains separate.

The data model, rendering layers, pipeline registry, appearance (Pack) system, and render path that drive every GFX **Preset**. Companion to [`preset-format.md`](preset-format.md) (the preset JSON format reference).

**This doc states current truth.** Where it describes a mechanism, the code does that today. Deliberately narrower mechanisms are collected under [§ Known gaps](#known-gaps) and tracked in [`../docs/roadmap.md`](roadmap.md), not described here as if they are absent wholesale. The _why_ behind each decision lives in [`adr/`](adr/); this is the _what_.

Glossary: [`CONTEXT.md`](CONTEXT.md). Why one engine instead of per-tool routes: [ADR-0002](adr/0002-per-tool-routes-to-preset-engine.md).

## The model in one read

A **Preset** is one JSON document (`gfx@1`) that composes five **Layers** (Surface / Block / Annotation / Overlay / Effect) from a **Pipeline registry**, dressed by a swappable **Pack** (appearance only), optionally declares composition-scoped **Media library entries** and one primary **Video track** beneath that complete Layer stack, renders frame-deterministically through a TypeGPU compositor to a 3840×2160 (or 2160×3840) canvas, and exports transparent or opaque through a bounded local PNG-to-ffmpeg session. Two anchors hold everything else up:

1. **The data model is the contract.** Everything renderable is described in `engineState`. Pipelines own no state.
2. **One uniform render path.** Surface, blocks, annotations, overlays, and post-process effects share the same WebGPU/TypeGPU compositor. Preview, transition snapshots, and export target the same request-object `renderCompositionFrameTo(request)` seam — identical dispatch and inputs.

## File layout

```
src/lib/
  platform/                      # the engine shell (state, schema, render host, UI)
    Workspace.svelte             # composition root; builds frame requests + owns live editor dependencies
    composition-authoring-dependencies.ts # synchronous Svelte dependency reads for authoring repaint
    composition-animation-manifest.ts # deterministic authored timing → runtime tween manifest
    surface-render-inputs-builder.ts # live state + Pack + animation → per-frame Surface inputs
    composition-timeline-tracks.ts # ordered timeline rows + authored write-back adapters
    composition-frame-renderer.ts # request-object frame seam; upload ordering + branch dispatch
    composition-render-resources.ts # atomic Surface/effect/stage GPU resource lifecycle
    composition-export-controller.ts # deterministic media plan/stepping/encoding handoff + cleanup
    stage-substrate-controller.ts # identity-guarded depth-stage image readiness
    capture-assets.ts            # bundled website captures (the corpus form of a website-screenshot capture)
    poster-capture-controller.ts # cancellable content-keyed poster capture lifecycle
    export-session.server.ts      # bounded local PNG/WAV -> ffmpeg session + output cleanup
    video-asset-decoder.ts        # Source time -> presentation sample; decoder cache by asset
    video-underlay-frame-texture.ts # resident active Video-clip frame upload
    video-underlay-runtime-controller.ts # preview/export decode queue + texture ownership
    video-asset-audio-decoder.ts  # Video-clip Source ranges -> deterministic PCM
    transition-snapshot-controller.ts # endpoint state-swap bracket + typed transition Effect resources
    seekable-simulation-runtime.ts # fixed-step seeded reset/replay state for authored simulation Effects
    timeline-entity-identity.ts  # typed runtime track/selection/keyframe/sound identities
    user-composition-store.ts    # User composition store contract + the configured backend choice
    browser-user-composition-store.ts # browser-scoped Public demo session store + quota accounting
    origin-composition-routes.server.ts # 404s the disk-backed composition routes off a public host
    user-pack-store.ts           # User Pack store contract + the origin transport over /api/user-packs
    user-pack-runtime.ts / .svelte.ts # loads a store pack into the engine: faces registered, manifest resolvable, live preview
    user-pack-authoring.svelte.ts # the Pack control's drafting state: fork, debounced validated autosave, two-step delete
    user-pack-operations.ts      # the appearance family's User Pack operations (inspect/fork/save/delete/validate)
    user-pack-store-documents.server.ts # pack documents on disk + the fail-closed save pipeline
    user-pack-font-cache.server.ts # materializes Google Fonts claims into the hash-pinned same-origin cache
    google-fonts-catalog.ts      # typed loader over the vendored Google Fonts snapshot (never fetched at runtime)
    Composition.svelte           # canvas root; mounts Surface/Diagram/Chart/Type Field/Overlay/Captions
    SurfaceMount.svelte          # mounts the active SurfaceRenderer's CanvasSource + Pack vars
    OverlayMount.svelte          # iterates engineState.overlays, mounts each + Pack vars
    DiagramMount.svelte          # mounts surface.diagram Block primitives
    ChartMount.svelte            # selects the visible surface.chart Block family
    KineticTypeFieldMount.svelte # mounts surface.typeField Kinetic Word Blocks on the Surface plane
    KineticWordInspector.svelte  # word, phrase, placement, appearance, and scoped channel authoring
    composition-kinetic-type-operations.ts # revisioned Type Field membership/content/placement/appearance operations
    kinetic-type-field-validation.ts # plain-only, shared-id, phrase, and focal-hierarchy semantic boundary
    chart-validation.ts          # cross-field factual and timeline semantic boundary
    chart-authoring.ts           # bounded shared-model mutations used by the GUI and agents
    ChartInspector.svelte        # direct editor for chart data, targets, layout, and motion
    CaptionsMount.svelte         # mounts the topmost caption track
    Inspector.svelte             # active selection-driven inspector
    TimelineOutline.svelte       # active timeline + Layer outline
    CanvasEditingOverlay.svelte  # direct manipulation, multi-selection, and contextual commands
    CanvasAlignmentToolbar.svelte # contextual accessible edge/center/distribution controls
    canvas-interaction-geometry.ts # editor-only bounds, coordinates, hit targets, order, and handles
    canvas-drag-snapping.ts       # pure screen-tolerance snap plans + normalized temporary guides
    canvas-element-selection.ts  # stable spatial selection-key protocol
    canvas-alignment.ts          # pure normalized alignment/distribution plans
    canvas-alignment-authoring.ts # orientation-aware placement writes + history geometry
    composition-edit-history.ts  # bounded in-memory authoring undo/redo transactions
    CanvasControlsBar.svelte     # playback/view/orientation controls
    timeline.svelte.ts           # Timeline (the only clock)
    gpu-host.ts                  # TypeGPU init; INTERMEDIATE_FORMAT = 'rgba16float'
    html-in-canvas.ts            # WICG copyElementImageToTexture wrappers + the lane-neutral capture queue
    standard-browser-dom-capture.ts # the CanvasDrawElement capability gate + the mothballed standard-browser paint tick (qju2qity)
    composition-dom-rasterizer.ts # lane-neutral geometry measuring + the mothballed DOM clone raster
    animation-manager.ts         # GSAP timeline driver (scrubbed by progress)
    engine-schema.ts             # Zod schema, types, defaults
    engine-state.svelte.ts       # runtime state + mutation helpers; boot Pack gate
    preset-catalog.ts            # renderer/state-free built-in lookup + deliverable/fixture lists
    preset-parser.ts             # pure Preset ingress + semantic validation
    preset.ts                    # stateful apply/clone/transition operations
    preset-validation.ts         # registry-derived semantic Preset validation
    preset-rubric.ts             # static linter — video-safety + readability only (ADR-0025)
    export-video.ts              # WebM/ProRes encoding and download primitives
    packs/                       # the appearance system
      registry.ts                # PACK_REGISTRY: every built-in Pack; getPack resolves built-ins, then the runtime User Pack source
      catalog.ts                 # separate draft/ratified public-catalog registry + authoring listing
      calibration-bundle.ts      # source-bound Calibration Trio descriptor + deterministic bundle ID
      catalog-validation.ts      # catalog coverage/shape + ratified-bundle freshness gate
      resolve.ts                 # resolveAppearanceVars — the live Pack→pixel path
      types.ts                   # Pack/Role manifest types
      role-contract-registry.ts  # closed Role kind/value/fallback/pixel-consumer authority
      validation.ts              # manifest metadata/font/chrome/closed-Role contract gate
    pipelines/                   # Registry + runner INFRASTRUCTURE (not the renderers)
      definition-registry.ts     # synchronous renderer-free Pipeline metadata catalog
      runtime-loader.ts          # typed dynamic renderer imports + readiness controller
      runtime-context.svelte.ts  # reactive Workspace descendant access to the active renderer bundle
      preset-renderer-requirements.ts # Preset/Pack/transition graph → required renderer IDs
      identity-registry.ts       # IDENTITY_REGISTRY + assertIdentityRegistryValid (boot gate)
      composition-effect-registry.ts # non-post-process composition Effects
      stage-registry.ts          # registered composition stage types
      types.ts                   # *Renderer interfaces
      effect-chain.ts            # ping-pong post-process executor + dithered present pass
      shader-pass-runner.ts      # ShaderPassDispatcher (per-target shader passes)
  pipelines/<layer>/<variant>/   # definition.ts metadata + lazy runtime renderer index.ts
    surfaces/  blocks/  annotations/  overlays/  effects/  shader-passes/
  annotations/                   # shared 2D annotation-mark geometry + body-text serialization
  text-animations/               # text-animation orchestration (peer to Layers; does not render)
  presets/*.json                 # built-in Presets
  packs/<slug>/                  # machine Pack manifest + bundled fonts/assets
  utils/                         # the only utility folder
```

There is no `src/lib/tools/` — per-tool modules were collapsed into the engine ([ADR-0002](adr/0002-per-tool-routes-to-preset-engine.md)). Note the two `pipelines/` dirs: `platform/pipelines/` is **infrastructure** (registry, runners, interfaces); `src/lib/pipelines/` holds the **renderers**. Pack documentation lives separately at `docs/packs/<slug>/`; machine manifests live at `src/lib/packs/<slug>/`. The active `Workspace` shell owns live Svelte/DOM/GPU dependencies and the editor through `CanvasControlsBar`, `TimelineOutline`, and `Inspector`; concept-named modules own authoring dependency reads, Surface input assembly, GPU resource replacement, stage substrate readiness, Video-underlay decoding, poster capture, frame execution, export, and transition snapshots. While the depth Stage is on, the timeline leads with **stage rows** ([ADR-0060](adr/0060-the-stage-in-the-workspace.md)): a Camera row whose clip is the travel of the camera the frame films through, a Focus row whose clip is the rack focus, and one row per body; selecting one opens `StageCameraInspector`, `StageFocusInspector`, or `StageBodyInspector`, and the root's `DepthStageSection` keeps only the stage switch and the backdrop. Every timeline drag records one undo entry through the gesture recorder beside the edit transaction (`captureCompositionGestureOrigin` / `recordCompositionGestureEdit`). `Composition` mounts Overlays through `OverlayMount`.

`timeline-entity-identity.ts` is the only constructor/parser protocol for runtime timeline tracks, subtracks, selections, keyframes, sound references, and Video-clip selection; authored Preset IDs remain unchanged. `user-composition-store.ts` is the searchable `UserCompositionStore` boundary for list/load/fork/save/delete calls to `/api/user-compositions`; route handlers own filesystem persistence behind that transport. The item GET and PUT bodies are the same standalone wire Preset, which gives agents a lossless GET/edit/PUT loop over the exact store the GUI autosaves, including `state.media`. Media bytes remain globally deduplicated content-addressed local assets under `/api/user-assets`; only composition membership and edit decisions live in the Preset. See [`user-composition-workflows.md`](user-composition-workflows.md).

`user-pack-store.ts` is the sibling boundary for **User Packs** ([ADR-0055](adr/0055-user-defined-packs.md)): list / load / fork / save / delete over `/api/user-packs`, one document per slug beside the composition store in app data (`packs/`, `fonts/`, `trash/packs/`), development-only behind the same origin guard. Every save runs the fail-closed pipeline in `user-pack-store-documents.server.ts` — the built-in structural contract, the Google Fonts catalog check, no shadowing of a `PACK_REGISTRY` slug, then font materialization into the hash-pinned cache (`user-pack-font-cache.server.ts`, served by `/api/user-pack-fonts/[key]`) — and stamps the sha-256 `contentHash` a later save or delete must name. See [`user-pack-workflows.md`](user-pack-workflows.md).

`browser-user-composition-store.ts` is the other backend behind that same contract: the Public demo session, which keeps every record in the visitor's own browser and never sends one to the origin ([ADR-0053](adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)). Every way it can fail names its own corrective code rather than throwing a raw storage error — `storage_unavailable` when the browser exposes no local storage, `limit_exceeded` for one composition past the per-document ceiling, `quota_exceeded` for a session with no room left or a browser refusing the write itself, and `stale_revision` when a second tab of the same browser saved the record after this tab opened it. That last one is the store's whole concurrency model: each write is stamped with a token, a tab remembers the token of every record it opened or wrote, and a save landing on a token it never saw is refused so neither tab's composition is destroyed. `pnpm probe:browser-session` (`scripts/probe-browser-session-integrity.ts`) is the regression gate: it drives a browser-store build in the sanctioned CDP harness through refresh, two tabs, quota, storage denial, unopenable and older-release records, unresolvable Media, and consent, and it inspects every request, console message, and telemetry envelope the page emitted for the composition's own content. The recorded run is [`browser-probes/browser-session-integrity.json`](browser-probes/browser-session-integrity.json).

The homepage's **New composition** action is the shipped create-from-blank entry point: it forks the built-in `blank` Preset into the user store as an untitled User composition, then opens that standalone Preset in the same Workspace used by Starter-template forks.

Media authoring preserves the three-zone Workspace. The existing right rail switches between Inspector and Media modes; Media mode owns composition library membership, upload, volatile probe/readiness display, and drag affordances. The fixed primary Video track is part of the Timeline beneath the five Layer rows and exclusively owns clip creation, move, trim, slip, and snapping. Selected-clip Inspector controls are limited to audio enabled/gain and removal. There is no Project artifact, left Media panel, fourth workspace zone, sixth Layer, or Video entry in Add layer ([ADR-0045](adr/0045-composition-media-library-and-video-track.md)).

### Canvas interaction geometry

`canvas-interaction-geometry.ts` is the searchable, editor-only geometry contract used by `CanvasEditingOverlay.svelte`. It keeps three spaces explicit: normalized and native composition coordinates for authored persistence; client CSS pixels for pointer input; and editing-overlay-local CSS pixels for editor chrome. `CanvasRenderedBounds` records observed composition bounds separately from their optional depth-stage projection and displayed bounds. `CanvasHitRegionGeometry` keeps visible pixel bounds separate from padded pointer bounds. `CanvasSelectionOrder` supplies a stable Layer, paint-order, and identity sort for overlap handling; the `stage-body` layer ranks below the page, so a body's region — its resident mesh's projected silhouette from `projectStageBodyFrameBounds`, through the renderer's own camera — surrounds the picture without taking its press ([ADR-0060](adr/0060-the-stage-in-the-workspace.md)). At fit zoom a drag on that body orbits the stage camera about its aim and the wheel dollies it, through the same clamped writers the Camera inspector uses (`stage-camera-editing.ts`), each gesture one undo entry; grabbing the page reframes the aim. `CanvasHandleGeometry` fixes handle visuals and pointer targets in screen pixels, independent of canvas zoom.

The editing overlay reads current DOM and canvas rectangles, then delegates horizontal, vertical, zoomed, panned, and depth-stage conversion to that contract. It writes only normalized Preset geometry. The contract is not a render input: composition rendering and export must not import it or capture its chrome. Render-side shader bounds remain in `utils/overlay-bounds.ts` because they describe native pixel work, not interaction affordances.

Spatial Overlays, draggable Diagram primitive Blocks, and Kinetic Word Blocks share the `canvas-element-selection.ts` key protocol. Shift-click or Shift+Enter adds and removes compatible Overlay/Diagram peers while `layerSelection` keeps one primary timeline/Inspector entity. Two or more selected Overlay/Diagram elements expose contextual edge/center alignment against either the selection union or normalized canvas; three or more also expose equal-gap horizontal/vertical distribution. Focused spatial elements, including Kinetic Words, nudge by one native composition pixel with Arrow keys or ten with Shift; focused resize/scale/rotation handles expose the same Arrow-key authoring path as pointer gestures where that handle vocabulary exists. `canvas-alignment.ts` resolves stable rounded deltas from unprojected normalized composition bounds, so display zoom and orientation-native pixel dimensions cannot enter the math. The editing overlay runs a fixed bounded set of layout-settle passes so position-dependent text reflow converges without wall-clock-driven results. `canvas-alignment-authoring.ts` writes Overlay/Diagram geometry; Kinetic Word direct manipulation calls its placement-family operation. Every alignment, nudge, resize, scale, rotation, or word-placement command records exact before/after geometry in `composition-edit-history.ts` for Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z.

Each Overlay, draggable Diagram Block, or Kinetic Word drag snapshots its immutable normalized origin and compatible spatial bounds. `canvas-drag-snapping.ts` compares moving edges and centers with canvas edges/center, the active orientation's shared platform safe area, and nearby spatial bounds. Its tolerance is fixed in displayed CSS pixels at the current zoom, while its rounded output remains a normalized composition translation. Cmd/Ctrl held during the drag bypasses snapping. Active snap results mount as restrained achromatic SVG guide lines inside `CanvasEditingOverlay`; pointer release, cancellation, bypass, or loss of a useful target removes them. The guide layer is a Workspace sibling of the `VideoFrame`, never a child of `Composition` or an input to preview/export capture.

Poster lifecycle has three layers ([ADR-0061](adr/0061-committed-composition-posters.md)). Every corpus Preset has a **committed** poster under `src/lib/assets/composition-posters/` — a still the real renderer produced, written by `pnpm capture:posters` (`scripts/cdp-capture-composition-posters.ts`) at the candidate frame that shows the most, or at the authored `transport.posterSeconds` — and a `manifest.json` row recording the content hash it was rendered from; `composition-posters.ts` resolves a card's poster only for that exact hash, and `composition-posters.test.ts` fails while a deliverable's poster is missing or stale, so a changed Preset cannot land without its still. The committed posters ship with the app, so the hosted origin shows them too. User compositions, which live in the development-only store, are captured on view through the Workspace's `PosterCaptureController` into the local `.posters/` cache under the same content key, and a frame that shows nothing is never stored. Every registered Surface has a committed `static/surface-posters/<type>.webp` default, refreshed by the same script from a representative Preset, that a card shows only while it has no poster of its own.

## Verification commands

The shell out of which any engine change is verified.

| Command                                                      | Purpose                                                                                  | Success signal                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `npm run check`                                              | Svelte/TypeScript, ESLint, and deterministic discoverability checks                      | exits 0                            |
| `npm run check:discoverability`                              | Focused source-searchability audit                                                       | exits 0                            |
| `npm run verify-presets`                                     | Schema + semantic + Pack/Identity gates; static safety/readability lint for deliverables | All `✓`, exits 0                   |
| `npm run verify:layout-contract`                             | Full numeric Preset × Pack × orientation × critical-frame safety matrix; no screenshots  | JSON `passed: true`, exits 0       |
| `npm run gen:schema`                                         | Regenerate `docs/preset-format.schema.json` from the Zod schema                          | `Wrote …preset-format.schema.json` |
| `npm run build`                                              | Smoke-test the production build                                                          | `✓ built in <N>s`                  |
| `npm run gfx -- render --preset <slug-or-path> --out <file>` | Deterministic automated render through the Workspace export seam                         | output path, exits 0               |

### Browser checks

The dev server already runs at `http://localhost:7263` — never start a new one. Rendering needs a Chrome launched with `--enable-blink-features=CanvasDrawElement`; an unflagged browser is hard-gated to a full-screen notice instead of a render. Start or confirm that harness with `scripts/launch-cdp-chrome.sh` (canvas 9223, agent 9229, standard-webmcp 9225, standard 9227) and drive it with the scripted runners — `scripts/cdp-*.mjs`, `scripts/run-gfx-render-matrix.mjs`, `scripts/run-gfx-layout-contract-matrix.mjs`, and the `scripts/probe-*` family. A verification or matrix pass never runs through the `chrome-devtools` MCP browser, which is for interactive human inspection only; a sweep that is not reproducible as one script invocation is not verification evidence. For an optional adversarial reading of a finished Preset, see [`critic.md`](critic.md).

## The five Layers

A frame composes bottom-to-top:

```
+----------------------------------------------------------+
| 5. Effects        (`effects[]` routing/post-process + transition lane)
+----------------------------------------------------------+
| 4. Overlays       (lower-thirds, watermark, counters, …)  |
+----------------------------------------------------------+
| 3. Annotations    (per-span / per-block marks on a Block) |
+----------------------------------------------------------+
| 2. Blocks         (typed content units on the Surface)    |
+----------------------------------------------------------+
| 1. Surface        (paper / newspaper / plain / …)         |
+----------------------------------------------------------+
```

**Ordinary and composition-owned Effects are authored in one composition-wide `effects[]` list** — _not_ per-Layer. Ordinary `EffectRenderer`s run as the final post-process chain; composition-owned Effects such as `depth-of-field` alter branch dispatch and are removed before the remaining post-process entries run. Transition Effects are the third execution class: top-level `transition.effect` validates through `transition-definition-registry.ts`, resolves its already-loaded runtime renderer through `runtime-loader.ts`, and composites two cached endpoint snapshots rather than appearing in `effects[]`. [ADR-0018](adr/0018-collapse-effects-to-frame-only.md) records the retired five-key shape and its execution-class refinement; [ADR-0026](adr/0026-transitions-v1-snapshot-and-wipe.md) owns the transition lane. Per-target shader work that _does_ need Layer-local knowledge is a **`shaderPass`** on the Surface/Overlay renderer, run by the dispatcher between DOM upload and the final chain.

| Layer      | Renderer             | Owns                                                  |
| ---------- | -------------------- | ----------------------------------------------------- |
| Surface    | `SurfaceRenderer`    | the material/container + enter/exit                   |
| Block      | `BlockRenderer`      | one content unit inside the Surface                   |
| Annotation | `AnnotationRenderer` | one mark on a Block (decorative or focal)             |
| Overlay    | `OverlayRenderer`    | a positioned element not bound to a Block             |
| Effect     | registry-dependent   | branch routing, transition wipe, or post-process pass |

## Data model

```ts
// PresetSchema (engine-schema.ts) — the on-disk envelope.
interface Preset {
	schema: 'gfx@1';
	name: string;
	description?: string;
	pack: string; // REQUIRED, no default — names the appearance Pack (ADR-0023)
	kind: 'deliverable' | 'fixture'; // default 'deliverable'; fixtures skip only the deliverable static lint
	state: EngineState;
	transition?: {
		from: string;
		to: string;
		effect: string;
		durationMs: number;
		params: unknown;
	};
}

interface EngineState {
	transport: {
		orientation: 'horizontal' | 'vertical';
		durationSeconds: number;
		fps: number;
		format: string;
	};
	typography: Typography;
	marks: MarksState;
	surface: SurfaceState;
	textAnimations: TextAnimation[]; // default []; orchestration, not a Layer (ADR-0011)
	overlays: Overlay[]; // default []
	effects: Effect[]; // default []; ONE flat chain (ADR-0018)
	audioCues: AudioCue[]; // default []; manual cues + optional bed
	media: Media; // default { assets: [], videoTrack: { clips: [] } }
	backgroundFill?: string; // '#rrggbb' or 'pack' (the active Pack's field-treatment); presence classifies a full-frame output
	stage?: Stage; // optional; absent = flat path. Dimensional depth stage (ADR-0028)
	captions?: Captions;
}

interface Media {
	assets: VideoAsset[]; // composition-scoped Media library entries
	videoTrack: { clips: VideoClip[] }; // one ordered primary Video track
}

interface VideoAsset {
	id: string;
	kind: 'video';
	name: string;
	assetUrl: string; // globally deduplicated /api/user-assets/<sha256>.(mp4|mov|webm)
}

interface VideoClip {
	id: string;
	assetId: string;
	timelineStartFrame: number; // nonnegative integer
	durationFrames: number; // positive integer
	sourceStartSeconds: number; // nonnegative media-relative Source time
	audio: { enabled: boolean; gain: number }; // gain 0..4
}

// Surface is a CLOSED enum (1:1 with registered surfaces).
type SurfaceType =
	| 'paper'
	| 'plain'
	| 'newspaper'
	| 'pullquote-on-photo'
	| 'chapter-card'
	| 'brand-mark'
	| 'title-sequence'
	| 'type-hero'
	| 'web-document'
	| 'website-screenshot'
	| 'imessage'
	| 'checklist';

// Overlay.type and Effect.type are OPEN strings, validated against their registries by
// validatePresetSemantics after structural Zod parsing. New variants land additively
// in code; no schema migration.
interface Overlay {
	type: string; // e.g. 'lower-third', 'washi-tape', 'counter'
	id: string; // stable identity for timeline tracks
	content: unknown; // schema declared by the OverlayRenderer
	position: OverlayPosition;
	enter?: Transition;
	exit?: Transition;
}
interface Effect {
	type: string;
	id: string;
	params: unknown;
}

interface SurfaceState {
	type: SurfaceType;
	variant?: string; // validated per-pipeline against that family's VARIANT_IDS
	content: SurfaceContent;
	diagram?: DiagramPrimitive[]; // explicit Block geometry (ADR-0036)
	chart?: ChartGroup; // strict inline factual Chart Blocks (ADR-0048)
	typeField?: KineticTypeField; // bounded Kinetic Word pool + semantic phrases (ADR-0064)
	enter?: Transition;
	exit?: Transition;
	backgroundVisibility?: number; // wired: floors focal-dim aggressiveness in the paper pipeline
}

interface OverlayPlacement {
	anchor:
		| 'top-left'
		| 'top-right'
		| 'top-center'
		| 'bottom-left'
		| 'bottom-right'
		| 'bottom-center'
		| 'center'
		| 'normalized-rect';
	offset?: { x: number; y: number }; // 0..1 fractions of composition dims, anchor-relative
	rect?: { x: number; y: number; width: number; height: number }; // 0..1 when anchor === 'normalized-rect'
	scale?: number;
	rotation?: number;
}

interface OverlayPosition extends OverlayPlacement {
	orientationOverrides?: {
		horizontal?: OverlayPlacement; // complete snapshot, not a partial merge
		vertical?: OverlayPlacement;
	};
}
```

Placement is **relative** (anchor + fractional offset), never absolute pixels. Shared placement is the fallback; optional complete horizontal/vertical snapshots let one Overlay change anchor geometry across targets without creating sibling Presets. `resolveOverlayPlacement` is the common render/lint/authoring seam. Platform safe areas validate the resolved snapshot and never clamp authored values (see [§ Output & orientation](#output--orientation)).

Diagram primitives use the parallel `orientationOverrides` policy with type-specific complete geometry: `{ position, scale }` for nodes/stat-callouts, `{ position, scale, maxWidth }` for labels, `{ from, to, route, control }` for edge-arrows, and `{ from, to }` for timeline-segments. `resolveDiagramPrimitiveGeometry` supplies live authoring references; `resolveDiagramPrimitiveForRender` materializes the active geometry for DOM and stroke rendering. A label's optional `maxWidth` is its final native-composition width fraction, independent of typographic `scale`; the Inspector and fixed-screen-size canvas side handles write that same active-orientation field, reflow text with intrinsic height, and record direct resize gestures in composition edit history. Content, timing, animation, ink, form, direction, labels, and values remain shared.

Chart Blocks use a different, data-derived geometry contract. Only `plain` and `paper` Surfaces may carry `surface.chart`; semantic validation rejects it elsewhere. The group carries one to four `bar-chart`, `column-chart`, `line-chart`, `unit-grid-chart`, or `dot-field-chart` Blocks; sequence visibility selects at most one active item. `chart-validation.ts` is the cross-field factual boundary after structural parsing. Pure helpers in `src/lib/utils/chart-*` own finite-safe scales, native reflow, exact targets and computed labels, largest-remainder normalized allocation, and explicit-progress choreography. `ChartMount.svelte` selects the shared bar/column or normalized DOM source. DOM supplies crisp editorial chrome; `surface-render-inputs-builder.ts` packs the same resolved geometry and motion into neutral instanced analytic marks for `chart-mark-renderer.ts`. Pack `chart.mark-fill` recipes can resolve solid, gradient, or bounded ordered-dither treatment only inside those mark masks. Chrome, transparent pixels, facts, geometry, and motion remain unaffected by Pack choice.

Create-from-blank chart edits do not fork a second data model. `chart-authoring.ts` performs bounded, atomic mutations on `surface.chart.items[]`; `ChartInspector.svelte` and its focused sections call those helpers directly. Runtime resolves intrinsic `ChartMotion` directly from explicit composition progress. The five types share timeline Block identities and expose five editable clips — `entry`, `reveal`, `emphasis`, `annotation`, and `exit` — as an authoring projection; those clips are not a second runtime timeline and charts do not enter `composition-animation-manifest.ts`. Every rendered value derives from the common frame request, so preview, scrubbing, random seeks, transition snapshots, and export resolve the same chart frame.

Type Fields are the third Surface-carried Block group. Only a non-Stage `plain` composition may carry `surface.typeField`; the Dimensional Stage remains outside v1. The shipped static schema holds 1–16 stable Kinetic Words and 1–8 ordered semantic phrases; every phrase references existing words in reading order and names a `display` focal word. Each complete placement may pin the word's start, centre, or end edge so Pack-neutral layouts keep their authored alignment when the loaded face changes width. Word ids share one namespace with Diagram and Chart Block ids. `KineticTypeFieldMount.svelte` renders the complete pool once as native DOM on the Surface capture plane, resolves Pack ink/accent plus the real variable face at its rest weight, and applies shared or complete orientation geometry. Phrases never place, reorder, or duplicate pixels. Each word has a full-composition Timeline row, readable identity, Inspector, direct canvas drag/nudge path, and one of six revisioned operations split by family. The first add and last removal maintain the parent field atomically; referenced removal refuses. Independent opacity, masked `reveal`, spatial, normalized-weight, and `tracking` tracks plus a per-word glyph stagger ship as schema and runtime state (ADR-0064); Motion Beats remain reserved and are not yet schema or runtime state.

### Body text format

Paragraph bodies are stored as a single bracket-tag string, parsed into the runtime `AnnotationBodyBlock[]` shape by `parseAnnotationBodyText`. Paragraphs split on `\n\n`; marks wrap text with paired tags (`[highlight]…[/highlight]`); marks stack by nesting (`[magnify][side-note]…[/side-note][/magnify]`). Per-mark appearance + timing live in `marks.timings[index]`, keyed by each `(segment, style)` pair's document-order position; `marks.defaults[style]` is the per-style fallback. No inline-on-tag attributes.

## The Pipeline Registry

Pipeline registration is split at a deliberate load boundary ([ADR-0049](adr/0049-lazy-pipeline-renderer-loading.md)). `PIPELINE_DEFINITION_REGISTRY` in `src/lib/platform/pipelines/definition-registry.ts` is the synchronous source for canonical IDs, labels, schemas, defaults, controls, and semantic validation. Each family runtime renderer imports and spreads its `definition.ts`, then adds Svelte, drawing, shader-pass, or GPU-pass capabilities. Every visible Pipeline is also paired with an **Identity Spec** ([ADR-0015](adr/0015-identity-spec-per-pipeline.md)) validated at boot by `assertIdentityRegistryValid`.

`runtime-loader.ts` is the only complete concrete-renderer catalog. Its explicit dynamic imports are keyed by definition identity; tests invoke every production loader, verify the returned identity, and check every catalogued Preset's recursive requirement closure. Deterministic readable-text declarations stay on renderer-free Overlay definitions, so static lint and render audits share one typed content authority without pulling Svelte or renderer implementations into server and initial route graphs. Requirements use `listMarkInstances`, so generated checklist strikes and authored body/message marks share one authority. Before `Workspace` mounts, the route derives requirements from the active Preset, Pack chrome, and recursive transition endpoint graph, awaits them, and activates one synchronous bundle. Concurrent activations merge, so an older completion cannot discard another loaded family. `runtime-context.svelte.ts` exposes one reactive activation revision; mounts and inspectors therefore update even when activation is not paired with an engine-state mutation. Authoring operations await a newly selected type, reject stale generations after navigation or a newer edit, and only then mutate state. Frame execution, transition snapshots, and export only read the active bundle; they never import asynchronously, and a missing required Surface, Block, Annotation, Overlay, or ordinary Effect renderer is an invariant error rather than a silent skip. The route preloads every authored Chart, Diagram, and Kinetic Word Block renderer; each mount then requires the renderer for the currently visible Chart, mounted Diagram primitive, or Type Field word. The paper Surface resolves focal Annotation behavior from that active bundle instead of statically importing focal renderer modules. These on-demand imports sit outside SvelteKit's own stale-deploy fallback, so a tab that outlives an integration rebuild carries its own recovery ([ADR-0058](adr/0058-stale-build-recovery-for-on-demand-imports.md)): `kit.version` polling turns a stale tab's next navigation into a full page load, and a failed import reloads onto the current build once through `stale-build-recovery-runtime.ts`, with the route holding "Loading…" until the reload lands. `pnpm probe:stale-build-recovery` proves all of it against the built artifact.

Each registered renderer's exported symbol keeps both its canonical Pipeline ID and Layer role when imported outside its family directory: hyphenated IDs become camelCase, followed by `SurfaceRenderer`, `BlockRenderer`, `AnnotationRenderer`, `OverlayRenderer`, or `EffectRenderer` (for example `paperSurfaceRenderer`, `edgeArrowBlockRenderer`, and `waterEffectRenderer`). Definition exports use the corresponding `SurfaceDefinition`, `BlockDefinition`, `AnnotationDefinition`, `OverlayDefinition`, or `EffectDefinition` suffix. Registry property names and renderer `type` / `style` IDs remain stable independently of those source-level symbols.

**Live contents** (verified against code):

| Layer       | Registered                                                                                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| surfaces    | `paper`, `plain`, `newspaper`, `pullquote-on-photo`, `chapter-card`, `brand-mark`, `title-sequence`, `type-hero` (variants `single`/`pair`), `web-document`, `website-screenshot`, `imessage`, `checklist`                                                                                                                                               |
| blocks      | `paragraph`, `node`, `edge-arrow`, `label`, `stat-callout`, `timeline-segment`, `bar-chart`, `column-chart`, `line-chart`, `unit-grid-chart`, `dot-field-chart`, `kinetic-word`                                                                                                                                                                          |
| annotations | `highlight`, `underline`, `strike`, `circle`, `box`, `side-note`, `magnify`, `lift-out`, `tear-out`, `isolate`                                                                                                                                                                                                                                           |
| overlays    | `lower-third` (variants `standard`/`cinematic`), `washi-tape`, `watermark`, `shader-fill`, `cursor-trail`, `counter` (`slot-machine-roll`), `instance-stack` (`vertical-stack`/`horizontal-train`), `text-3d` (`cylinder-axis-y`), `tweet-stack`, `youtube-subscribe`, `instagram-follow`, `achievement` (`checklist-complete`/`unlocked`), `source-url` |
| effects     | `paper-grain`, `chromatic-aberration`, `crt-screen`, `crt-tube`, `ntsc-signal`, `dithering`, `pixelation`, `halftone-dots`, `halftone-cmyk`, `water`, `fluted-glass`, `refractive-lens`, `frosted-glass`, `fluid-ripple`, `cloth-bend`, `tiled-deformation`, `heatmap`                                                                                   |

`tweet-stack` is an authoring-time-baked platform artifact. Its draggable pile window drives a pure index/progress schedule; cards never use CSS transitions, randomness, or live X requests during preview/export. The Pipeline reflows one centered cluster across both targets and declares X card chrome Pack-immune for found-document fidelity. The local `/api/x-post` authoring route resolves supported public share URLs through X oEmbed, then persists the returned text and identity fields inside the Preset.

**Dead-by-use — resolved.** `isolate`, `watermark`, `shader-fill`, `chromatic-aberration` were registered + boot-valid but referenced by zero presets; each now has a proving fixture (`isolate-demo`, `watermark-demo`, `shader-fill-demo`, `chromatic-aberration-demo`) that renders the pipeline, so all four are kept (not removed). Every registered pipeline is now referenced by ≥1 preset.

Fixtures are excluded from the app catalog and skip the deliverable-only static safety/readability lint, but every Preset still passes structural, semantic, Pack, and Identity validation. Derive corpus size from `src/lib/presets/*.json`; do not copy a count into guidance.

### Validation boundaries

`PresetSchema` owns structural JSON validation and transforms. `validatePresetSemantics` then validates the parsed Preset against the live registries: Pack slug, Surface registration and variant, Overlay registration/content schema, post-process or composition Effect registration/params, transition Effect registration, Stage registration, substrate assets, collection IDs, text-animation Overlay targets, Chart cross-field facts/timing, Type Field Surface/shared-id/phrase/focal-hierarchy rules, and transition references when a Preset resolver is available. Unknown authored primitives and malformed Chart or Type Field declarations fail at load; renderers never silently skip or repair them. The same semantic pass runs for the built-in catalog, `parsePreset`, `scripts/verify-presets.ts`, and user-composition list/load/create/update boundaries.

For charts, `validateChartGroupSemantics` requires unique complete category/series references, finite factual domains, compatible single/grouped/stacked layouts, explicit normalized parts whose exact sum matches the authored total, resolvable factual highlight/callout targets, valid computed-label formats, a non-emphasis base fill role, ordered phases, and non-overlapping sequence intervals. Render/layout/GPU helpers also fail closed on non-finite values or allocation overflow rather than altering represented values.

The ordinary Effect registry contains the single-input post-process Effects listed above. Smooth `refractive-lens` and rough `frosted-glass` share normalized optical geometry but remain distinct from architectural `fluted-glass` ([ADR-0044](adr/0044-optical-lens-and-frost-family.md)). Frost uses a bounded region-local 169-tap isotropic gaussian kernel inside the existing single-pass contract; no speculative multi-pass resource lane exists. `fluid-ripple` and `cloth-bend` resolve authored impulses through the shared fixed-step reset/replay runtime before packing GPU uniforms; `tiled-deformation` remains stateless and progress-addressed ([ADR-0046](adr/0046-seekable-simulation-and-deformation-families.md)). Composition-owned Effects whose execution changes the render path live in `composition-effect-registry.ts`; `depth-of-field` is the first. Stage types live in `stage-registry.ts`; `depth` is currently the only registered Stage.

### Variants as data

A Pipeline hosting a _family_ of motion shapes carries a `variants/` subfolder — one file per variant (`{ id, label, defaults, motionShape }`), one Identity Spec for the family ([ADR-0020](adr/0020-variants-as-data.md)). Adding a variant = one file + one `VARIANT_IDS` line + schema regen. No new registry entry, no Identity-Spec re-declaration.

### Adding a primitive

One folder under `src/lib/pipelines/<layer>/<name>/` (`definition.ts` + lazy runtime `index.ts` + `CanvasSource.svelte` + optional per-type inspector) + one entry in `PIPELINE_DEFINITION_REGISTRY` + one dynamic loader in `runtime-loader.ts` + its `identity.ts`. `Overlay.type`/`Effect.type` are open strings validated by `validatePresetSemantics`, so no enum edit is needed for those; `SurfaceType` is a closed enum, so a new surface adds one enum member. Registry-backed ordinary add menus and mounts discover the renderer; specialized inspector UI remains explicitly additive. Chart registration is deliberately stricter: each new Chart family also needs its discriminated schema, factual semantic rules, shared authoring mutations and explicit add-menu/inspector support, geometry/render-input path, timeline projection, and tests.

## Rendering pipeline (TypeGPU)

`composition-frame-renderer.ts` owns the deterministic request-object `renderCompositionFrameTo(request)` seam. Renderer readiness is established before `Workspace` mounts; this path only performs synchronous lookups in the active renderer bundle. `Workspace.svelte` owns the live Svelte/DOM/GPU references and builds one `CompositionFrameRenderRequest` snapshot for each call. Preview supplies the current canvas view; `CompositionExportController` calls back with the same canvas view at exact frame timestamps; `TransitionSnapshotController` calls back with offscreen endpoint views.

The frame renderer owns all ordering after the request arrives:

```
0) Cached transition?     wipe(fromSnapshot, toSnapshot) → output; no live DOM upload
1) Live preparation       buildSurfaceInputs(timestamp), resolve Pack treatments,
                           upload DOM only when its browser paint generation changed
2) Branch dispatch        stage → multiplane DOF → flat (first available branch wins)
3) Branch-local render    pipeline.render(inputs), then branch compositing/shader passes
4) Effect chain + present effectChain.apply(effects, input, outputView)
                           → dithered present pass; the active Video clip is
                             centered-cover composited beneath processed GFX pixels
                             (the only 16f→8bit canvas write)
```

The **stage** branch runs Surface/Pack shader passes, captures an optional Overlay plane, renders `DepthStage`, then applies post-process Effects. Inside `DepthStage` ([ADR-0028](adr/0028-dimensional-depth-stage.md), posed and depth-tested by [ADR-0057](adr/0057-filmed-canvas-camera-pose-and-posed-planes.md)): the camera for the frame comes from `createStageCameraRig` in `depth-stage-camera.ts` (rest pose + one travel + the legacy push/drift, the same function the GUI hit-test projector uses; under a vertical frame `resolveStageCameraForOrientation` first swaps in the authored `stage.camera.vertical` pose and travel, once, for the renderer, the projector, and the rubric alike); every captured plane is a quad on a general basis (`depth-stage-planes.ts`: origin, half-width and half-height vectors, normal — the frontal planes are the axis-aligned case); the scene pass (`depth-stage-plane-pass.ts`) draws the planes back to front in two depth-tested passes — texels whose presence (coverage × composition fade) reaches 0.3 own their pixel, writing a `depth24plus` attachment and an `rg16float` sidecar (depth01, and whether the texel takes ambient obscurance) and blending premultiplied, then the soft skirts blend over what is really behind them without writing depth — with the Pack key light as a received rake in each plane's own basis, a facing term for tilted planes, and a marched cast shadow from up to four upstream planes; the mip-prefiltered half-res DOF gather and the full-res compose read depth from the sidecar, never from the colour target. Under an authored pose the receding planes sample stage-owned mip copies through an anisotropic sampler and the depth encoding widens to the distances the move can reach and the lens scales with the camera's nearness (circle of confusion per world unit as one over the focus distance squared, so a close filmed page defocuses like footage); the frontal camera keeps the single-level sources, so the shipped Presets render as before. An Overlay with an explicit signed `z` or a `pose` rides its own posed plane: `Composition.svelte` gives it its own frame-sized direct canvas child (the capture lane rasterizes direct children only), `CompositionPlanes` captures and premultiplies it into its own texture, and the plane is placed in the posed camera's frame (the rig's `anchor`: pose and travel, before the legacy push/drift offset) — the ray through the Overlay's rendered centre (measured from that root) meets the page-parallel plane at the Overlay's signed depth, the quad is sized to keep the Overlay's authored frame size there, and the pose turns it about that centre relative to the Surface plane — so a posed lower-third stays inside the safe area while the page moves behind it, and the legacy moves still parallax it as the world-fixed plane an explicit `z` always was; the other Overlays share the merged plane at the Layer default depth. Plane count, posed planes (at most four, also a semantic validation error), mipped planes, resident texture bytes, and mip passes per frame are ceilings (`STAGE_PLANE_CEILINGS`) enforced before GPU work with a corrective `StagePlaneCeilingError`. A **body** ([ADR-0059](adr/0059-compiled-stage-models-and-the-physical-screen.md)) joins the same scene: `stage.screen` names a registered model (`stage-models.ts`, bytes in `src/lib/assets/models/*.stagemesh` compiled by `scripts/compile-stage-model.ts`, decoded by `StageModelController` before first paint and export) whose glass IS the Surface plane — `depth-stage-geometry.ts` fits the opening inside the frame plane, crops the composition to it (`uvWindow` on the plane uniforms), and places the model so its screen centre sits on the stage origin; while a body is present the scene passes render 4× multisampled and `depth-stage-body-pass.ts` resolves them back (colour averaged, depth nearest), draws the body between the opaque planes and the skirts through the Stage's material model (`depth-stage-material.ts`: per-region albedo, roughness, and metallic lit in linear light — Lambert under a GGX lobe with correlated Smith visibility and Schlick Fresnel, the key as a small softbox, an analytic room of the Pack field under a dim ceiling — tone-compressed and encoded to the display-space scene), and renders the bodies into a 2048² shadow map every plane and body reads with a blocker search and a fixed disc filter (`depth-stage-shadow.ts`, shared with the plane march). The picture lights the room through `depth-stage-screen-light.ts`: the glass is an area light on the housing, the floor the model declares, and the backdrop. After the resolve, `depth-stage-ambient-occlusion.ts` grounds the scene: a spiral obscurance estimate over the resolved sidecar with normals rebuilt from depth, blurred once each way depth-aware, darkens the resolved colour wherever the sidecar marks a texel occludable (the glass, an emitter, is not). A model's optics draw the glass as a domed grid with the `crt-tube` physics fixed to it (raster and dome in glass space, the mask in frame pixels so it never aliases through the warp). Bodies that declare themselves focus subjects pull the lens by their presence; a screen never does. An Overlay may own a body ([ADR-0062](adr/0062-dimensional-type-compiled-typefaces-and-the-first-overlay-body.md)): `dimensional-type` declares `stageBody` in its definition and contributes, through `OverlayStageBodyRenderer`, a mesh `stage-type-geometry.ts` builds from the Pack's compiled typeface (`stage-glyph-format.ts` and `stage-glyph-outline.ts`, registered in `stage-typefaces.ts`, decoded before first paint and export by `StageTypefaceController`) — caps triangulated, sides extruded, a chamfer bevel over a validated inset — with materials from its `dimensional-type.*` Roles and its settled-place terms; `stage-body-overlays.ts` resolves every body Overlay into a `DepthStageBody` by the posed-plane law (`resolveStageFramedBodyModel`, the mount's placement made analytic by `resolveOverlayPlacementCenter`) for the frame renderer and the canvas regions alike, and `partitionStageOverlays` keeps a body Overlay out of every capture root so the stage alone owns its pixels. Four rules keep a thin or arriving body clean (ADR-0062): the shadow map's receiver offset and bias grow with the receiver's slope to the key; a body below full presence lays its depth down in a pre-pass so its far surfaces never blend through its near ones; the resolve averages a pixel's depth samples on one surface and keeps the nearest across a contour; and the obscurance subtracts a rise of a pixel and a half plus two steps of the sidecar's 16-bit precision before a tap counts. `STAGE_BODY_CEILINGS` bound bodies, vertices, indices, mesh bytes, and the resident bytes the multisampled set and shadow map add. The **DOF** branch renders the Surface plane, captures the Overlay plane, composites both through `CompositionPlanes`, removes the routing-only `depth-of-field` entry, then applies remaining Effects. The **flat** branch renders the merged Surface/Block/Annotation/Overlay texture, dispatches Surface then Overlay shader passes in document order, and applies Effects. Shader passes ping-pong over `rgba16float` intermediates. A pass may opt into a clamped native-pixel region or an independently-scaled full-frame intermediate; expensive local work is scissored into a clear scratch target, then a cheap clear-and-composite pass restores the untouched input outside that region. Final output remains native resolution, and passes without execution hints retain the original native full-frame path.

**Contract specifics (all current):** off-screen intermediates are `rgba16float` (`INTERMEDIATE_FORMAT`); the **present pass** applies interleaved-gradient-noise dither (±0.5/255 on RGB, alpha exact) on the single 16f→8bit write — this is the banding fix, and it runs whether or not effects exist; canvas context is `alphaMode: 'premultiplied'`; every color attachment uses `loadOp: 'clear'`, `clearValue: [0,0,0,0]`. Time-driven shaders read `ctx = { progress, timestamp, canvasWidth, canvasHeight }`, plumbed identically through both the effect chain ([ADR-0012](adr/0012-effect-pack-context-progress-timestamp.md), amended to carry the canvas dimensions for resolution-dependent shaders) and shaderPasses ([ADR-0013](adr/0013-shaderpass-pack-context.md)) so preview and export agree. Local and scaled pass targets never redefine `canvasWidth` / `canvasHeight`; those remain the native composition dimensions.

**Video-track final-present path.** At explicit output frame `F`, clip resolution searches the ordered half-open intervals `[timelineStartFrame, timelineStartFrame + durationFrames)`. An active clip maps `localFrame = F - timelineStartFrame` and `sourceTime = sourceStartSeconds + framesToSeconds(localFrame, transport rate)`. The decoder adds the asset track's first PTS, selects the last presentation sample at or before that requested timestamp, uploads it to the one resident `rgba8unorm` underlay texture, and passes that prepared texture through the same `CompositionFrameRenderRequest` used by preview and export. Decoder ownership/cache keys use immutable asset identity/URL, so repeated clips can reuse a decoder without making source offsets asset state. The present pass applies display rotation and centered cover sampling at the native target, then composites the already-processed premultiplied GFX result over the footage. Authored Effects and Pack chrome therefore never grade creator footage. A gap supplies no texture and stays transparent; it never paints black or reuses the preceding frame. V1 rejects active Video clips with `backgroundFill`, a dimensional `stage`, or transition Presets before rendering.

**Composition-wide dispatch.** `renderCompositionFrameTo` selects per frame: prepared transition snapshots → cached wipe (no irrelevant live-DOM upload); else `state.stage` present → the **dimensional depth stage** ([ADR-0028](adr/0028-dimensional-depth-stage.md), `DepthStage`); else `depth-of-field` Effect or composition-owned Surface opacity → 2.5D multiplane composition (ADR-0027); else flat composite. Every live branch receives the same complete `SurfaceRenderInputs` (including diagram stroke inputs) and the same queue-ordered upload-before-render. `TransitionSnapshotController` owns endpoint cache allocation, state swapping/restoration, invalidation, and settled endpoint capture; the frame renderer only consumes its cached textures. All branches share the frame seam and final Effect/present path, so preview == export holds for each.

**Surface fades are GPU, not CSS opacity.** `copyElementImageToTexture` cannot rasterize a DOM element's CSS `opacity < 1` (it captures transparent — see [`html-in-canvas-typegpu.md`](html-in-canvas-typegpu.md)). So a surface's `paperVisibility` fade must be applied as an alpha-multiply on the captured texture (GPU), not via `style:opacity` on the element, or the fade is binary (full→gone). Done for the depth stage; generalizing to every surface is a tracked follow-up ([`roadmap.md`](roadmap.md)).

### shaderPass vs Effect

- **Effect** — composition-wide authored operation. Ordinary Effects are pure post-process passes; composition-owned Effects alter render dispatch before the ordinary chain; transition Effects composite two cached endpoint snapshots through top-level `transition.effect`. All are registry-validated, while only the first two classes live in `effects[]`.
- **shaderPass** — per-target work declared on a Surface/Overlay renderer, run before the effect chain, with per-target bounds/seed/time uniforms. This is where torn edges, fiber, hard-offset shadow, and substrate physics live.

### Focal shader (paper / plain composition)

The composition fragment applies focal warps from up to **8 focal-mark slots**. Each slot carries `{ rect, params=(magnify, dim, tear, styleCode), optics=(shape, intensity, ripple), color }` (`1=magnify, 2=lift-out, 3=tear-out, 4=isolate`, `0`=empty). Slot data is built in the pipeline's `render()` by walking `getAnnotationMarkLayouts` in document order, filtering focal styles, delegating to each renderer's `computeFocalSlot()`. Magnify evaluates its SDF, scanner reticle, ripple, and depth shadow in native pixels so physical shape survives orientation changes; source sampling stays in UV space. A `bgFloor` uniform (from `surface.backgroundVisibility`) floors how far the outside-of-lens dim can go. Decorative marks render first (into their own texture); focal warps apply on top of the composed stack; later slots win on overlap.

### Determinism + export parity

Every render is computed from a `timestamp`; the shared `Timeline` is the only clock; GSAP timelines are scrubbed by `progress`, never played by wall-clock. `CompositionExportController` owns the immutable native-size/output/codec/frame plan, exact rational frame stepping, export-only animation manager, DOM flush, audio/video handoff, progress, cancellation, downloads, and cleanup. Workspace supplies live state plus a callback into the exact same request-object frame seam used by preview. Preview records WICG `changedElements` generations and reuses its resident 4K DOM texture on shader-only paints; a direct canvas child the tracker has never seen is seeded by the first paint event delivered while it exists (it was painted before the handler attached — a Surface whose DOM is static from its first frame, like the newspaper page, is never reported by a later paint), and a capture that still finds no paint record keeps the resident texture and retries on the next paint. Export first awaits active-Pack fonts, required DOM images, stage substrate upload, and referenced media readiness; each frame then scrubs animation, flushes Svelte, requests and awaits the browser's next paint snapshot, and forces one queue-ordered DOM upload before `render()`. Prepared transitions export through their cached wipe, and future `SurfaceRenderInputs` additions cannot silently disappear from export.

Video clip resolution, random preview seeks, and serial export share the same frame-to-Source-time mapping, decoder cache, and resident-texture lifecycle; stale preview seeks are superseded, each sample closes after upload, and export awaits preparation before rendering. Each enabled clip's exact Source interval is decoded into its destination sample interval, gain-adjusted, and mixed with cues and an eligible bed at 48 kHz stereo. Hard-cut and gap boundaries are preserved; pause cancels pending decode/playback, loop restarts it, and scrub remains intentionally silent.

Export transport is a local Node session (`export-session.server.ts` plus `/api/export/sessions/*`): optional WAV is streamed once to a session file, ordered indexed PNG requests are written directly to one ffmpeg stdin under write-callback backpressure, and completion publishes only a successfully closed disk output. The browser retains at most the current PNG instead of an all-frame array and downloads the output URL directly; the server streams it through `createReadableStream` instead of `readFile`. Abort, download cancellation, encoder failure, explicit cancellation, expiry, and startup orphan cleanup remove the session directory and kill live ffmpeg. **Exports include all effects** — no clean-export toggle; edit the preset to strip effects if a clean variant is needed.

## Appearance: Packs & Roles

A **Pack** is a swappable _appearance dress_ resolved at render time ([ADR-0014](adr/0014-pack-preset-split.md)). It carries **appearance only — never motion** ([ADR-0023](adr/0023-pack-is-appearance-only.md)); form/timing/easing are intrinsic to the Preset+Pipeline. A Preset names exactly one Pack (`pack`, required), overridable at render time so the same Preset renders under any Pack. There is **no privileged default** — `syntax` is the `REFERENCE_PACK_SLUG` the boot gate validates against, not a fallback. **Every registered Pack must supply the mandatory core vocabulary** — the seven bare core Roles `fill-treatment` / `ink-treatment` / `accent-treatment` / `field-treatment` / `edge-treatment` / `depth-treatment` / `light-treatment` (`MANDATORY_CORE_ROLES` in `packs/types.ts`), colour cores as real colour strings and structural cores in resolver-recognised shapes. `field-treatment` is the Pack's full-frame field — the value `backgroundFill: "pack"` resolves to via `resolveBackgroundFill` (ADR-0039 §3). Direct-on-field content resolves the optional paired `field-ink-treatment`, falling back to `ink-treatment` when a Pack's ordinary ink already contrasts with its field; authored composition ink remains the explicit override. The boot gate enforces the mandatory minimum through `validatePackCoreVocabulary`. The authoring/CI gate is the broader `validatePackRegistry`: `role-contract-registry.ts` is the closed authority for every recognized Role's permitted kind, value validator, fallback, and typed pixel consumer, so unknown, wrong-kind, resolver-invalid, and consumer-less claims fail. The broader gate also checks registry key/slug identity, metadata, font-role declarations and weights, rejects unwired Pack-selected Pipeline roles, and validates Pack chrome through registered post-process Effect schemas. `scripts/verify-presets.ts` runs that manifest gate plus the full reference-Pack Identity contract. ViaPack completeness stays reference-pack-only; secondary Packs may intentionally rely on core fallback. `field-ink-treatment`, `material-treatment`, and `font-treatment` are recognised _optional_ cores.

**Declared Pack-immunity** ([ADR-0038](adr/0038-full-pack-buy-in.md), extended by [ADR-0039 §2](adr/0039-pack-neutral-compositions-and-listing-hygiene.md)): a Pipeline whose entire value is fidelity to a real artifact declares `packImmunity` (with a mandatory rationale) in its Identity Spec. Immunity comes in two forms. **Full** (`claimable` absent — web-document, imessage, paper, newspaper): no Pack appearance reaches the artifact; `isPackImmune(key)` / `PACK_IMMUNE_PIPELINE_KEYS` answer for this form only, and the pixel-diff lock holds these regions to the stability ceiling. **Partial** (`claimable` present — no registered Pipeline uses it today; the newspaper did until [ADR-0056](adr/0056-newspaper-photographed-page.md) made the photographed page fully immune): the document BODY (its own physics, held in the pipeline's substrate module, e.g. `newsprint-substrate.ts`) is immune, while the enumerated chrome slots still resolve from the active Pack — queried per-slot via `isAppearanceSlotPackClaimable` and applied by `filterPackAppearanceVarsForImmunity` in the mounts; partially immune pipelines stay in the pixel-diff must-change set at chrome-scale expected deltas. `resolveSurfaceTypographyColors` (`pipelines/index.ts`) layers this over the ADR-0038 typography chain: authored colours win, an immune document falls to its `substrateColors`, everything else falls to Pack cores. Treatments layered ON an immune artifact — annotation marks, Effects — still resolve from the active Pack. The registry sets are the complete authority and must not be copied into prose.

**The live path:** `SurfaceMount`/`OverlayMount` call `resolveAppearanceVars(getPack(slug), <type>)` and inject the result as inline CSS custom properties on the pipeline root; CanvasSources consume them via `var(--fill, <fallback>)`. Resolution is specific→core fallback like `var(--specific, var(--core))` ([ADR-0024](adr/0024-role-resolution-core-fallback.md)). Dimension names are normalized so every live core-dimension slot uses the core suffix and the fallback chain can land (`tear-out.fill`; the retired `isolate.depth` and `paragraph.material` claims were removed with their dead consumers; the historic `fragmentFill` / `dimDepth` / `glyphEdge` off-core names are gone); a Pack that passes the core gate therefore always emits `--fill` / `--ink` / `--accent`, and a per-Pipeline Role may explicitly claim `'currentColor'` (e.g. `node.ink`) to ride the inherited composition colour instead of the core.

**Two pack sources** ([ADR-0055](adr/0055-user-defined-packs.md)): `getPack` keeps its synchronous contract and resolves `PACK_REGISTRY` first, then the runtime User Pack source `user-pack-runtime.svelte.ts` installs — a `$state.raw` record of the store documents loaded into this engine plus, per slug, a preview manifest while the author edits, so every `$derived` that reads a pack re-runs on load, edit, save, and unload. `ensurePackLoaded` (`user-pack-runtime.ts`) is the one place a slug crosses from the store into the runtime (document fetched, cached faces registered through the `FontFace` API, manifest resolvable), and every path that can name a pack — opening a composition, `appearance.set-pack`, readying renderers, importing a document, the Pack control — calls it first; a slug neither source holds fails closed as `UnknownPackError`, never a substitute. Preset semantic validation takes a `packScope`: `registry` by default (every deliverable gate), `runtime` for the open document and drafts, `stored` for the composition store's own documents, which stay loadable when their pack is gone so the author can rebind. `fontsReady()` sweeps the loaded User Packs on every call on top of its memoized built-in sweep, so preview and export gate on the same faces. Nothing under Node ever installs the runtime source: scripts and gates see the built-in registry alone.

> **Honest current state.** Color and font reach pixels through `resolveAppearanceVars`; all four structural treatment families have typed consumers. `resolveDepthTreatment` produces hard-offset or glow depth; `resolveEdgeTreatment` drives the shared silhouette alpha-mask ShaderPass; `resolveLightTreatment` supplies the depth stage's received rake and cast-shadow key light; and `resolveMaterialTreatment` dispatches the shared alpha-masked CRT scanline ShaderPass. The old generic `resolveStyle` / `resolveRole` accessors are removed. Not every Pipeline consumes every treatment, but a registered Pack's mandatory core values are resolver-validated, and optional material/font cores are consumed when present. `variable-weight-treatment` adds one exact self-hosted display face plus minimum/rest/maximum `wght` coordinates; normalized text motion maps through it, while ordinary text keeps the existing static face.

**Pack chrome (opaque pieces).** A Pack MAY supply a `chrome` Role (`kind:'chrome'`): an effect recipe `composition-frame-renderer.ts` appends **after** the preset's own `effects[]` whenever the composition declares a `backgroundFill` (the frame is a full-frame segment/bumper). The chrome is the Pack's _dress_ supplying **initial values** — it never appears in the preset JSON on its own (swap the Pack and the chrome goes with it), and transparent overlays never receive frame chrome (the footage isn't ours to treat). **Override lane:** an authored effect of the same type in `effects[]` takes ownership — `appendPackChrome` skips the Pack's copy of that type, so there is never a double application. The inspector surfaces chrome entries in the Effects section (tagged `PACK`) with their full param editors; the first edit materializes the authored override (tag flips to `PACK · OVERRIDDEN`, removable — removing it restores the Pack default). First consumer: `crt-terminal`'s `crt-tube` physical tube (`src/lib/pipelines/effects/crt-tube/`).

## Output & orientation

**Transparency is the default, not a law.** Overlays render transparent (`loadOp: 'clear'`, premultiplied alpha). Output classification is centralized: `backgroundFill` or a dimensional `stage` is opaque; Video clips are opaque only when their ordered half-open intervals cover every output frame. Unused Media library entries do not affect classification, and any Video-track gap keeps the composition alpha-bearing. A transition is opaque only when **both** resolved `from` and `to` Presets are opaque. Export uses that result for codec handling and the `gfx-bumper` / `gfx-overlay` basename. Fully covered Video-track WebM uses opaque `yuv444p`; a gapped track retains VP9 alpha; ProRes remains 4444 for both. There is no `overlay | segment | bumper` enum — those are loose descriptive words, not engine categories.

**Orientation** is `horizontal` (3840×2160) or `vertical` (2160×3840). One deliverable Preset serves both targets: the GUI switches `transport.orientation`, renderer layouts consume frame dimensions and shared safe-area inputs, and explicit Overlay/Diagram/Kinetic Word snapshots resolve authored re-staging. The static linter validates the active geometry without clamping it. Active authoring forbids orientation-suffix deliverables.

## Text animation orchestration

`src/lib/text-animations/` is **peer to the Layers — it does not render.** It choreographs the DOM that HTML-in-Canvas captures, emitting GSAP tween specs against SplitText unit spans and feeding them into the same `AnimationManager` so every text tween scrubs by `progress` alongside marks and transitions ([ADR-0011](adr/0011-text-animation-orchestration.md)).

```
text-animations/
├── raw-catalog/         vendored from pixel-point/animate-text (pinned sha): effect specs
├── catalog.ts           typed TEXT_EFFECT_CATALOG (zod-validated on load)
├── split-text.ts        GSAP SplitText wrapper → stable per-slot span maps
├── availability.ts      slot / Pack capability / Identity admission
├── unit-style.ts        capture-safe opacity and variable-weight style writers
├── compile.ts           pure: compileTextAnimation(inputs) → AnimationTweenSpec[]
├── strategies/          generic-stagger + layout-aware renderer families
└── manager.svelte.ts    TextAnimationManager: observes engineState.textAnimations, resolves
                         data-text-anim-slot nodes, compiles, exposes unitAlphaAt() for marks
```

**Catalog-vs-Pipeline boundary** ([ADR-0011](adr/0011-text-animation-orchestration.md) amendment): a verb belongs in the catalog iff (a) it's per-unit keyframed motion with no inter-unit pixel dependency AND (b) every keyframe is CSS-rasterizable without a shader pass. Either failing kicks it to a Pipeline with its own Identity Spec — so the catalog lane can't smuggle shader-class effects past the identity gate. A new generic-stagger effect lands as data (re-run `sync-text-animation-catalog.ts`); a new layout-aware renderer is one strategy file + a dispatch entry. `weight-resolve` proves that real variable-font `wght` still fits this boundary: the keyframe stores `[0,1]`, the active Pack maps it to its real face/range, the writer refreshes that capability from each unit's current Pack ancestry, and it emits `font-variation-settings` with synthesis disabled. The unit box stays locked to settled geometry so axis interpolation changes glyph mass without rewrapping the phrase.

## Known gaps

Current mechanisms that remain deliberately narrower than their possible future form; track execution in [`roadmap.md`](roadmap.md).

- **3D Canvas Upgrade (Dimensional Stage expansion)** — phase 1, the filmed canvas ([ADR-0057](adr/0057-filmed-canvas-camera-pose-and-posed-planes.md)), shipped 2026-09-02: the depth Stage has a camera pose with an aim point and one travel (`depth-stage-camera.ts`; focus follows the aim, the lens scales with the camera's nearness), a depth-tested plane-basis compositor with oblique sampling and ceilings (`depth-stage.ts`, `depth-stage-plane-pass.ts`, `depth-stage-planes.ts`), posed Overlay planes placed in the posed camera's frame (signed `z`, `pose`, one frame-sized capture root per posed Overlay in `Composition.svelte`, per-Overlay textures in `composition-planes.ts`, the per-plane projector the editor hit-tests with), a `filmed` framing for `website-screenshot` over the bundled capture registry (`capture-assets.ts`), GUI/agent parity (pose, travel, and aim as fields in the stage section plus grab-the-page reframing on the canvas; signed depth and pose in the Overlay inspector with `placement.set-overlay-pose`; framing, page anchor, and bundled capture in the Surface inspector with `placement.set-surface-page-anchor`), and the proving deliverable `website-filmed`. What remains narrower than its possible form: the filmed page plane is frame-sized, which bounds how steep the camera can sit before a frame corner leaves the page (rubric WS7) — a capture-sized plane would lift that. Phase 2 ([ADR-0051](adr/0051-pipeline-defined-dimensional-stage-geometry.md), closed 2026-09-03) landed its first body on 2026-09-02 with [ADR-0059](adr/0059-compiled-stage-models-and-the-physical-screen.md): the compiled-model lane and the physical screen (`stage.screen`, the FW900 CRT, the demo fixture `crt-filmed`), with the body pass, the material model, the multisampled scene, the shadow map, the ambient-obscurance grounding, the vertical camera (`stage.camera.vertical`), and the ceilings every later body shares; the Stage reached the Workspace with [ADR-0060](adr/0060-the-stage-in-the-workspace.md) (Camera and Focus rows and one row per body, stage inspectors by selection, the body as a canvas entity, orbit and dolly by hand); and dimensional type landed with [ADR-0062](adr/0062-dimensional-type-compiled-typefaces-and-the-first-overlay-body.md) as the first Overlay-owned body and the first consumer of the focus-pull rule (compiled typefaces in `src/lib/assets/typefaces/`, `stage-type-geometry.ts`, the `dimensional-type.*` Roles, deliverable `headline-hands-on`). What remains narrower than its possible form: the frame-sized filmed page plane above, dimensional type for the Block Layer (waits for a Brief), sheet thickness for paper (descoped at the closeout; returns behind a consumer), and the Pack-chrome question a post-process tube raises on a piece that already is a tube.
- **Per-pixel depth sidecar on the flat path** — ADR-0021's focal-distance semantics are active through multiplane DOF and the dimensional stage, but the flat compositor has no arbitrary per-pixel z-map target.
- **Live dual-tree transitions** — multi-state transitions ship as cached snapshot-and-wipe ([ADR-0026](adr/0026-transitions-v1-snapshot-and-wipe.md)); endpoint Presets do not continue animating inside the wipe.
- **Additional Block vocabulary** — `paragraph`, the five Diagram Blocks, the five Chart Blocks, and the `kinetic-word` Block/Type Field substrate ship ([ADR-0064](adr/0064-kinetic-type-word-fields.md)). Kinetic Words own bounded opacity, spatial, and normalized-weight tracks with complete target-specific spatial replacement; Motion Beats, beat-relative keys, and tracking remain designed but not built. `code` and `image` are not registered; mermaid-style auto-layout remains explicitly rejected.
- **Video-track v1 scope** — one primary 1x track with ordered, non-overlapping hard-cut clips, transparent gaps, clip audio enable/gain, and no ripple edits, overlaps, transitions, speed changes, loops/holds, footage grading, depth-stage video planes, or live video transitions. Silence detection and automatic cut generation remain separate edit-decision producers over this shipped clip model.

## Constraints

- **`gfx@1` schema id.** Shape changes happen in place; built-in presets are hand-migrated. Stale external presets fail validation cleanly.
- **Annotation stack order:** decorative under focal, then document order; codified in the composition shader. Two focal marks on one body are permitted but soft-warned.
- **Overlay positioning is anchor + fractional offset** (0..1 of composition dims); `normalized-rect` for precise/offscreen placement.
- **`marks.timings` length mismatch is intentional** — fewer than marked spans → fall back to `defaults[style]`; more → extras ignored. Don't "fix" by inventing timings.
- **Body-shape duality** — on disk a bracket-tag string; at runtime `AnnotationBodyBlock[]`. Code reading `surface.content.body` must treat it as `AnnotationBodyBlock[]`, not as the complete Block Layer union.
- **Specialized UI is opt-in and strictly additive.** `BlockRenderer`/`OverlayRenderer`/`EffectRenderer` may ship an `Editor`/`Inspector`; `SurfaceRenderer` and `AnnotationRenderer` never do (annotation controls are always `{style, color, intensity, ease}`).
- **Catalog discipline over preset count.** Deliverable vs fixture is the catalog split (ADR-0025); there is no fixed "N built-in presets" cap — each surface/overlay family wants one Critic-accepted deliverable (the corpus, tracked in `roadmap.md`).

## Non-goals

- A general node/keyframe compositor. GFX is an opinionated, constrained vocabulary with smart defaults — After Effects is the _quality ceiling_, not the architecture.
- Cross-pipeline morphing at runtime (switching surface/overlay type is a content edit, not an animated transition — transitions between _Presets_ are the ADR-0022 path).
- Coordinate-anchored text marks (inline bracket marks are the only text-addressing model).
- Cloud sync, accounts, multi-user editing.
