import type { z } from 'zod';
import type { Component } from 'svelte';

import type {
	AnnotationFrameLayout,
	AnnotationBodyBlock,
	AnnotationBodyBlockType,
	AnnotationMarkLayout
} from '$lib/annotations/annotation-marks';
import type { AnnotationMarkStyle } from '$lib/annotations/annotation-mark-styles';
import type {
	ChartBlock,
	DiagramPrimitive,
	Effect,
	KineticWord,
	Overlay,
	OverlayPosition,
	SurfaceState,
	Transition
} from '$lib/platform/engine-schema';
import type { GpuHost } from '$lib/platform/gpu-host';
import type { PackManifest } from '$lib/platform/packs/types';
import type { StageTypefaceData } from '$lib/platform/stage-glyph-format';
import type { StageMeshData } from '$lib/platform/stage-mesh-format';
import type { StageBodyMaterial } from '$lib/platform/stage-models';
import type {
	EdgeTreatment,
	ResolvedChartMarkFill,
	ResolvedDiagramStroke
} from '$lib/platform/packs/resolve';
import type { ChartPixelRect } from '$lib/utils/chart-layout';
import type { OpticalShape } from '$lib/utils/optical-geometry';
import type { PassExecutionHints } from './pass-execution';

// ---------------- Annotations ----------------

export type AnnotationKind = 'decorative' | 'focal';

export interface AnnotationDrawContext {
	bounds: AnnotationFrameLayout;
	canvasHeight: number;
	canvasWidth: number;
	color: string;
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	durationMs: number;
	intensity: number;
	layout: AnnotationMarkLayout;
	markIndex: number;
	paperLayout: AnnotationFrameLayout;
	progress: number;
}

export interface AnnotationFocalSlot {
	dim: number;
	magnify: number;
	opticalColor?: string;
	opticalIntensity?: number;
	opticalRipple?: number;
	opticalShape?: OpticalShape;
	rect: { x: number; y: number; width: number; height: number };
	style: AnnotationMarkStyle;
	tear: number;
}

export interface AnnotationRenderer {
	appliesTo: readonly (AnnotationBodyBlockType | 'block')[];
	kind: AnnotationKind;
	style: AnnotationMarkStyle;
	draw?(ctx: AnnotationDrawContext): void;
	computeFocalSlot?(ctx: AnnotationDrawContext): AnnotationFocalSlot;
}

// ---------------- Blocks ----------------

/**
 * Canonical Block Layer union. It includes body text, diagram primitives,
 * chart items, and the first-class Kinetic Words in `surface.typeField.words`.
 * `AnnotationBody` stays paragraph-only; every placed variant keeps its own
 * authored identity and geometry.
 */
export type Block = AnnotationBodyBlock | DiagramPrimitive | ChartBlock | KineticWord;

export interface BlockRenderContext<TBlock extends Block = Block> {
	block: TBlock;
	host: GpuHost;
	timestamp: number;
}

export interface BlockRenderer<TBlock extends Block = Block> {
	type: TBlock['type'];
	schema?: z.ZodType<TBlock>;
	CanvasSource?: Component<{ block: TBlock }>;
	Editor?: Component<{ block: TBlock }>;
	Inspector?: Component<{ block: TBlock }>;
	render?(ctx: BlockRenderContext<TBlock>): void;
}

/**
 * Diagram stroke inputs (ADR-0036 §4), carried in `SurfaceRenderInputs` when
 * the surface declares a diagram. The pipelines draw edge-arrow /
 * timeline-segment into their marks canvas via `drawDiagramStrokes`;
 * `drawProgressById` is the draw-on scalar (1 for channel-owned primitives),
 * `alphaById` the visibility fade (exit sugar or authored opacity channel).
 * `stroke.color` arrives resolved — the `'ink'` sentinel is substituted with
 * the composition's resolved ink (the `typography.inkColor` override when
 * authored, else the Pack's core `ink-treatment` — ADR-0038) before render.
 */
export interface DiagramStrokeInputs {
	primitives: readonly DiagramPrimitive[];
	drawProgressById: Readonly<Record<string, number>>;
	alphaById: Readonly<Record<string, number>>;
	stroke: ResolvedDiagramStroke;
	/** The Pack's core accent colour — primitives declaring `ink: 'accent'` stroke in this. */
	accentColor: string;
}

