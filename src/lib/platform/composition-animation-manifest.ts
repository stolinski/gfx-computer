import type { AnnotationMarkStyle } from '$lib/annotations/annotation-mark-styles';

import type {
	KineticWordChannelValues,
	OverlayChannelValues,
	RenderAnimState
} from './anim-state.svelte.ts';
import type { AnimationManifest, AnimationTweenSpec } from './animation-manager.ts';
import {
	DEFAULT_BLOCK_ENTER,
	DEFAULT_OVERLAY_ENTER,
	resolveCascadeTimings,
	type CascadeWindow
} from './cascade-timing.ts';
import {
	getEaseGsap,
	resolveMarkForIndex,
	SUGAR_OPACITY_EXIT_EASES,
	type EngineState,
	type Keyframe,
	type KineticWordChannelKeyframes,
	type MarkInstance,
	type TextAnimation,
	type Transport
} from './engine-schema.ts';
import { listSurfaceMarkInstances } from './surface-mark-instances.ts';
import { clampNumber } from '$lib/utils/math';
import { resolveDiagramPrimitiveGeometry } from '$lib/utils/diagram-geometry';
import {
	resolveKineticWordChannelKeyframes,
	resolveKineticWordGeometry
} from '$lib/utils/kinetic-word-geometry';
import { resolveOverlayPlacement } from '$lib/utils/overlay-placement';

const COMPOSITION_CHANNEL_KEYS = ['opacity', 'x', 'y', 'scale', 'rotation'] as const;
type CompositionChannelKey = (typeof COMPOSITION_CHANNEL_KEYS)[number];
type CascadeWindowMap = ReadonlyMap<string, CascadeWindow>;

export interface CompositionTextAnimationCompiler {
	rebuild(
		root: HTMLElement | null,
		entries: readonly TextAnimation[],
		transport: Transport
	): AnimationTweenSpec[];
}

export interface CompositionAnimationManifestInput {
	state: EngineState;
	runtime: RenderAnimState;
	textAnimationRoot: HTMLElement | null;
	textAnimationCompiler: CompositionTextAnimationCompiler;
	resolveMarkColor: (style: AnnotationMarkStyle) => string;
}

function clampCompositionTweenStart(start: number, duration: number): number {
	return clampNumber(start, 0, Math.max(0, 1 - duration));
}

function appendChannelKeyframeTweens(options: {
	tweens: AnimationTweenSpec[];
	keyPrefix: string;
	frames: readonly Keyframe[];
	clipStartFraction: number;
	durationMs: number;
	write: (value: number) => void;
}): void {
	const { tweens, keyPrefix, frames, clipStartFraction, durationMs, write } = options;
	const toFraction = (milliseconds: number): number => milliseconds / durationMs;

	if (frames.length === 1) {
		const only = frames[0];
		tweens.push({
			key: `${keyPrefix}-0`,
			start: clampCompositionTweenStart(clipStartFraction + toFraction(only.atMs), 0),
			duration: 0,
			ease: 'none',
			from: only.value,
			to: only.value,
			onUpdate: write
		});
		return;
	}

	for (let index = 1; index < frames.length; index += 1) {
		const previous = frames[index - 1];
		const next = frames[index];
		const duration = Math.min(toFraction(next.atMs - previous.atMs), 1);
		tweens.push({
			key: `${keyPrefix}-${index}`,
			start: clampCompositionTweenStart(clipStartFraction + toFraction(previous.atMs), duration),
			duration,
			ease: getEaseGsap(next.ease ?? 'smooth'),
			from: previous.value,
			to: next.value,
			onUpdate: write
		});
	}
}

function resizeCompositionProgress(values: number[], length: number): void {
	while (values.length < length) values.push(0);
	while (values.length > length) values.pop();
}

function synchronizeBlockAnimationRecords(runtime: RenderAnimState, ids: readonly string[]): void {
	for (const record of [runtime.blockProgresses, runtime.blockAlphas, runtime.blockChannels]) {
		for (const key of Object.keys(record)) {
			if (!ids.includes(key)) delete record[key];
		}
	}
	for (const id of ids) {
		runtime.blockProgresses[id] ??= 0;
		runtime.blockAlphas[id] ??= 1;
		runtime.blockChannels[id] ??= null;
	}
}

