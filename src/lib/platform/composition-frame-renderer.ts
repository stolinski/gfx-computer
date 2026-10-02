import { crtScanlinePass } from '$lib/pipelines/shader-passes/crt-scanline';
import {
	edgeTreatmentPass,
	type EdgeTreatmentTarget
} from '$lib/pipelines/shader-passes/edge-treatment';
import { cssColorToRgbaFloat, hexToRgbaFloat } from '$lib/utils/color';
import { clampNumber } from '$lib/utils/math';
import { measureOverlayBoundsPx } from '$lib/utils/overlay-bounds';
import type { Effect, EngineState, Overlay, StageCamera } from './engine-schema';
import type { GpuHost } from './gpu-host';
import { hasCapturedPaintRecord } from './html-in-canvas';
import type { PackManifest } from './packs/types';
import {
	resolveBackgroundFill,
	resolvePackRoleColor,
	resolveDepthTreatment,
	resolveEdgeTreatment,
	resolveLightTreatment,
	resolveMaterialTreatment,
	type LightTreatment,
	type ResolvedMaterialTreatment
} from './packs/resolve';
import { getEffectDefinition, getSurfaceDefinition } from './pipelines/definition-registry';
import {
	readEffectOrientationSnapshot,
	resolveEffectParamsWithChannelValues
} from './effect-keyframe-channels';
import type { OverlayChannelValues } from './anim-state.svelte';
import { resolveOverlayStageBodies } from './stage-body-overlays';
import type { StageTypefaceData } from './stage-glyph-format';
import type { StageMeshData } from './stage-mesh-format';
import { getStageModel } from './stage-models';
import {
	requireLoadedOverlayRenderer,
	requireLoadedSurfaceRenderer
} from './pipelines/runtime-loader';
import { isAppearanceSlotPackClaimable } from './pipelines/identity-registry';
import { CompositionPlanes, type CompositeBackdrop } from './pipelines/composition-planes';
import {
	DepthStage,
	type DepthStageBody,
	type DepthStagePosedOverlayPlane
} from './pipelines/depth-stage';
import { partitionStageOverlays } from './pipelines/depth-stage-planes';
import {
	STAGE_CAM_Z,
	createStageCameraRig,
	resolveStageCameraForOrientation
} from './pipelines/depth-stage-camera';
import { EffectChain } from './pipelines/effect-chain';
import { ShaderPassDispatcher, type ShaderPassDispatchList } from './pipelines/shader-pass-runner';
import type { CompiledTransitionEffect } from './pipelines/transition-pass';
import type { TransitionSnapshotFrameTextures } from './pipelines/transition-snapshots';
import type { ShaderPass, SurfaceRenderInputs, SurfaceRenderInstance } from './pipelines/types';
import type { PreparedVideoUnderlayTexture } from './video-underlay-frame-texture';

const SELF_FADING_SURFACE_TYPES = new Set(['chapter-card', 'title-sequence', 'pullquote-on-photo']);

// The ADR-0021 Overlay-Layer default depth. On the depth stage it is the shared
// Overlay plane's depth; an Overlay with an explicit z rides its own plane.
const SHARED_OVERLAY_PLANE_Z = 0.7;

const NO_BACKDROP: CompositeBackdrop = {
	strength: 0,
	edgeBlur: 0,
	vignette: 0,
	speckle: 0,
	color: [0, 0, 0],
	grain: 0
};

interface CompositionFrameTimebase {
	progress: number;
	timestamp: number;
}

interface ResolvedDofFrame {
	focusZ: number;
	aperture: number;
	surfaceZ: number;
	overlayZ: number;
	backdrop: CompositeBackdrop;
	otherEffects: readonly Effect[];
}

interface ResolvedStageFrame {
	focusZ: number;
	aperture: number;
	focusBand: number;
	backdropColor: [number, number, number];
	backdropAsset: string | null;
	backdropContrast: number;
	camera: StageCamera;
	/** Overlays on the shared plane at the Layer default depth. */
	sharedOverlayCount: number;
	/** Overlays riding their own posed plane (ADR-0057), in Layer order. */
	posedOverlays: readonly Overlay[];
	/** Overlays the stage draws as bodies (ADR-0062); none captures them. */
	bodyOverlayCount: number;
	overlayZ: number;
	/** The registered model whose glass the Surface plane is (ADR-0051 phase 2). */
	screenModel: string | null;
	light: LightTreatment | null;
	effects: readonly Effect[];
}

interface PreparedFramePackTreatments {
	edgeTarget: EdgeTreatmentTarget | null;
	material: ResolvedMaterialTreatment | null;
	light: LightTreatment | null;
	chromeEffects: readonly Effect[];
	/** The declared backgroundFill as premultiplied-ready rgba floats — the
	 * 'pack' sentinel already resolved through the Pack's `field-treatment`
	 * (ADR-0039 §3). undefined = transparent lane. */
	background: [number, number, number, number] | undefined;
}

