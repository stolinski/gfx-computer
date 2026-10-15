# ADR-0057 — The filmed canvas: a stage camera pose and posed planes precede Pipeline geometry

## Status

**Canon (phase 1 built 2026-09-02, approved on gfx-review; phase 2, [ADR-0051](0051-pipeline-defined-dimensional-stage-geometry.md), built and closed 2026-09-03 — its bodies are the physical screen of [ADR-0059](0059-compiled-stage-models-and-the-physical-screen.md) and the dimensional type of [ADR-0062](0062-dimensional-type-compiled-typefaces-and-the-first-overlay-body.md), made visible in the Workspace by [ADR-0060](0060-the-stage-in-the-workspace.md)).** Direction plate: [`docs/inspo/3d-canvas/perspective.png`](../inspo/3d-canvas/perspective.png). Dex epic `sh9b6qxd`, complete 2026-09-03. The phase-1 Brief `filmed-canvas` was retired with the landing change on 2026-09-02 and the phase-2 Brief `stage-bodies` with the closeout on 2026-09-03, as the Brief lifecycle requires.

Date: 2026-09-01

Builds on: [ADR-0021](0021-z-plane-semantics.md) (z as focal distance), [ADR-0028](0028-dimensional-depth-stage.md) (the shipped depth Stage and its camera-as-data rule), [ADR-0035](0035-generalized-keyframes-and-cascade.md) (authored motion windows), [ADR-0051](0051-pipeline-defined-dimensional-stage-geometry.md) (Pipeline-defined geometry), [ADR-0056](0056-newspaper-photographed-page.md) (the frame is a crop into a photographed page)

## Context

ADR-0051 planned the 3D Canvas Upgrade as a geometry contract: registered Pipelines contribute bounded TypeGPU meshes into a depth-tested Stage, and the first proving Pipeline is a procedural `dimensional-form` Overlay. That remains the right architecture for real volume.

The direction plate shows something the shipped Stage cannot make and the geometry contract does not address: a flat web page filmed by a real camera from a low oblique angle, close, with focus falling off continuously across the receding page. Every shipped Stage plane is fronto-parallel; the camera only pushes on axis or drifts sideways; the lighting and cast-shadow math assume axis-aligned quads; every Overlay shares one plane; and a captured page is sampled without mips, so a tilted 4K page would shimmer. On 2026-09-01 Scott confirmed the plate is one facet of a larger idea whose parts are: an obliquely posed camera, elements posed in 3D (a card floating angled in front of the page), real 3D forms, physical screens and paper, and one lit scene. He chose to build the camera and posed planes first, then the geometry contract.

The ordering matters for quality, not just sequencing. A camera pose, per-Overlay planes, plane-basis lighting, and oblique-safe sampling lift every existing depth Preset immediately and are prerequisites for judging geometry: a mesh contributed into a fronto-parallel stage can only be looked at head-on.

## Decision

The 3D Canvas Upgrade ships in two ordered phases under one Dex epic (`sh9b6qxd`). ADR-0051 stays the phase-2 design; this ADR is the phase-1 decision and the ordering rule.

### Phase 1 — the filmed canvas

1. **The Stage camera gets a pose.** `stage.camera` gains an optional rest `pose` — `yaw`, `pitch`, `roll` in bounded degrees, `distance` as a fraction of the shipped rest distance, and an `aim` point in composition fractions on the Surface plane — and an optional `travel` to a second pose over one authored window with the constrained ease enum. The camera orbits the aim point; `lookAt` targets it. The defaults (`yaw` 0, `pitch` 0, `roll` 0, `distance` 1, `aim` centre) reproduce the shipped frontal camera exactly, and the legacy `move: push | drift` composes on top, so no existing Preset changes a pixel. The math lives once, in `depth-stage-camera.ts`, and the renderer, the frame resolver, and the GUI hit-test projector all consume it. Camera remains data scoped to the Stage that renders it (ADR-0028); Surface transforms stay camera territory.

2. **Focus follows the aim.** When a pose is authored, the focal plane passes through the aim point's camera-space distance; `focusZ` and the rack-focus `pull` measure from there toward the backdrop. A travel that moves the aim racks focus with it by construction.