function synchronizeKineticWordAnimationRecords(
	runtime: RenderAnimState,
	ids: readonly string[]
): void {
	for (const key of Object.keys(runtime.kineticWordChannels)) {
		if (!ids.includes(key)) delete runtime.kineticWordChannels[key];
	}
	for (const id of ids) runtime.kineticWordChannels[id] ??= null;
}

/** Surface opacity: the declared channel takes the pen; otherwise the enter/exit sugar. */
function appendSurfaceOpacityTweens(
	state: EngineState,
	durationMs: number,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	const surface = state.surface;
	const surfaceOpacity = surface.animation?.channels?.opacity;
	if (surfaceOpacity && surfaceOpacity.length > 0) {
		appendChannelKeyframeTweens({
			tweens,
			keyPrefix: 'paper-opacity',
			frames: surfaceOpacity,
			clipStartFraction: surface.enter?.start ?? 0,
			durationMs,
			write: (value) => {
				runtime.paperVisibility = value;
			}
		});
		return;
	}

	if (surface.enter) {
		tweens.push({
			key: 'paper-enter',
			start: surface.enter.start,
			duration: surface.enter.duration,
			ease: getEaseGsap(surface.enter.ease),
			from: 0,
			to: 1,
			onUpdate: (value) => {
				runtime.paperVisibility = value;
			}
		});
	}
	if (surface.exit) {
		tweens.push({
			key: 'paper-exit',
			start: surface.exit.start,
			duration: surface.exit.duration,
			ease: SUGAR_OPACITY_EXIT_EASES[surface.exit.ease],
			from: 1,
			to: 0,
			onUpdate: (value) => {
				runtime.paperVisibility = value;
			}
		});
	}
	if (!surface.enter && !surface.exit) runtime.paperVisibility = 1;
}

function appendMarkTweens(
	marks: readonly MarkInstance[],
	state: EngineState,
	cascadeWindows: CascadeWindowMap,
	resolveMarkColor: (style: AnnotationMarkStyle) => string,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	marks.forEach((mark, index) => {
		if (mark.window === 'static') {
			runtime.markProgresses[index] = 1;
			return;
		}
		if (mark.window !== undefined) {
			tweens.push({
				key: `mark-${index}`,
				start: mark.window.start,
				duration: mark.window.duration,
				ease: 'power1.inOut',
				onUpdate: (value) => {
					runtime.markProgresses[index] = value;
				}
			});
			return;
		}

		const resolved = resolveMarkForIndex(
			mark.style,
			index,
			state.marks,
			resolveMarkColor(mark.style)
		);
		tweens.push({
			key: `mark-${index}`,
			start: cascadeWindows.get(`mark:${index}`)?.startFraction ?? resolved.start,
			duration: resolved.duration,
			ease: 'power1.inOut',
			onUpdate: (value) => {
				runtime.markProgresses[index] = value;
			}
		});
	});
}

/** Every declared channel of one element, written into its live slot at tween time. */
function appendElementChannelTweens(options: {
	tweens: AnimationTweenSpec[];
	keyPrefix: string;
	channels: Partial<Record<CompositionChannelKey, Keyframe[] | undefined>> | undefined;
	clipStartFraction: number;
	durationMs: number;
	readSlot: () => OverlayChannelValues | null;
}): void {
	const { tweens, keyPrefix, channels, clipStartFraction, durationMs, readSlot } = options;
	for (const channel of COMPOSITION_CHANNEL_KEYS) {
		const frames = channels?.[channel];
		if (!frames || frames.length === 0) continue;
		appendChannelKeyframeTweens({
			tweens,
			keyPrefix: `${keyPrefix}-${channel}`,
			frames,
			clipStartFraction,
			durationMs,
			write: (value) => {
				const slot = readSlot();
				if (slot) slot[channel] = value;
			}
		});
	}
}

/** Initial per-overlay channel values (null for overlays without declared channels). */
function resolveOverlayChannelValues(state: EngineState): (OverlayChannelValues | null)[] {
	return state.overlays.map((overlay) => {
		const channels = overlay.animation?.channels;
		if (!channels || !COMPOSITION_CHANNEL_KEYS.some((key) => (channels[key]?.length ?? 0) > 0)) {
			return null;
		}
		const placement = resolveOverlayPlacement(overlay.position, state.transport.orientation);
		return {
			opacity: channels.opacity?.[0]?.value ?? 1,
			x: channels.x?.[0]?.value ?? 0,
			y: channels.y?.[0]?.value ?? 0,
			scale: channels.scale?.[0]?.value ?? placement.scale ?? 1,
			rotation: channels.rotation?.[0]?.value ?? placement.rotation ?? 0
		};
	});
}