export interface CompositionFrameRenderResources {
	host: GpuHost | null;
	pipeline: SurfaceRenderInstance | null;
	effectChain: EffectChain | null;
	shaderPassDispatcher: ShaderPassDispatcher | null;
	compositionPlanes: CompositionPlanes | null;
	depthStage: DepthStage | null;
}

export interface CachedTransitionFrame {
	snapshots: TransitionSnapshotFrameTextures;
	effect: CompiledTransitionEffect;
	params: unknown;
	durationMs: number;
	width: number;
	height: number;
}

export interface CompositionDomCaptureGenerations {
	surface: number;
	overlay: number;
	/** Paint generations of each posed Overlay's own root, by Overlay id (ADR-0057). */
	posedOverlays?: Readonly<Record<string, number>>;
	force: boolean;
}

/** A posed Overlay's own capture root: a frame-sized direct canvas child (ADR-0057). */
export interface CompositionPosedOverlayRoot {
	overlayId: string;
	element: HTMLElement;
}

export type CompositionReadableProbeMode = 'normal' | 'readable-mask';

export interface CompositionFrameRenderRequest {
	outputView: GPUTextureView;
	timestamp: number;
	state: EngineState;
	pack: PackManifest;
	paperVisibility: number;
	compositionElement: HTMLElement | null;
	overlayRootElement: HTMLElement | null;
	/** The posed Overlays' own roots while the stage splits them out; absent = none mounted. */
	posedOverlayRoots?: readonly CompositionPosedOverlayRoot[];
	substrateTexture: GPUTexture | null;
	/** The decoded mesh of the stage's screen model, once its bytes are ready (ADR-0051 phase 2). */
	stageModelMesh?: StageMeshData | null;
	/** The decoded typefaces the stage's body Overlays set in, by slug; null until ready (ADR-0062). */
	stageTypeface?: (slug: string) => StageTypefaceData | null;
	/** Composition-owned motion per Overlay index (ADR-0035), read by body Overlays for their place and presence. */
	overlayChannels?: readonly (OverlayChannelValues | null)[];
	/** Each Overlay's own enter/exit progress, the body's presence when no channel drives it. */
	overlayProgresses?: readonly number[];
	/**
	 * Live keyframed Effect params by Effect id, then channel path (ADR-0063 §5),
	 * as the animation manifest left them at this frame. The renderer substitutes
	 * them into the authored Effects and never samples a track itself.
	 */
	effectChannels?: Readonly<Record<string, Readonly<Record<string, number>>>>;
	videoUnderlayTexture: PreparedVideoUnderlayTexture | null;
	readableProbeMode?: CompositionReadableProbeMode;
	domCapture?: CompositionDomCaptureGenerations;
	resources: CompositionFrameRenderResources;
	cachedTransition: CachedTransitionFrame | null;
	buildSurfaceInputs(timestamp: number): SurfaceRenderInputs;
}

const uploadedSurfaceGenerations = new WeakMap<SurfaceRenderInstance, number>();
const uploadedOverlayGenerations = new WeakMap<CompositionPlanes, number>();
const uploadedPosedOverlayGenerations = new WeakMap<CompositionPlanes, Map<string, number>>();

// `force` overrides the generation-equality short-circuit — it does not override
// the paint-record precondition. An element the browser has never painted has
// nothing to copy in either lane, so the frame keeps whatever texture is
// already resident and the paint that will report that element re-enters here
// with a real generation. Without this check a fresh mount, or a hot-module
// replacement that swapped the composition node, uploaded a generation-0
// element and threw `InvalidStateError: No cached paint record for element`
// out of the paint handler (Sentry issue 7631939454). The tracker seeds a
// child it has never seen on the first paint event delivered while it exists
// (`CanvasPaintGenerationTracker.record`), so a Surface whose DOM never
// changes — the newspaper page — is not skipped here forever.
function captureSurfaceDom(request: CompositionFrameRenderRequest): void {
	const pipeline = request.resources.pipeline;
	if (!pipeline) return;
	const capture = request.domCapture;
	if (!capture) {
		pipeline.uploadDom();
		return;
	}
	if (!hasCapturedPaintRecord(capture.surface)) return;
	if (capture.force || uploadedSurfaceGenerations.get(pipeline) !== capture.surface) {
		if (!uploadDomIfPainted(() => pipeline.uploadDom())) return;
		uploadedSurfaceGenerations.set(pipeline, capture.surface);
	}
}