3. **Overlays can be posed.** Overlay `z` becomes signed: negative is nearer the camera than the Surface plane, positive is toward the backdrop, and the flat multiplane path reads `|z − focusZ|` unchanged. Overlays gain an optional `pose` (`yaw`, `pitch`, `roll`). Any Overlay with a `pose` or an explicit `z` rides its own capture plane, placed **in the camera's frame**: its placement means what it means everywhere else in GFX — where the element sits in the delivered frame — so the camera ray through the Overlay's rendered centre is cast onto the page-parallel plane at its signed `z`, the plane is sized to keep the Overlay's authored frame size at that distance, and the `pose` turns it about that centre relative to the Surface plane. The frame is the posed camera's — the `pose` and `travel`, before the legacy `push` / `drift` offset — so under the frontal camera that is the frame-sized plane at `z` and the legacy moves still parallax it as the world-fixed plane it always was (a shipped Preset with an explicit `z` renders exactly as before), while under a posed camera the Overlay stays where the author put it as the page moves behind it, so safe areas hold and a lower-third stays a lower-third, parallaxing against the page by its depth (a world-fixed card would slide out of frame under any real travel and belongs to phase 2's physical bodies). It casts and receives shadow like every plane. Unposed default-`z` Overlays keep sharing the merged plane exactly as today. At most four posed Overlay planes per composition; the fifth is a corrective semantic error. This is not a scene tree: an Overlay keeps its Layer identity, its placement vocabulary, and its inspector.

4. **The Stage becomes a depth-tested plane-basis compositor.** A real depth attachment with alpha-tested depth writes and premultiplied blending replaces painter's order, so posed planes that intersect resolve per pixel and transparent texels never occlude what is behind them. The received rake, the cast-shadow march, the partial-presence reconstruction, and the backdrop reconstruction are rewritten against a general plane basis (origin, U, V, normal). Plane textures get mip chains and an anisotropic sampler so receding native-4K text stays clean. Plane count, plane-texture bytes, and per-frame mip passes have explicit ceilings enforced before GPU work.

5. **`website-screenshot` gets a `filmed` framing over bundled captures.** A `framing: 'filmed'` variant lays the stored capture at native density covering the frame with no browser chrome, anchored by an authored page point, so the frame is a crop into the page (ADR-0056's rule applied to a screen). A capture registry under `src/lib/assets/captures/` mirrors the substrate registry so a corpus deliverable never depends on the gitignored local user-asset store; `content.captureAsset` and `content.imageUrl` are mutually exclusive. The Surface keeps its stored-image fidelity and full Pack immunity.

6. **One lit scene, from Pack Roles.** The Pack's `light-treatment` remains the only light; it now lights tilted planes and posed cards the way it lights the frontal ones. No new Role lands in phase 1.

### Phase 2 — Pipeline geometry

ADR-0051 as designed, viewed through the phase-1 camera: the geometry-contribution contract, deterministic TypeGPU procedural geometry, the bounded material and light vocabulary, the `dimensional-form` Overlay, and — added by this ADR — physical bodies contributed by existing Surfaces (a monitor bezel and glass for the filmed screen, sheet thickness for paper) as the first Surface-owned contributions. Phase 2 starts only after phase 1's deterministic verification and human approval, and it authors its own Brief then.

Of those Surface-owned bodies, the screen shipped ([ADR-0059](0059-compiled-stage-models-and-the-physical-screen.md)); sheet thickness for paper did not. It was descoped at the closeout on 2026-09-03: the newspaper is a photographed page ([ADR-0056](0056-newspaper-photographed-page.md)) and no composition asks for a thick sheet. It returns behind a consumer, through the body lane 0059 built, never ahead of one.

## Considered options

- **Build the geometry contract first (the epic as written)** — rejected: it cannot make the direction plate, it would be judged through a frontal camera, and it front-loads the largest engine change ahead of the capability every existing depth Preset benefits from.
- **A per-plane transform instead of a camera pose** — rejected for the page: tilting the Surface plane while the camera stays frontal produces the same image but breaks camera-as-data (ADR-0028), makes the aim point meaningless, and forces every Overlay to be re-posed to stay with the page. Overlays do get their own pose because a card genuinely floats at its own angle.
- **Keyframed camera channels** — rejected for v1: the shipped motion vocabulary for depth pieces is one decisive move; a rest pose plus one travel covers the documentary shot and keeps the inspector bounded. Channels can arrive later behind a consumer.
- **Cropping the page with the camera alone** — rejected: a 1440-wide capture magnified by a close camera is soft at 4K. The page must be laid at native density by the Surface; the camera adds pose and modest dolly, the way a real camera sees a real monitor.
- **A user-asset capture for the corpus deliverable** — rejected: `user-assets/` is gitignored, so a clean worktree cannot render it; the existing `website-showcase` already carries that defect and is out of scope here.

## Consequences

- Every existing depth Preset renders pixel-identical at the default pose at its first and last frames; that identity was the gate on the camera leaf. The depth-tested compositor leaves a small mid-clip residue on the four shipped stage Presets (soft plane edges, the shadow march, and the DOF gather reading the depth sidecar: mean 1.5–5 levels over defocused regions), which Scott accepted as the new baseline on 2026-09-02.
- The proving piece `website-filmed` shipped as the page alone: a lower-third floating on a posed plane was tried, read as a graphic, and was removed. Posed planes remain in the vocabulary (the oblique fixture exercises them) and the lens scales with the camera's nearness under a pose.
- `DepthStage` grows a depth attachment, a plane basis, per-plane mip chains, and N overlay planes; `CompositionPlanes` owns N overlay textures; `Composition.svelte` hoists posed Overlays into their own direct canvas children.
- The GUI projector (`createStageProjector`) becomes pose-aware and per-plane. The aim is edited as a field in the stage section; an on-canvas aim handle was built and removed, because dragging the aim re-projects the whole page under the pointer. Amended by [ADR-0060](0060-the-stage-in-the-workspace.md): grabbing the page reframes the aim at fit zoom, and the camera is orbited and dollied by hand about a fixed aim — the case the handle failed, the page moving under the pointer, does not arise.
- `website-screenshot` gains a variant and a capture registry; its Identity Spec gains a `filmed-page-crop` dimension.
- The deliverable `website-filmed` is the phase-1 acceptance evidence, rendered at native horizontal and vertical under every Pack.
- ADR-0051's status stays designed until phase 2 builds it; the ADR index and roadmap carry both phases. Phase 2 was built and closed on 2026-09-03, and both now read built.

## Amendment 2026-10-14 — a travel may visit several places

**Decision.** `stage.camera.travel` (and `stage.camera.vertical.travel`) is one move, as before, or an ordered list of up to eight moves (`STAGE_CAMERA_TRAVEL_MAX_MOVES`). Each move has the shape a single travel always had: `to`, `start`, `duration`, `ease`. Moves run in timeline order and their windows never overlap; the schema refuses a move that starts before the previous one ends. A move eases from the pose the camera holds when it starts (the rest pose, or where the previous move landed), and a field its `to` leaves out holds that pose. One move is still written as a single object, so no stored composition changes.

**Why.** The consumer this ADR waited for arrived: a filmed flowchart (`docu-flowchart-filmed`) walks the camera from step to step and then pulls back, which one move cannot film. Scott chose this on 2026-10-14 after the flowchart look was re-directed to printed cut-out cards on a dark page, shot by the Stage camera.

**Why a list of moves, not keyframed camera channels.** A move is the unit the camera already had: its own window, its own ease, a target pose. A list keeps that vocabulary, the inspector shows one block of fields per move, and the timeline's Camera row shows one clip per move. Per-field keyframes would let yaw and aim run on different clocks, which no composition has asked for.

**What follows.** `resolveStageCameraPose` walks the moves in order. The checks that sample the camera across the clip (`stageBackdropCover`, `stageSurfaceFootprint` for rule WS7, `stageDepthEncoding`) also sample every move's start, quarters, and end, so a pose held only between two moves is checked. A travel of one move samples exactly as before, so every shipped Preset renders and verifies unchanged. Dragging a move's clip on the timeline keeps it between its neighbours. `gfx_appearance_set_stage_camera` takes either form.