export type ChartMarkRevealAxis = 'inline' | 'block' | 'coverage';
export type ChartMarkRevealDirection = 'forward' | 'reverse';

export interface ChartGpuMark {
	bounds: ChartPixelRect;
	cornerRadius: number;
	fillVoiceIndex: number;
	labelPlateBounds: ChartPixelRect | null;
	labelPlateProgress: number;
	revealProgress: number;
	revealAxis: ChartMarkRevealAxis;
	revealDirection: ChartMarkRevealDirection;
	emphasisProgress: number;
}

export interface ChartGpuSwatch {
	bounds: ChartPixelRect;
	cornerRadius: number;
	fillVoiceIndex: number;
}

export interface ChartRenderInputs {
	block: ChartBlock;
	marks: readonly ChartGpuMark[];
	swatches: readonly ChartGpuSwatch[];
	baseFillByVoice: readonly ResolvedChartMarkFill[];
	emphasisFillByVoice: readonly ResolvedChartMarkFill[];
	alpha: number;
}

// ---------------- Surfaces ----------------

export interface PipelineFactoryOptions {
	host: GpuHost;
	sourceElement: HTMLElement;
}

export interface SurfaceAnimState {
	markProgresses: number[];
}

export interface SurfaceRenderInputs {
	animState: SurfaceAnimState;
	backgroundVisibility?: number;
	// Whether the surface background reads as dark (light text on it), derived
	// per-frame from the surface's `paperColor` luminance. Selects the highlight
	// blend mode: dark → punch light text to ink under the amber band; light →
	// multiply (paper). When omitted the pipeline falls back to its creation-time
	// `highlightSurface` default.
	highlightDarkSurface?: boolean;
	markColorsByIndex: readonly string[];
	markDurationMsByIndex: readonly number[];
	markIntensityByIndex: readonly number[];
	textAnimAlphaByMarkIndex?: readonly number[];
	// Over-ink (strokes) alpha multiplier so a surface can fade its drawn marks
	// with its own enter/exit (the marks canvas is a separate layer the DOM
	// CSS-opacity fade never reaches). Absent → 1 (no attenuation). The checklist
	// drives it with its surface visibility so a completed item's strike fades in
	// with the item text instead of popping in after it.
	markAlpha?: number;
	timestamp: number;
	// Diagram stroke elements to draw into the marks canvas (ADR-0036); absent
	// when the surface carries no diagram.
	diagram?: DiagramStrokeInputs;
	// Active chart marks composite above the captured Surface. Mark masks punch
	// requested inside-label plates so mark-local fills cannot texture text.
	chart?: ChartRenderInputs;
}

export interface SurfaceRenderInstance {
	dispose(): void;
	getOutputTexture(): GPUTexture;
	render(inputs: SurfaceRenderInputs): void;
	uploadDom(): void;
}

/**
 * Per-frame context forwarded into every pack function. Used by
 * `EffectPassDefinition.pack` (effect-chain layer) and `ShaderPass.packUniforms`
 * (surface + overlay layer). The time values derive from the same
 * paused-timeline scrub so preview and export agree at every frame.
 *
 *   - `progress`  — 0..1 across the clip
 *   - `timestamp` — seconds elapsed
 *   - `canvasWidth` / `canvasHeight` — composition dimensions in pixels, for
 *     resolution-dependent shaders (pixel grids, px-sized kernels) and for
 *     converting pixel-space bounds to UV without hardcoding the resolution
 *     (ADR-0012 amendment)
 *   - `stageContentScale` — screen magnification of the depth stage's Surface
 *     plane at this frame (ADR-0028 camera; 1 at the framing rest pose).
 *     Supplied only on the post-stage effect chain — pre-stage passes ride
 *     their plane and never need it. Raster-structured effects multiply their
 *     screen-space pitches by it so raster-to-stroke phase holds through a
 *     camera push (G5 scanline scale-compensation); consumers default to 1.
 */
export interface EffectPackContext {
	progress: number;
	timestamp: number;
	canvasWidth: number;
	canvasHeight: number;
	stageContentScale?: number;
}