function captureOverlayDom(
	request: CompositionFrameRenderRequest,
	planes: CompositionPlanes,
	element: HTMLElement
): void {
	const capture = request.domCapture;
	if (!capture) {
		planes.captureOverlay(element);
		return;
	}
	if (!hasCapturedPaintRecord(capture.overlay)) return;
	if (capture.force || uploadedOverlayGenerations.get(planes) !== capture.overlay) {
		if (!uploadDomIfPainted(() => planes.captureOverlay(element))) return;
		uploadedOverlayGenerations.set(planes, capture.overlay);
	}
}

// The same generation gate as the shared Overlay root, per posed Overlay root.
function capturePosedOverlayDom(
	request: CompositionFrameRenderRequest,
	planes: CompositionPlanes,
	overlayId: string,
	element: HTMLElement
): void {
	const capture = request.domCapture;
	if (!capture) {
		planes.capturePosedOverlay(overlayId, element);
		return;
	}
	const generation = capture.posedOverlays?.[overlayId];
	if (generation === undefined || !hasCapturedPaintRecord(generation)) return;
	let uploaded = uploadedPosedOverlayGenerations.get(planes);
	if (!uploaded) {
		uploaded = new Map();
		uploadedPosedOverlayGenerations.set(planes, uploaded);
	}
	if (capture.force || uploaded.get(overlayId) !== generation) {
		if (!uploadDomIfPainted(() => planes.capturePosedOverlay(overlayId, element))) return;
		uploaded.set(overlayId, generation);
	}
}

/**
 * Runs a DOM upload, tolerating the one window the paint-generation tracker
 * cannot see: a direct canvas child inserted between the browser's paint and
 * the paint event that seeded its generation has no paint record yet, and the
 * WICG lane throws `InvalidStateError` for it. The frame keeps whatever texture
 * is resident (the same outcome as the never-painted skip above), the upload is
 * not recorded as done, and the next paint — which reports that child — retries
 * it with a real generation. Anything else thrown is a real failure.
 */
function uploadDomIfPainted(upload: () => void): boolean {
	try {
		upload();
		return true;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'InvalidStateError') return false;
		throw error;
	}
}

export type CompositionFrameRenderBranch = 'transition' | 'stage' | 'dof' | 'flat';
export type CompositionFrameRenderResult = CompositionFrameRenderBranch | 'unavailable';

/** A non-self-fading surface with an authored opacity channel needs a separate
 * Surface plane so its alpha can be multiplied on the GPU. */
export function hasCompositionOwnedSurfaceOpacity(state: EngineState): boolean {
	return (
		Boolean(state.surface.animation?.channels?.opacity?.length) &&
		!SELF_FADING_SURFACE_TYPES.has(state.surface.type)
	);
}

/** Whether Composition must hoist the Overlay layer into a separately-capturable
 * direct child for DOF, GPU surface opacity, or overlay-at-depth. */
export function shouldSplitCompositionPlanes(state: EngineState): boolean {
	const hasDof = state.effects.some((effect) => effect.type === 'depth-of-field');
	const hasStageOverlay = state.stage?.type === 'depth' && state.overlays.length > 0;
	return hasDof || hasCompositionOwnedSurfaceOpacity(state) || hasStageOverlay;
}

/** Ordered branch policy for one frame. Stage has first live precedence, then
 * multiplane DOF, then flat. A prepared transition excludes every live branch. */
export function resolveCompositionFrameBranchOrder(
	state: EngineState,
	hasCachedTransition: boolean
): readonly CompositionFrameRenderBranch[] {
	if (hasCachedTransition) {
		return ['transition'];
	}
	const branches: CompositionFrameRenderBranch[] = [];
	if (state.stage?.type === 'depth') {
		branches.push('stage');
	}
	if (
		state.effects.some((effect) => effect.type === 'depth-of-field') ||
		hasCompositionOwnedSurfaceOpacity(state)
	) {
		branches.push('dof');
	}
	branches.push('flat');
	return branches;
}

function frameTimebase(state: EngineState, timestamp: number): CompositionFrameTimebase {
	const duration = state.transport.durationSeconds;
	return {
		progress: duration > 0 ? clampNumber(timestamp / duration, 0, 1) : 0,
		timestamp
	};
}