function appendOverlayTweens(
	state: EngineState,
	cascadeWindows: CascadeWindowMap,
	durationMs: number,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	state.overlays.forEach((overlay, index) => {
		const window = cascadeWindows.get(`overlay:${overlay.id}`);
		if (runtime.overlayChannels[index]) {
			appendElementChannelTweens({
				tweens,
				keyPrefix: `overlay-${overlay.id}`,
				channels: overlay.animation?.channels,
				clipStartFraction: window?.startFraction ?? overlay.enter?.start ?? 0,
				durationMs,
				readSlot: () => runtime.overlayChannels[index]
			});
			runtime.overlayProgresses[index] = 1;
			return;
		}

		const enter = overlay.enter ?? DEFAULT_OVERLAY_ENTER;
		tweens.push({
			key: `overlay-${overlay.id}-enter`,
			start: window?.startFraction ?? enter.start,
			duration: enter.duration,
			ease: getEaseGsap(enter.ease),
			from: 0,
			to: 1,
			onUpdate: (value) => {
				runtime.overlayProgresses[index] = value;
			}
		});
		if (overlay.exit) {
			tweens.push({
				key: `overlay-${overlay.id}-exit`,
				start: overlay.exit.start,
				duration: overlay.exit.duration,
				ease: getEaseGsap(overlay.exit.ease),
				from: 1,
				to: 0,
				onUpdate: (value) => {
					runtime.overlayProgresses[index] = value;
				}
			});
		}
	});
}

type DiagramPrimitive = NonNullable<EngineState['surface']['diagram']>[number];

function appendPrimitiveChannelTweens(
	primitive: DiagramPrimitive,
	state: EngineState,
	channels: Partial<Record<CompositionChannelKey, Keyframe[]>>,
	clipStartFraction: number,
	durationMs: number,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	const staticScale =
		primitive.type === 'node' || primitive.type === 'label' || primitive.type === 'stat-callout'
			? (resolveDiagramPrimitiveGeometry(primitive, state.transport.orientation).scale ?? 1)
			: 1;
	runtime.blockChannels[primitive.id] = {
		opacity: channels.opacity?.[0]?.value ?? 1,
		x: channels.x?.[0]?.value ?? 0,
		y: channels.y?.[0]?.value ?? 0,
		scale: channels.scale?.[0]?.value ?? staticScale,
		rotation: channels.rotation?.[0]?.value ?? 0
	};
	appendElementChannelTweens({
		tweens,
		keyPrefix: `block-${primitive.id}`,
		channels,
		clipStartFraction,
		durationMs,
		readSlot: () => runtime.blockChannels[primitive.id]
	});
	runtime.blockProgresses[primitive.id] = 1;
	runtime.blockAlphas[primitive.id] = 1;
}

function appendPrimitiveSugarTweens(
	primitive: DiagramPrimitive,
	window: CascadeWindow | undefined,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	runtime.blockChannels[primitive.id] = null;
	runtime.blockAlphas[primitive.id] = 1;
	const enter = primitive.enter ?? DEFAULT_BLOCK_ENTER;
	const isStroke = primitive.type === 'edge-arrow' || primitive.type === 'timeline-segment';
	tweens.push({
		key: `block-${primitive.id}-enter`,
		start: window?.startFraction ?? enter.start,
		duration: enter.duration,
		ease: isStroke ? 'power1.inOut' : getEaseGsap(enter.ease),
		from: 0,
		to: 1,
		onUpdate: (value) => {
			runtime.blockProgresses[primitive.id] = value;
		}
	});
	if (primitive.exit) {
		tweens.push({
			key: `block-${primitive.id}-exit`,
			start: primitive.exit.start,
			duration: primitive.exit.duration,
			ease: SUGAR_OPACITY_EXIT_EASES[primitive.exit.ease],
			from: 1,
			to: 0,
			onUpdate: (value) => {
				runtime.blockAlphas[primitive.id] = value;
			}
		});
	}
}