/**
 * Declarative single-pass fragment work, used by both `OverlayRenderer.shaderPass`
 * (per ADR-0005) and `SurfaceRenderer.shaderPass` (per ADR-0008).
 *
 * The pass runs once between the host's texture upload and the final composite.
 * It is intentionally limited to a single fragment pass with self-contained
 * uniforms — no cross-layer reads, no multi-pass dependencies. The first
 * consumers are `newspaper-physics` on the newspaper Surface (halftone + ink
 * bleed) and the `tear-edge` pass on collage-card overlays.
 *
 * `TContent` carries the per-target content used when packing uniforms (the
 * Overlay's `content` shape for overlays, the `SurfaceState` for surfaces).
 */
export interface ShaderPass<TContent = unknown> {
	/** TypeGPU `d.struct(...)` describing the WGSL uniform layout. */
	uniforms: unknown;
	/**
	 * True when the pass paints the composition's ENVIRONMENT (a full-frame
	 * backdrop behind the content) rather than surface-local physics. The depth
	 * stage (ADR-0028) supersedes environment passes with its real scene — a
	 * backdrop plane at depth — so the stage render path skips them; the flat
	 * path runs them unchanged.
	 */
	environment?: boolean;
	/** WGSL fragment body. Same calling convention as `EffectPassDefinition.fragmentBody`. */
	wgsl: string;
	/** Optional local-work or intermediate-quality policy. Omitted is native full-frame. */
	execution?(
		target: TContent,
		bounds: { x: number; y: number; width: number; height: number },
		ctx: EffectPackContext
	): PassExecutionHints;
	/**
	 * Packs target state into the uniform layout's record shape.
	 *
	 * `ctx` carries the timeline-driven `progress` (0..1 across the clip) and
	 * `timestamp` (seconds elapsed), forwarded from the same paused-timeline
	 * scrub the surface render reads, so preview and export agree at every
	 * frame — plus the composition's canvas dimensions. Same
	 * `EffectPackContext` shape as the effect-chain side.
	 */
	packUniforms(
		target: TContent,
		bounds: { x: number; y: number; width: number; height: number },
		ctx: EffectPackContext
	): Record<string, unknown>;
}

// What input rows the Controls panel should render for this surface.
// The panel only shows a row if the surface declares it AND the state has a
// value (or, for `body`, the surface is always-body).
export interface SurfaceControlsMetadata {
	title?: boolean;
	sourceUrl?: boolean;
	author?: boolean;
	/** Author affiliation chip (e.g. "Google Brain"), rendered beside the author. */
	affiliation?: boolean;
	source?: boolean;
	dateLabel?: boolean;
	kicker?: boolean;
	/** Small label above the body (e.g. "Abstract"). */
	bodyLabel?: boolean;
	/**
	 * Secondary text slot paired with the title by family variants (type-hero
	 * `pair` per ADR-0020). The inspector shows the row only while the active
	 * variant actually renders the slot.
	 */
	counterpoint?: boolean;
	/**
	 * Author/contact avatar image URL. Renderers opt into the shared content slot;
	 * site-selecting renderers may further limit which site consumes it.
	 */
	avatarUrl?: boolean;
	body?: 'always' | 'optional' | 'never';
	/**
	 * Surface renders a per-site mock selected by `surface.site` (ADR-0030) —
	 * the inspector shows a Site select.
	 */
	site?: boolean;
	/**
	 * Surface content is an ordered `content.messages[]` conversation
	 * (ADR-0031) — the inspector shows the Messages editor (per-bubble text /
	 * side / tapback / receipt / typing). Per-bubble timing stays on the
	 * timeline's message tracks.
	 */
	messages?: boolean;
	/**
	 * Surface content is an ordered `content.items[]` task list (ADR-0040) —
	 * the inspector shows the Checklist editor (per-item text / checked /
	 * static-vs-animated strike, add/remove). Per-item strike timing stays on
	 * checklist-item tracks produced by `createTimelineTrackId`.
	 */
	items?: boolean;
	/** Surface captures an author-entered URL into content.imageUrl. */
	websiteCapture?: boolean;
	/**
	 * Surface supports the `chrome: 'window' | 'none'` mode (ADR-0037) — the
	 * inspector shows a Window / None select bound to `surface.chrome`
	 * ('window' labels as "Card" for the checklist Surface).
	 */
	chrome?: boolean;
	typography?: boolean;
	paperColor?: boolean;
	inkColor?: boolean;
	backgroundVisibility?: boolean;
	enterExit?: boolean;
}