function prepareFramePackTreatments(
	state: EngineState,
	pack: PackManifest
): PreparedFramePackTreatments {
	const surfaceDefinition = getSurfaceDefinition(state.surface.type);
	let edgeTarget: EdgeTreatmentTarget | null = null;
	if (surfaceDefinition?.edgeTreatment) {
		// Partial substrate immunity (ADR-0039 §2): a surface whose `edge` slot
		// is immune cuts with its own intrinsic treatment (the newspaper's tear
		// is document physics); a claimable edge stays the Pack's. Same split
		// for the shadow's foreground ink below.
		const surfaceKey = `surface:${state.surface.type}`;
		const treatment = isAppearanceSlotPackClaimable(surfaceKey, 'edge')
			? resolveEdgeTreatment(pack, state.surface.type)
			: (surfaceDefinition.intrinsicEdgeTreatment ?? null);
		if (treatment && treatment.mode !== 'none') {
			let shadow: EdgeTreatmentTarget['shadow'] = null;
			if (treatment.mode === 'torn' || treatment.mode === 'irregular') {
				// The depth rig is CLAIMABLE chrome even on a substrate-immune
				// document (ADR-0039 §2), so its `'fg'` sentinel resolves the
				// PACK's ink voice — `<type>.ink` → core ink-treatment — never the
				// immune document ink (identical hexes under syntax; phosphor, not
				// newsprint, under crt-terminal's glow).
				const inkHex = resolvePackRoleColor(pack, `${state.surface.type}.ink`, 'ink-treatment');
				const rig = resolveDepthTreatment(pack, state.surface.type, inkHex);
				if (rig !== null) {
					let rgba: [number, number, number, number];
					try {
						rgba = cssColorToRgbaFloat(rig.color);
					} catch {
						rgba = [0, 0, 0, 1];
					}
					const rgb: [number, number, number] = [rgba[0], rgba[1], rgba[2]];
					shadow =
						rig.kind === 'hardOffset'
							? { kind: 'offset', dx: rig.dx, dy: rig.dy, rgb, strength: rgba[3] }
							: { kind: 'glow', radiusPx: rig.radius, intensity: rig.intensity, rgb };
				}
			}
			edgeTarget = {
				treatment,
				seedSource: state.surface.content.title ?? state.surface.type,
				shadow
			};
		}
	}

	const material = surfaceDefinition?.disablePackMaterial ? null : resolveMaterialTreatment(pack);
	const role = state.backgroundFill ? pack.roles['chrome'] : undefined;
	const chromeEffects: Effect[] =
		role?.kind === 'chrome'
			? role.effects.map((entry, index) => ({
					type: entry.type,
					id: `pack-chrome-${index}`,
					params: entry.params ?? {}
				}))
			: [];

	const resolvedFill = resolveBackgroundFill(pack, state.backgroundFill);

	return {
		edgeTarget,
		material,
		light: resolveLightTreatment(pack),
		chromeEffects,
		background: resolvedFill !== undefined ? hexToRgbaFloat(resolvedFill) : undefined
	};
}

/**
 * The authored Effects with this frame's channel values substituted into their
 * params (ADR-0063 §5). Runs before Pack chrome is appended, so a Pack's chrome
 * entries are never touched; an Effect without live values keeps its exact
 * entry, and the state is returned unchanged when nothing is driven.
 */
export function resolveFrameEffectChannelState(
	state: EngineState,
	effectChannels: CompositionFrameRenderRequest['effectChannels']
): EngineState {
	const orientation = state.transport.orientation;
	let changed = false;
	const effects = state.effects.map((effect) => {
		const values = effectChannels?.[effect.id];
		const definition = getEffectDefinition(effect.type);
		if (!definition) return effect;
		// An orientation snapshot (ADR-0039 §4) resolves even when nothing is keyframed.
		const snapshot = readEffectOrientationSnapshot(effect.params, definition, orientation);
		if (!values && !snapshot) return effect;
		changed = true;
		return {
			...effect,
			params: resolveEffectParamsWithChannelValues(effect, definition, values ?? {}, orientation)
		};
	});
	return changed ? { ...state, effects } : state;
}

function appendPackChrome(
	effects: readonly Effect[],
	chromeEffects: readonly Effect[]
): readonly Effect[] {
	if (chromeEffects.length === 0) {
		return effects;
	}
	const authoredTypes = new Set(effects.map((effect) => effect.type));
	return [...effects, ...chromeEffects.filter((effect) => !authoredTypes.has(effect.type))];
}