function appendKineticWordTweens(
	state: EngineState,
	durationMs: number,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	const words = state.surface.typeField?.words ?? [];
	synchronizeKineticWordAnimationRecords(
		runtime,
		words.map((word) => word.id)
	);
	for (const word of words) {
		const channels = resolveKineticWordChannelKeyframes(word, state.transport.orientation);
		const channelNames = Object.keys(channels) as (keyof KineticWordChannelKeyframes)[];
		if (!channelNames.some((channel) => (channels[channel]?.length ?? 0) > 0)) {
			runtime.kineticWordChannels[word.id] = null;
			continue;
		}

		const geometry = resolveKineticWordGeometry(word, state.transport.orientation);
		const slot: KineticWordChannelValues = {
			opacity: channels.opacity?.[0]?.value ?? 1,
			x: channels.x?.[0]?.value ?? 0,
			y: channels.y?.[0]?.value ?? 0,
			scale: channels.scale?.[0]?.value ?? geometry.scale,
			rotation: channels.rotation?.[0]?.value ?? geometry.rotation,
			weight: channels.weight?.[0]?.value ?? 0.5,
			reveal: channels.reveal?.[0]?.value ?? 0,
			tracking: channels.tracking?.[0]?.value ?? 0
		};
		runtime.kineticWordChannels[word.id] = slot;
		for (const channel of channelNames) {
			const frames = channels[channel];
			if (!frames || frames.length === 0) continue;
			appendChannelKeyframeTweens({
				tweens,
				keyPrefix: `kinetic-word-${word.id}-${channel}`,
				frames,
				clipStartFraction: 0,
				durationMs,
				write: (value) => {
					const current = runtime.kineticWordChannels[word.id];
					if (current) current[channel] = value;
				}
			});
		}
	}
}

function appendDiagramBlockTweens(
	state: EngineState,
	cascadeWindows: CascadeWindowMap,
	durationMs: number,
	runtime: RenderAnimState,
	tweens: AnimationTweenSpec[]
): void {
	const diagramPrimitives = state.surface.diagram ?? [];
	synchronizeBlockAnimationRecords(
		runtime,
		diagramPrimitives.map((primitive) => primitive.id)
	);
	for (const primitive of diagramPrimitives) {
		const channels = primitive.animation?.channels as
			Partial<Record<CompositionChannelKey, Keyframe[]>> | undefined;
		const window = cascadeWindows.get(`block:${primitive.id}`);
		const hasChannels =
			channels !== undefined &&
			COMPOSITION_CHANNEL_KEYS.some((key) => (channels[key]?.length ?? 0) > 0);

		if (hasChannels && channels) {
			appendPrimitiveChannelTweens(
				primitive,
				state,
				channels,
				window?.startFraction ?? primitive.enter?.start ?? 0,
				durationMs,
				runtime,
				tweens
			);
			continue;
		}

		appendPrimitiveSugarTweens(primitive, window, runtime, tweens);
	}
}

/**
 * Build the frame-deterministic tween manifest for one composition. The input
 * owns both authored state and live animation values; this module only derives
 * tween ordering, resolved starts, and corrective writers.
 */
export function buildCompositionAnimationManifest(
	input: CompositionAnimationManifestInput
): AnimationManifest {
	const { state, runtime, textAnimationRoot, textAnimationCompiler, resolveMarkColor } = input;
	const marks = listSurfaceMarkInstances(state.surface);
	const durationMs = state.transport.durationSeconds * 1000;

	resizeCompositionProgress(runtime.markProgresses, marks.length);
	resizeCompositionProgress(runtime.overlayProgresses, state.overlays.length);

	// Cascade welds resolve before every tween and before sound derivation.
	const cascadeWindows = resolveCascadeTimings(state);
	const tweens: AnimationTweenSpec[] = [];

	appendSurfaceOpacityTweens(state, durationMs, runtime, tweens);
	appendMarkTweens(marks, state, cascadeWindows, resolveMarkColor, runtime, tweens);

	const resolvedTextAnimations = state.textAnimations.map((entry) => {
		const resolvedStart = cascadeWindows.get(`textAnimation:${entry.id}`)?.startFraction;
		if (resolvedStart === undefined || resolvedStart === entry.enter.start) return entry;
		return { ...entry, enter: { ...entry.enter, start: resolvedStart } };
	});
	tweens.push(
		...textAnimationCompiler.rebuild(textAnimationRoot, resolvedTextAnimations, state.transport)
	);

	runtime.overlayChannels = resolveOverlayChannelValues(state);
	appendOverlayTweens(state, cascadeWindows, durationMs, runtime, tweens);
	appendKineticWordTweens(state, durationMs, runtime, tweens);
	appendDiagramBlockTweens(state, cascadeWindows, durationMs, runtime, tweens);

	return { tweens };
}