export interface SurfaceRenderer {
	type: string;
	label: string;
	controls: SurfaceControlsMetadata;
	/**
	 * Variant ids for Surface families using the variants-as-data convention
	 * (ADR-0020) — data only, never components. When declared, the inspector
	 * renders a Variant select bound to `surface.variant`; the first id is the
	 * family's effective value when `variant` is absent. Omitted by
	 * single-shape Surfaces.
	 */
	variantIds?: readonly string[];
	CanvasSource: Component<{ element?: HTMLElement | null }>;
	createPipeline(opts: PipelineFactoryOptions): SurfaceRenderInstance;
	defaults(): SurfaceState;
	/**
	 * Optional single-pass fragment work run between DOM upload and final composite
	 * (ADR-0008, invocation wired per ADR-0010). The first consumer is
	 * `newspaper-physics` on the `newspaper` Surface (halftone dot screen + ink
	 * bleed at glyph edges); `Workspace` feeds declared surface passes to the
	 * ShaderPassDispatcher ahead of the effect chain.
	 */
	shaderPass?: ShaderPass<SurfaceState>;
	/**
	 * When true, this surface renders an alpha-silhouetted card/clipping whose
	 * outer edge accepts the active Pack's structural edge Role
	 * (`<type>.edge` → core `edge-treatment`, ADR-0024). `Workspace` resolves
	 * the Role via `resolveEdgeTreatment` and, for any value other than
	 * `none`, dispatches the shared edge-treatment ShaderPass ahead of the
	 * surface's own `shaderPass`. Full-frame surfaces and surfaces whose alpha
	 * boundaries are glyphs (not a card silhouette) must not opt in.
	 */
	edgeTreatment?: boolean;
	/**
	 * The edge treatment this surface applies when its `edge` slot is NOT
	 * Pack-claimable (partial substrate immunity, ADR-0039 §2 — the cut
	 * character is document physics). Consulted by
	 * `prepareFramePackTreatments` in place of `resolveEdgeTreatment` when
	 * `isAppearanceSlotPackClaimable(key, 'edge')` is false; ignored for
	 * surfaces whose edge stays a Pack claim.
	 */
	intrinsicEdgeTreatment?: EdgeTreatment;
	/**
	 * The document-body colours this surface intrinsically prints when its
	 * `fill` / `ink` slots are NOT Pack-claimable (substrate immunity,
	 * ADR-0039 §2). Consumed by `resolveSurfaceTypographyColors` as the
	 * fallback for unauthored typography (an authored colour still wins,
	 * ADR-0038). Deliberately NOT the depth rig's `'fg'` foreground — depth is
	 * claimable chrome, so its sentinel resolves the Pack's ink voice.
	 */
	substrateColors?: { paperHex: string; inkHex: string };
	/**
	 * The CanvasSource renders `content.title` through the bracket-tag mark
	 * parser as `data-annotation-mark` spans (a headline highlighter). The
	 * title's marks enumerate before the body's — see
	 * `listSurfaceMarkInstances`. Only meaningful on Surfaces whose runtime is
	 * the paper compositor, which is where marks are drawn.
	 */
	titleMarks?: boolean;
	/**
	 * Decline the active Pack's composition-wide material pass. Reserved for
	 * immutable captured substrates whose stored pixels must survive a Pack
	 * switch; intrinsic Surface shader passes still run.
	 */
	disablePackMaterial?: boolean;
}

// ---------------- Overlays ----------------

export interface OverlayRenderContext<TContent = unknown> {
	bounds: AnnotationFrameLayout;
	content: TContent;
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	progress: number;
}

export interface OverlayDefaults<TContent = unknown> {
	content: TContent;
	position: OverlayPosition;
	enter?: Transition;
	exit?: Transition;
}

export interface OverlayEditorProps<TContent = unknown> {
	overlay: Overlay & { content: TContent };
}

export interface OverlayCanvasSourceProps<TContent = unknown> {
	content: TContent;
}

export type DeterministicReadableTextRole =
	| 'overlay-display'
	| 'overlay-primary'
	| 'overlay-secondary'
	| 'overlay-corner-primary'
	| 'overlay-corner-secondary'
	| 'overlay-cinematic-primary'
	| 'overlay-cinematic-secondary'
	| 'overlay-source-citation'
	| 'surface-display'
	| 'surface-title'
	| 'surface-body'
	| 'surface-body-focal'
	| 'surface-label'
	| 'found-document-body'
	| 'found-document-title'
	| 'found-document-metadata'
	| 'diagram-headline'
	| 'diagram-caption'
	| 'diagram-stat-value'
	| 'caption-social';