function buildShaderPassDispatchList(
	request: CompositionFrameRenderRequest,
	treatments: PreparedFramePackTreatments,
	scope: 'flat' | 'stage'
): ShaderPassDispatchList {
	const { state, compositionElement } = request;
	const { host } = request.resources;
	const compositionSize = {
		width: host?.canvas.width ?? 0,
		height: host?.canvas.height ?? 0
	};
	const bounds = { x: 0, y: 0, width: compositionSize.width, height: compositionSize.height };
	const entries: Array<{
		pass: ShaderPass<unknown>;
		target: unknown;
		bounds: typeof bounds;
	}> = [];
	const surfaceRenderer = requireLoadedSurfaceRenderer(state.surface.type);

	// Pack edge treatment runs before the Surface's own physics so those physics
	// operate on the treated silhouette.
	if (treatments.edgeTarget) {
		entries.push({
			pass: edgeTreatmentPass as ShaderPass<unknown>,
			target: treatments.edgeTarget,
			bounds
		});
	}

	const surfaceShaderPass = surfaceRenderer?.shaderPass as ShaderPass<unknown> | undefined;
	if (
		surfaceShaderPass &&
		!(scope === 'stage' && surfaceShaderPass.environment) &&
		!(request.readableProbeMode === 'readable-mask' && surfaceShaderPass.environment)
	) {
		entries.push({
			pass: surfaceShaderPass,
			target: state.surface,
			bounds
		});
	}

	if (scope === 'flat') {
		for (const overlay of state.overlays) {
			const renderer = requireLoadedOverlayRenderer(overlay.type);
			if (!renderer.shaderPass) {
				continue;
			}
			entries.push({
				pass: renderer.shaderPass as ShaderPass<unknown>,
				target: overlay.content,
				bounds: measureOverlayBoundsPx(
					overlay,
					compositionElement,
					compositionSize,
					state.transport.orientation
				)
			});
		}
	}

	// Material is last: in flat mode it treats the merged element pixels once;
	// on stage it stays attached to the Surface plane before staging.
	if (treatments.material) {
		entries.push({
			pass: crtScanlinePass as ShaderPass<unknown>,
			target: treatments.material,
			bounds
		});
	}

	return entries;
}

function resolveDofFrame(state: EngineState, progress: number): ResolvedDofFrame | null {
	const dofEffect = state.effects.find((effect) => effect.type === 'depth-of-field');
	if (!dofEffect) {
		if (hasCompositionOwnedSurfaceOpacity(state)) {
			return {
				focusZ: 0,
				aperture: 0,
				surfaceZ: 0,
				overlayZ: clampNumber(state.overlays[0]?.z ?? SHARED_OVERLAY_PLANE_Z, -1, 1),
				backdrop: NO_BACKDROP,
				otherEffects: state.effects
			};
		}
		return null;
	}

	const raw = (dofEffect.params ?? {}) as {
		focusZ?: unknown;
		aperture?: unknown;
		focusPull?: { from?: unknown; to?: unknown; start?: unknown; duration?: unknown };
		backdrop?: {
			strength?: unknown;
			edgeBlur?: unknown;
			vignette?: unknown;
			speckle?: unknown;
			color?: unknown;
			grain?: unknown;
		};
	};
	const aperture = Math.max(0, typeof raw.aperture === 'number' ? raw.aperture : 0);
	let focusZ = clampNumber(typeof raw.focusZ === 'number' ? raw.focusZ : 0, 0, 1);
	const pull = raw.focusPull;
	if (pull && typeof pull.from === 'number' && typeof pull.to === 'number') {
		const start = typeof pull.start === 'number' ? pull.start : 0;
		const duration = typeof pull.duration === 'number' && pull.duration > 0 ? pull.duration : 1;
		const local = clampNumber((progress - start) / duration, 0, 1);
		const eased = local * local * (3 - 2 * local);
		focusZ = clampNumber(pull.from + (pull.to - pull.from) * eased, 0, 1);
	}

	let backdrop = NO_BACKDROP;
	const rawBackdrop = raw.backdrop;
	if (rawBackdrop && typeof rawBackdrop.strength === 'number' && rawBackdrop.strength > 0) {
		const rgb =
			typeof rawBackdrop.color === 'string'
				? hexToRgbaFloat(rawBackdrop.color)
				: [0.06, 0.06, 0.08, 1];
		backdrop = {
			strength: clampNumber(rawBackdrop.strength, 0, 1),
			edgeBlur: clampNumber(
				typeof rawBackdrop.edgeBlur === 'number' ? rawBackdrop.edgeBlur : 1,
				0,
				1
			),
			vignette: clampNumber(
				typeof rawBackdrop.vignette === 'number' ? rawBackdrop.vignette : 0.5,
				0,
				1
			),
			speckle: clampNumber(
				typeof rawBackdrop.speckle === 'number' ? rawBackdrop.speckle : 0.5,
				0,
				1
			),
			color: [rgb[0], rgb[1], rgb[2]],
			grain: Math.max(0, typeof rawBackdrop.grain === 'number' ? rawBackdrop.grain : 0.02)
		};
	}

	return {
		focusZ,
		aperture,
		surfaceZ: 0,
		overlayZ: clampNumber(state.overlays[0]?.z ?? SHARED_OVERLAY_PLANE_Z, -1, 1),
		backdrop,
		otherEffects: state.effects.filter((effect) => effect.type !== 'depth-of-field')
	};
}

function resolveStageFrame(
	state: EngineState,
	progress: number,
	treatments: PreparedFramePackTreatments
): ResolvedStageFrame | null {
	const stage = state.stage;
	if (!stage || stage.type !== 'depth') {
		return null;
	}
	let focusZ = clampNumber(stage.focus.focusZ, 0, 1);
	const pull = stage.focus.pull;
	if (pull) {
		const duration = pull.duration > 0 ? pull.duration : 1;
		const local = clampNumber((progress - pull.start) / duration, 0, 1);
		const eased = local * local * (3 - 2 * local);
		focusZ = clampNumber(pull.from + (pull.to - pull.from) * eased, 0, 1);
	}
	const background = treatments.background;
	const { shared, posed, bodies } = partitionStageOverlays(state.overlays);
	return {
		focusZ,
		aperture: clampNumber(stage.focus.aperture, 0, 1),
		focusBand: clampNumber(stage.focus.band, 0, 1),
		backdropColor: background ? [background[0], background[1], background[2]] : [0.1, 0.09, 0.08],
		backdropAsset: stage.backdrop?.image?.asset ?? null,
		backdropContrast: clampNumber(stage.backdrop?.contrast ?? 0, 0, 1),
		camera: resolveStageCameraForOrientation(stage.camera, state.transport.orientation),
		sharedOverlayCount: shared.length,
		posedOverlays: posed,
		bodyOverlayCount: bodies.length,
		overlayZ: SHARED_OVERLAY_PLANE_Z,
		screenModel: stage.screen?.model ?? null,
		light: treatments.light,
		effects: state.effects
	};
}

function surfaceFadeAlpha(state: EngineState, paperVisibility: number): number {
	return hasCompositionOwnedSurfaceOpacity(state) ? clampNumber(paperVisibility, 0, 1) : 1;
}

function stageSurfaceFadeAlpha(state: EngineState, paperVisibility: number): number {
	const renderer = requireLoadedSurfaceRenderer(state.surface.type);
	const fadeCarrierSkipped = Boolean(
		(renderer?.shaderPass as ShaderPass<unknown> | undefined)?.environment
	);
	return fadeCarrierSkipped || hasCompositionOwnedSurfaceOpacity(state)
		? clampNumber(paperVisibility, 0, 1)
		: 1;
}

function dofInputTexture(planes: CompositionPlanes, surfacePlane: GPUTexture): GPUTexture {
	if (typeof window !== 'undefined') {
		if (window.__gfxDofPreviewPlane === 'surface') {
			return surfacePlane;
		}
		if (window.__gfxDofPreviewPlane === 'overlay') {
			return planes.overlayPlaneTexture();
		}
	}
	return planes.compositeTexture();
}

function renderDofFrame(
	request: CompositionFrameRenderRequest,
	dof: ResolvedDofFrame,
	inputs: SurfaceRenderInputs,
	timebase: CompositionFrameTimebase,
	treatments: PreparedFramePackTreatments
): boolean {
	const { pipeline, host, effectChain, compositionPlanes } = request.resources;
	const { overlayRootElement } = request;
	if (!pipeline || !host || !effectChain || !compositionPlanes || !overlayRootElement) {
		return false;
	}

	pipeline.render(inputs);
	const surfaceOutput = pipeline.getOutputTexture();
	captureOverlayDom(request, compositionPlanes, overlayRootElement);
	compositionPlanes.composite({
		surfacePlaneView: surfaceOutput.createView(),
		focusZ: dof.focusZ,
		aperture: dof.aperture,
		surfaceZ: dof.surfaceZ,
		overlayZ: dof.overlayZ,
		backdrop: dof.backdrop,
		time: timebase.progress,
		surfaceAlpha: surfaceFadeAlpha(request.state, request.paperVisibility)
	});
	effectChain.apply({
		commandEncoder: host.device.createCommandEncoder(),
		effects:
			request.readableProbeMode === 'readable-mask'
				? []
				: appendPackChrome(dof.otherEffects, treatments.chromeEffects),
		inputTexture: dofInputTexture(compositionPlanes, surfaceOutput),
		outputView: request.outputView,
		...timebase,
		background: treatments.background,
		videoUnderlayTexture:
			request.readableProbeMode === 'readable-mask' ? null : request.videoUnderlayTexture
	});
	return true;
}