export interface RendererReadableTextContract {
	id: string;
	text: string;
	role: DeterministicReadableTextRole;
}

/** Typed reasons a visible text node is intentionally outside readability probes. */
export const DETERMINISTIC_NON_READABLE_TEXT_REASONS = [
	'decorative-symbol',
	'duplicate-semantic-label',
	'rasterized-artifact-text'
] as const;

export type DeterministicNonReadableTextReason =
	(typeof DETERMINISTIC_NON_READABLE_TEXT_REASONS)[number];

export interface RendererReadableTextContext {
	progress: number;
	durationMilliseconds: number;
}

export interface OverlayRenderer<TContent = unknown> {
	type: string;
	label: string;
	schema: z.ZodType<TContent>;
	defaults(): OverlayDefaults<TContent>;
	CanvasSource: Component<OverlayCanvasSourceProps<TContent>>;
	Editor: Component<OverlayEditorProps<TContent>>;
	Inspector?: Component<OverlayEditorProps<TContent>>;
	/**
	 * Typed content-to-readable identity authority for deterministic probes.
	 * Omit only when the renderer cannot yet declare complete readable output;
	 * the runtime then reports coverage unavailable rather than inferring DOM.
	 */
	readableText?: (
		content: TContent,
		context: RendererReadableTextContext
	) => readonly RendererReadableTextContract[];
	/**
	 * This plate-less Overlay's ink sits directly on `backgroundFill`. When a
	 * composition declares that field, OverlayMount pairs its `--ink` with the
	 * Pack's field rather than using the footage-oriented Pipeline ink.
	 */
	fieldInkOnBackground?: boolean;
	/**
	 * When true, OverlayMount skips the default 32px translateY entry droop.
	 * Set for overlay types whose CanvasSource manages its own per-element
	 * motion (e.g. staggered opacity-only variants) where a container-level
	 * positional offset conflicts with the intended animation.
	 */
	disableEntryOffset?: boolean;
	/**
	 * Keep the mount fully opaque while the CanvasSource performs positional
	 * enter/exit motion. This avoids CSS-opacity layer promotion in the
	 * HTML-in-Canvas capture path.
	 */
	disableOpacityTransition?: boolean;
	/**
	 * Cross the frame's right edge over the authored enter/exit windows instead
	 * of using the generic short vertical offset. The transition progress still
	 * comes from the shared deterministic animation manifest.
	 */
	edgeTransition?: 'right';
	// Optional pixel-level renderer; the unified render path captures DOM via
	// HTML-in-canvas through the overlay's CanvasSource, so this is reserved
	// for offscreen / worker compositing paths and is not currently invoked.
	render?(ctx: OverlayRenderContext<TContent>): void;
	/**
	 * Optional single-pass fragment work run between this overlay's DOM upload and
	 * the final overlay composite (ADR-0005). Used for torn-edge / fiber / hard
	 * offset shadow chrome on collage-card overlays that can't be expressed in DOM.
	 */
	shaderPass?: ShaderPass<TContent>;
	/**
	 * The Overlay's body on the depth Stage (ADR-0062): declared renderer-free
	 * by the definition's `stageBody`, computed here. The platform loads the
	 * typeface the renderer names for the Pack, then asks for the body each
	 * frame; the mesh is cached by the key the renderer returns.
	 */
	stageBody?: OverlayStageBodyRenderer<TContent>;
	/** Declared on the definition; carried through so the renderer agrees. */
	stageBodyDeclared?: true;
}

/** What a body Overlay hands the Stage each frame (ADR-0062). */
export interface OverlayStageBodyContribution {
	/** Names the mesh in the resident pool: changes whenever the mesh does, holds still while it does not. */
	key: string;
	mesh: StageMeshData;
	materials: readonly StageBodyMaterial[];
	/** One body unit (a cap height, for type) as a fraction of the frame height. */
	/** One body unit (a cap height, for type) as a fraction of the frame's SHORT side, so a headline reflows into the tall frame. */
	unitFraction: number;
	/** Where the body's origin sits relative to its pivot, in body units along the plane's v axis. */
	baselineOffset: number;
	/** Body units along the plane normal, toward the eye, this frame. */
	lift: number;
	/** Degrees the body tips back about its horizontal axis this frame. */
	lean: number;
	/** 0..1 this frame. */
	presence: number;
	pullsFocus: boolean;
}