function renderStageFrame(
	request: CompositionFrameRenderRequest,
	stage: ResolvedStageFrame,
	inputs: SurfaceRenderInputs,
	timebase: CompositionFrameTimebase,
	treatments: PreparedFramePackTreatments
): boolean {
	const { pipeline, host, effectChain, depthStage, shaderPassDispatcher, compositionPlanes } =
		request.resources;
	if (!pipeline || !host || !effectChain || !depthStage || !shaderPassDispatcher) {
		return false;
	}

	pipeline.render(inputs);
	const stagedSurfaceTexture = shaderPassDispatcher.apply({
		commandEncoder: host.device.createCommandEncoder(),
		passes: buildShaderPassDispatchList(request, treatments, 'stage'),
		inputTexture: pipeline.getOutputTexture(),
		ctx: timebase
	});
	let overlayPlaneView: GPUTextureView | undefined;
	const posedOverlayPlanes: DepthStagePosedOverlayPlane[] = [];
	if (compositionPlanes) {
		if (stage.sharedOverlayCount > 0 && request.overlayRootElement) {
			captureOverlayDom(request, compositionPlanes, request.overlayRootElement);
			compositionPlanes.premultiplyOverlay();
			overlayPlaneView = compositionPlanes.overlayPlaneTexture().createView();
		}
		// Each posed Overlay is captured from its own frame-sized root and turns
		// about its rendered centre, measured from that same root (ADR-0057).
		const posedRoots = new Map(
			(request.posedOverlayRoots ?? []).map((root) => [root.overlayId, root.element])
		);
		compositionPlanes.retainPosedOverlays(stage.posedOverlays.map((overlay) => overlay.id));
		const size = { width: depthStage.width, height: depthStage.height };
		for (const overlay of stage.posedOverlays) {
			const element = posedRoots.get(overlay.id);
			if (!element) continue;
			capturePosedOverlayDom(request, compositionPlanes, overlay.id, element);
			compositionPlanes.premultiplyPosedOverlay(overlay.id);
			const texture = compositionPlanes.posedOverlayPlaneTexture(overlay.id);
			if (!texture) continue;
			const bounds = measureOverlayBoundsPx(
				overlay,
				element,
				size,
				request.state.transport.orientation
			);
			posedOverlayPlanes.push({
				overlayId: overlay.id,
				planeView: texture.createView(),
				z: overlay.z ?? SHARED_OVERLAY_PLANE_Z,
				pose: overlay.pose,
				pivot: {
					x: (bounds.x + bounds.width / 2) / size.width,
					y: (bounds.y + bounds.height / 2) / size.height
				}
			});
		}
	}
	// The screen (ADR-0051 phase 2): the registered model whose glass the
	// Surface plane is, once its mesh is resident. Readiness awaited the mesh
	// before first paint and export; a frame that arrives without it (a model
	// just declared in the editor) renders the plane alone until it lands.
	const screenModel = stage.screenModel ? getStageModel(stage.screenModel) : null;
	const screen =
		screenModel && request.stageModelMesh
			? { model: screenModel, mesh: request.stageModelMesh }
			: undefined;
	const rig = createStageCameraRig({
		aspect: depthStage.width / depthStage.height,
		camera: stage.camera,
		time: timebase.progress
	});
	// The bodies the Overlays contribute (ADR-0062), placed through the same
	// rig this frame films with. Readiness awaited their typeface before first
	// paint and export; a frame without it renders the stage without them.
	const bodies: DepthStageBody[] =
		stage.bodyOverlayCount > 0 && request.stageTypeface
			? resolveOverlayStageBodies({
					overlays: request.state.overlays,
					pack: request.pack,
					typeface: request.stageTypeface,
					overlayChannels: request.overlayChannels,
					overlayProgresses: request.overlayProgresses,
					rig,
					aspect: depthStage.width / depthStage.height,
					orientation: request.state.transport.orientation
				}).map((resolution) => resolution.body)
			: [];
	depthStage.render({
		surfacePlaneView: stagedSurfaceTexture.createView(),
		overlayPlaneView,
		overlayZ: stage.overlayZ,
		posedOverlayPlanes,
		screen,
		bodies,
		focusZ: stage.focusZ,
		aperture: stage.aperture,
		focusBand: stage.focusBand,
		backdropColor: stage.backdropColor,
		backdropTextureView:
			stage.backdropAsset && request.substrateTexture
				? request.substrateTexture.createView()
				: undefined,
		backdropContrast: stage.backdropContrast,
		camera: stage.camera,
		light: stage.light,
		surfaceFadeAlpha: stageSurfaceFadeAlpha(request.state, request.paperVisibility),
		time: timebase.progress
	});
	effectChain.apply({
		commandEncoder: host.device.createCommandEncoder(),
		effects:
			request.readableProbeMode === 'readable-mask'
				? []
				: appendPackChrome(stage.effects, treatments.chromeEffects),
		inputTexture: depthStage.outputTexture(),
		outputView: request.outputView,
		...timebase,
		stageContentScale: STAGE_CAM_Z / rig.aimDistance,
		background: undefined,
		videoUnderlayTexture:
			request.readableProbeMode === 'readable-mask' ? null : request.videoUnderlayTexture
	});
	return true;
}

function renderFlatFrame(
	request: CompositionFrameRenderRequest,
	inputs: SurfaceRenderInputs,
	timebase: CompositionFrameTimebase,
	treatments: PreparedFramePackTreatments
): boolean {
	const { pipeline, host, effectChain, shaderPassDispatcher } = request.resources;
	if (!pipeline || !host || !effectChain || !shaderPassDispatcher) {
		return false;
	}
	pipeline.render(inputs);
	const postShaderTexture = shaderPassDispatcher.apply({
		commandEncoder: host.device.createCommandEncoder(),
		passes: buildShaderPassDispatchList(request, treatments, 'flat'),
		inputTexture: pipeline.getOutputTexture(),
		ctx: timebase
	});
	effectChain.apply({
		commandEncoder: host.device.createCommandEncoder(),
		effects:
			request.readableProbeMode === 'readable-mask'
				? []
				: appendPackChrome(request.state.effects, treatments.chromeEffects),
		inputTexture: postShaderTexture,
		outputView: request.outputView,
		...timebase,
		background: treatments.background,
		videoUnderlayTexture:
			request.readableProbeMode === 'readable-mask' ? null : request.videoUnderlayTexture
	});
	return true;
}

/** Render one deterministic composition frame. Preview, transition snapshots,
 * and export all call this exact seam with an explicit output view + timestamp. */
export function renderCompositionFrameTo(
	request: CompositionFrameRenderRequest
): CompositionFrameRenderResult {
	const branches = resolveCompositionFrameBranchOrder(
		request.state,
		request.cachedTransition !== null
	);
	if (branches[0] === 'transition' && request.cachedTransition) {
		const progress = clampNumber(
			(request.timestamp * 1000) / request.cachedTransition.durationMs,
			0,
			1
		);
		request.cachedTransition.effect.apply({
			fromView: request.cachedTransition.snapshots.fromTexture().createView(),
			toView: request.cachedTransition.snapshots.toTexture().createView(),
			outputView: request.outputView,
			params: request.cachedTransition.params,
			context: {
				progress,
				timestamp: request.timestamp,
				canvasWidth: request.cachedTransition.width,
				canvasHeight: request.cachedTransition.height
			}
		});
		return 'transition';
	}

	const { pipeline, host, effectChain, shaderPassDispatcher } = request.resources;
	if (!pipeline || !host || !effectChain || !shaderPassDispatcher) {
		return 'unavailable';
	}

	return renderLiveCompositionFrame(
		{ ...request, state: resolveFrameEffectChannelState(request.state, request.effectChannels) },
		branches
	);
}

// The stage, DOF, and flat branches, over a state whose authored Effects
// already carry this frame's channel values.
function renderLiveCompositionFrame(
	request: CompositionFrameRenderRequest,
	branches: readonly CompositionFrameRenderBranch[]
): CompositionFrameRenderResult {
	requireLoadedSurfaceRenderer(request.state.surface.type);
	for (const overlay of request.state.overlays) requireLoadedOverlayRenderer(overlay.type);

	const timebase = frameTimebase(request.state, request.timestamp);
	const builtInputs = request.buildSurfaceInputs(request.timestamp);
	const inputs =
		request.readableProbeMode === 'readable-mask'
			? { ...builtInputs, chart: undefined }
			: builtInputs;
	const resolvedTreatments = prepareFramePackTreatments(request.state, request.pack);
	const treatments =
		request.readableProbeMode === 'readable-mask'
			? {
					...resolvedTreatments,
					edgeTarget: null,
					light: null,
					chromeEffects: [],
					background: undefined
				}
			: resolvedTreatments;

	// Browser paint generations let shader-only frames retain the resident 4K DOM
	// texture. Export forces one upload after each acknowledged paint settlement.
	captureSurfaceDom(request);

	for (const branch of branches) {
		if (branch === 'stage') {
			const stage = resolveStageFrame(request.state, timebase.progress, treatments);
			if (stage && renderStageFrame(request, stage, inputs, timebase, treatments)) {
				return 'stage';
			}
			continue;
		}
		if (branch === 'dof') {
			const dof = resolveDofFrame(request.state, timebase.progress);
			if (dof && renderDofFrame(request, dof, inputs, timebase, treatments)) {
				return 'dof';
			}
			continue;
		}
		if (branch === 'flat' && renderFlatFrame(request, inputs, timebase, treatments)) {
			return 'flat';
		}
	}

	return 'unavailable';
}