export interface OverlayStageBodyInput<TContent> {
	content: TContent;
	pack: PackManifest;
	typeface: StageTypefaceData;
	/** The Overlay's enter/exit progress this frame: 0 absent, 1 landed. */
	progress: number;
}

export interface OverlayStageBodyRenderer<TContent> {
	contribute(input: OverlayStageBodyInput<TContent>): OverlayStageBodyContribution;
}

// ---------------- Effects ----------------

export interface EffectEditorProps<TParams = unknown> {
	effect: Effect & { params: TParams };
}

// Each effect contributes a self-contained WGSL fragment body that operates on
// a sampled input. The effect-chain executor wraps this body in a full-screen
// pass with three bind-group slots: input texture, sampler, and a `uniforms`
// struct whose layout the effect declares via `paramsStruct`.
//
// The fragment body has access to:
//   - `in.uv: vec2f`              — full-screen UV
//   - `inputSample: vec4f`         — `textureSample(layout.$.inputTexture, layout.$.samp, in.uv)`
//   - `layout.$.uniforms`          — the effect's `paramsStruct` instance
//
// The body must `return vec4f(...);` with the post-effect color.
//
// Effects must preserve alpha for transparent-overlay output (rubric E4):
// don't color-grade the alpha channel.
//
// `pack(params, ctx)` is called once per frame. The `ctx` carries the
// timeline-driven `progress` (0..1 across the clip) and `timestamp` (seconds
// elapsed). Both derive from the same paused-timeline scrub, so preview and
// export produce identical pixels at the same time (frame-determinism
// contract). Time-driven shaders write `ctx.progress` or `ctx.timestamp` into
// a uniform field declared in `paramsStruct`. See `EffectPackContext` above
// for the shared shape with `ShaderPass.packUniforms`.
export interface EffectPassDefinition<TParams> {
	paramsStruct: unknown; // TgpuStruct describing the WGSL uniform layout
	fragmentBody: string;
	/** Optional local-work or intermediate-quality policy. Omitted is native full-frame. */
	execution?(params: TParams, ctx: EffectPackContext): PassExecutionHints;
	pack(params: TParams, ctx: EffectPackContext): Record<string, unknown>;
}

export interface EffectRenderer<TParams = unknown> {
	type: string;
	label: string;
	schema: z.ZodType<{ type: string; id: string; params: TParams }>;
	defaults(): { params: TParams };
	pass: EffectPassDefinition<TParams>;
	Editor?: Component<EffectEditorProps<TParams>>;
	Inspector?: Component<EffectEditorProps<TParams>>;
	/**
	 * True when the active Pack declines this effect CATEGORICALLY (e.g. a
	 * non-paper Pack claiming `paper-grain.strength: 'none'`). The inspector
	 * then tags the authored row `pack · off` and withholds the param editors
	 * — controls that visibly do nothing read as bugs. The authored entry
	 * itself stays listed: it is composition state, travels with a pack
	 * flip, and must remain discoverable / removable. Must key off a
	 * categorical claim ('none'), never a threshold on a numeric dial — a
	 * draggable value hitting the threshold would delete its own editors.
	 */
	isPackInert?(pack: PackManifest): boolean;
}

// ---------------- Transition Effects ----------------

export interface TransitionEffectPackContext {
	progress: number;
	timestamp: number;
	canvasWidth: number;
	canvasHeight: number;
}

export interface TransitionEffectEditorProps<TParams = unknown> {
	params: TParams;
	onchange(): void;
}

/**
 * Declarative two-snapshot transition work. The compiler supplies
 * `fromSample`, `toSample`, `in.uv`, and `layout.$.uniforms`; renderers own only
 * the transition-specific mask/deformation math. Progress-zero and progress-one
 * endpoint identity is enforced by the shared compiler.
 */
export interface TransitionEffectPassDefinition<TParams> {
	paramsStruct: unknown;
	fragmentBody: string;
	pack(params: TParams, ctx: TransitionEffectPackContext): Record<string, unknown>;
}

export interface TransitionEffectRenderer<TParams = unknown> {
	type: string;
	label: string;
	paramsSchema: z.ZodType<TParams>;
	defaults(): { params: TParams };
	pass: TransitionEffectPassDefinition<TParams>;
	Editor?: Component<TransitionEffectEditorProps<TParams>>;
}
