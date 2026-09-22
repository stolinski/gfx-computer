import type { AnnotationMarkStyle } from '$lib/annotations/annotation-mark-styles';
import { annotationBodyPlainText } from '$lib/annotations/annotation-body-text';
import type { AchievementContent } from '$lib/pipelines/overlays/achievement/achievement-content';
import {
	isAchievementVariantId,
	setAchievementBeat,
	VARIANTS as ACHIEVEMENT_VARIANTS
} from '$lib/pipelines/overlays/achievement/variants';
import type { CursorPath } from '$lib/pipelines/overlays/cursor-trail';
import { buildCursorSchedule } from '$lib/pipelines/overlays/cursor-trail/schedule';
import { messageEnter, messageTyping } from '$lib/pipelines/surfaces/imessage/schedule';
import { TEXT_EFFECT_CATALOG, type TextEffectPhase } from '$lib/text-animations/catalog';
import { clampNumber } from '$lib/utils/math';
import { CHART_MOTION_PHASE_NAMES, CHART_TIMING_EPSILON } from '$lib/utils/chart-motion';
import { isDarkSurfaceColor } from '$lib/utils/color';
import { truncateMiddle } from '$lib/utils/string';
import {
	isKineticWordSpatialChannel,
	resolveKineticWordChannelKeyframes
} from '$lib/utils/kinetic-word-geometry';
import { computeUnifiedBar, type RampTiming } from '$lib/utils/timeline-clip';

import {
	cascadeNodeKey,
	DEFAULT_BLOCK_ENTER,
	resolveCascadeTimings,
	type CascadeWindow
} from './cascade-timing';
import { easeLandingFraction } from './ease-landing';
import {
	createMarkTiming,
	getEaseGsap,
	resolveMarkForIndex,
	SUGAR_OPACITY_EXIT_EASES,
	type Cascade,
	type DiagramEndpoint,
	type DiagramPrimitive,
	type EngineState,
	type Keyframe
} from './engine-schema';
import { resolveStageCameraForOrientation } from './pipelines/depth-stage-camera';
import { listSurfaceMarkInstances } from './surface-mark-instances';
import { deriveSoundCues, isAudibleSoundCue, resolveCueSample } from './sound-cues';
import { getStageModel } from './stage-models';
import {
	createSoundRailReferenceId,
	createTimelineTrackId,
	createVideoClipSelectionId,
	STAGE_SCREEN_BODY_ID,
	type SoundRailReference,
	type TimelineTrackId
} from './timeline-entity-identity';
import type {
	ClipCascadeLink,
	ClipKeyframe,
	TimelineTrack,
	TimelineTransition,
	VideoTimelineTrack
} from './timeline-track';

const BLOCK_COLOR = '#c8a94e';
const OVERLAY_COLOR = '#7d93b2';
const TEXT_ANIMATION_COLOR = '#9a86c9';
const SOUND_CUE_COLOR = '#57b3ac';
/** The stage rows (ADR-0060): the camera, the focus, and the bodies share one lane colour. */
const STAGE_COLOR = '#8fb996';

// Lane-kind color identity, shared with the inspector's scope crumb so the
// rail's tick matches the selected lane's tick. Kinds whose lane color is
// dynamic (surface and mark ride the pack's ink) are intentionally absent.
export const TIMELINE_KIND_COLORS: Partial<Record<string, string>> = {
	block: BLOCK_COLOR,
	overlay: OVERLAY_COLOR,
	'text-animation': TEXT_ANIMATION_COLOR,
	'sound-cue': SOUND_CUE_COLOR,
	'stage-camera': STAGE_COLOR,
	'stage-focus': STAGE_COLOR,
	'stage-body': STAGE_COLOR
};

/** A stage row's window clip: the travel and the rack focus are timeline fractions already. */
const STAGE_WINDOW_LIMITS = { minStart: 0, maxStart: 0.98, minDuration: 0.02, maxDuration: 1 };

type ChannelTrackMap = Partial<Record<string, Keyframe[] | undefined>>;

export interface CompositionTimelineAppearance {
	paperColor: string;
	inkColor: string;
	resolveMarkColor: (style: AnnotationMarkStyle) => string;
}

function ensureCompositionMarkTiming(state: EngineState, index: number) {
	while (state.marks.timings.length <= index) state.marks.timings.push(createMarkTiming());
	return state.marks.timings[index];
}

function buildUnifiedTimelineTransition(options: {
	id: string;
	label: string;
	color?: string;
	enter?: RampTiming;
	exit?: RampTiming;
	setEnter?: (start: number, duration: number) => void;
	setExit?: (start: number, duration: number) => void;
	enterEase?: string;
	exitEase?: string;
	enterLandFrac?: number;
	exitLandFrac?: number;
}): TimelineTransition {
	const resolveLand = (fraction: number | undefined, ease: string | undefined): number =>
		fraction ?? (ease ? easeLandingFraction(ease) : 1);
	const enterLandFrac = resolveLand(options.enterLandFrac, options.enterEase);
	const exitLandFrac = resolveLand(options.exitLandFrac, options.exitEase);
	const { barStart, barDuration, enterZone, exitZone } = computeUnifiedBar(
		options.enter,
		options.exit,
		enterLandFrac,
		exitLandFrac
	);
	return {
		id: options.id,
		label: options.label,
		color: options.color,
		start: barStart,
		duration: barDuration,
		enterZone,
		exitZone,
		enterLandFrac,
		exitLandFrac,
		unified: {
			enterStart: options.enter?.start,
			enterDuration: options.enter?.duration,
			exitStart: options.exit?.start,
			exitDuration: options.exit?.duration,
			enterLandFrac,
			exitLandFrac,
			setEnter:
				options.setEnter ??
				(options.enter
					? (start, duration) => {
							options.enter!.start = start;
							options.enter!.duration = duration;
						}
					: undefined),
			setExit:
				options.setExit ??
				(options.exit
					? (start, duration) => {
							options.exit!.start = start;
							options.exit!.duration = duration;
						}
					: undefined)
		}
	};
}

const TEXT_ANIMATION_REPRESENTATIVE_UNITS: Record<string, number> = {
	whole: 1,
	'per-line': 3,
	'per-word': 7,
	'per-character': 16
};

function textAnimationLandingFraction(target: string, phase: TextEffectPhase): number {
	const unitCount = TEXT_ANIMATION_REPRESENTATIVE_UNITS[target] ?? 8;
	const stagger = phase.stagger_ms ?? 0;
	const total = phase.duration_ms + (unitCount - 1) * stagger;
	if (total <= 0) return 1;
	return (
		((unitCount - 1) * stagger + phase.duration_ms * easeLandingFraction(phase.easing)) / total
	);
}

function cascadeAnchorTrackId(anchor: Cascade['anchor']): TimelineTrackId {
	if (anchor === 'surface') return createTimelineTrackId({ kind: 'surface' });
	if ('overlay' in anchor) {
		return createTimelineTrackId({ kind: 'overlay', overlayId: anchor.overlay });
	}
	if ('mark' in anchor) return createTimelineTrackId({ kind: 'mark', index: anchor.mark });
	if ('block' in anchor) {
		return createTimelineTrackId({ kind: 'block', blockId: anchor.block });
	}
	return createTimelineTrackId({
		kind: 'text-animation',
		textAnimationId: anchor.textAnimation
	});
}

function cascadeAnchorFraction(cascade: Cascade, windows: Map<string, CascadeWindow>): number {
	const anchor = windows.get(cascadeNodeKey(cascade.anchor));
	if (!anchor) return 0;
	return cascade.event === 'end'
		? anchor.startFraction + anchor.durationFraction
		: anchor.startFraction;
}

function cascadeLinkFor(
	cascade: Cascade | undefined,
	windows: Map<string, CascadeWindow>
): ClipCascadeLink | undefined {
	if (!cascade) return undefined;
	return {
		anchorTrackId: cascadeAnchorTrackId(cascade.anchor),
		anchorFraction: cascadeAnchorFraction(cascade, windows)
	};
}

function writeCascadeStart(state: EngineState, cascade: Cascade, startFraction: number): void {
	const durationMs = state.transport.durationSeconds * 1000;
	const anchorFraction = cascadeAnchorFraction(cascade, resolveCascadeTimings(state));
	cascade.offsetMs = (startFraction - anchorFraction) * durationMs;
}

function clipKeyframes(
	state: EngineState,
	channels: ChannelTrackMap,
	clipStartFraction: number
): ClipKeyframe[] {
	const durationMs = state.transport.durationSeconds * 1000;
	const markers: ClipKeyframe[] = [];
	for (const [channel, frames] of Object.entries(channels)) {
		frames?.forEach((frame, index) => {
			markers.push({
				channel,
				index,
				fraction: clipStartFraction + frame.atMs / durationMs,
				value: frame.value
			});
		});
	}
	return markers.sort((left, right) => left.fraction - right.fraction);
}

function makeKeyframeDeleter(channels: ChannelTrackMap) {
	return (channel: string, index: number): void => {
		const track = channels[channel];
		if (!track || !track[index]) return;
		track.splice(index, 1);
		if (track.length > 0) delete track[0].ease;
		else delete channels[channel];
	};
}

function makeKeyframeRetimer(
	state: EngineState,
	channels: ChannelTrackMap,
	clipStartFraction: number
) {
	return (channel: string, index: number, fraction: number): void => {
		const frames = channels[channel];
		const frame = frames?.[index];
		if (!frames || !frame) return;
		const durationMs = state.transport.durationSeconds * 1000;
		const min = index > 0 ? frames[index - 1].atMs + 1 : 0;
		const max =
			index < frames.length - 1 ? frames[index + 1].atMs - 1 : (1 - clipStartFraction) * durationMs;
		frame.atMs = clampNumber((fraction - clipStartFraction) * durationMs, min, Math.max(min, max));
	};
}

function diagramEndpointName(endpoint: DiagramEndpoint): string {
	return 'node' in endpoint ? endpoint.node : '•';
}

function diagramTrackLabel(primitive: DiagramPrimitive): string {
	switch (primitive.type) {
		case 'node':
			return `node · ${truncateMiddle(primitive.text ?? primitive.form, 14)}`;
		case 'edge-arrow':
			return `edge · ${diagramEndpointName(primitive.from)} → ${diagramEndpointName(primitive.to)}`;
		case 'label':
			return `label · ${truncateMiddle(primitive.text, 14)}`;
		case 'stat-callout':
			return `stat · ${primitive.to.toLocaleString('en-US')}`;
		case 'timeline-segment':
			return primitive.label ? `span · ${truncateMiddle(primitive.label, 14)}` : 'span';
	}
}

function appendSurfaceTrack(
	tracks: TimelineTrack[],
	state: EngineState,
	color: string,
	windows: Map<string, CascadeWindow>
): void {
	const surface = state.surface;
	const label =
		surface.type === 'paper' ? 'Paper' : surface.type === 'newspaper' ? 'Newspaper' : 'Surface';
	const channels = surface.animation?.channels;
	if (channels?.opacity?.length) {
		const clipStart = windows.get('surface')?.startFraction ?? 0;
		tracks.push({
			id: createTimelineTrackId({ kind: 'surface' }),
			label,
			color,
			transitions: [
				{
					id: 'clip',
					label,
					color,
					start: clipStart,
					duration: Math.max(windows.get('surface')?.durationFraction ?? 0, 0.02),
					keyframes: clipKeyframes(state, channels, clipStart),
					onKeyframeRetime: makeKeyframeRetimer(state, channels, clipStart),
					onKeyframeDelete: makeKeyframeDeleter(channels)
				}
			]
		});
	} else if (surface.enter || surface.exit) {
		tracks.push({
			id: createTimelineTrackId({ kind: 'surface' }),
			label,
			color,
			transitions: [
				buildUnifiedTimelineTransition({
					id: 'clip',
					label,
					color,
					enter: surface.enter,
					exit: surface.exit,
					enterEase: surface.enter ? getEaseGsap(surface.enter.ease) : undefined,
					exitEase: surface.exit ? SUGAR_OPACITY_EXIT_EASES[surface.exit.ease] : undefined
				})
			]
		});
	} else {
		// A Surface with no entrance or exit is on screen for the whole cut. It
		// still owns the Surface row — that row is how the Surface is selected and
		// inspected — so it gets a full-length clip with nothing to drag.
		tracks.push({
			id: createTimelineTrackId({ kind: 'surface' }),
			label,
			color,
			transitions: [{ id: 'clip', label, color, start: 0, duration: 1 }]
		});
	}
}

function appendChecklistTracks(
	tracks: TimelineTrack[],
	state: EngineState,
	surfaceColor: string,
	strikeColor: string
): void {
	if (state.surface.type !== 'checklist') return;
	(state.surface.content.items ?? []).forEach((item, index) => {
		const label = truncateMiddle(item.text, 20) || `Item ${index + 1}`;
		const transitions: TimelineTransition[] = [
			buildUnifiedTimelineTransition({
				id: 'enter',
				label,
				color: surfaceColor,
				enter: item.enter
					? { start: item.enter.start, duration: item.enter.duration }
					: { start: 0, duration: 0.06 },
				enterEase: getEaseGsap(item.enter?.ease ?? 'settled'),
				setEnter: (start, duration) => {
					const target =
						state.surface.type === 'checklist' ? state.surface.content.items?.[index] : undefined;
					if (target) {
						target.enter = { start, duration, ease: target.enter?.ease ?? 'settled' };
					}
				}
			})
		];
		if (item.checked) {
			transitions.push(
				buildUnifiedTimelineTransition({
					id: 'strike',
					label,
					color: strikeColor,
					enter: item.strike
						? { start: item.strike.start, duration: item.strike.duration }
						: { start: 0, duration: 0.02 },
					enterEase: 'power1.inOut',
					setEnter: (start, duration) => {
						const target =
							state.surface.type === 'checklist' ? state.surface.content.items?.[index] : undefined;
						if (target) {
							target.strike = {
								start,
								duration,
								ease: target.strike?.ease ?? 'sharp',
								sound: target.strike?.sound
							};
						}
					}
				})
			);
		}
		tracks.push({
			id: createTimelineTrackId({ kind: 'checklist-item', index }),
			label,
			color: item.checked ? strikeColor : surfaceColor,
			transitions
		});
	});
}

function appendMarkTracks(
	tracks: TimelineTrack[],
	state: EngineState,
	appearance: CompositionTimelineAppearance,
	windows: Map<string, CascadeWindow>
): void {
	listSurfaceMarkInstances(state.surface).forEach((mark, index) => {
		if (mark.window !== undefined) return;
		const resolved = resolveMarkForIndex(
			mark.style,
			index,
			state.marks,
			appearance.resolveMarkColor(mark.style)
		);
		const timing = state.marks.timings[index];
		const welded = timing?.cascade
			? (windows.get(`mark:${index}`)?.startFraction ?? resolved.start)
			: resolved.start;
		const bar = buildUnifiedTimelineTransition({
			id: 'clip',
			label: truncateMiddle(mark.text, 20),
			color: resolved.color,
			enter: { start: welded, duration: resolved.duration },
			enterEase: 'power1.inOut',
			setEnter: (start, duration) => {
				const target = ensureCompositionMarkTiming(state, index);
				target.duration = duration;
				if (target.cascade) writeCascadeStart(state, target.cascade, start);
				else target.start = start;
			}
		});
		bar.cascade = cascadeLinkFor(timing?.cascade, windows);
		tracks.push({
			id: createTimelineTrackId({ kind: 'mark', index }),
			label: truncateMiddle(mark.text, 20),
			color: resolved.color,
			transitions: [bar]
		});
	});
}

function appendBlockTracks(
	tracks: TimelineTrack[],
	state: EngineState,
	windows: Map<string, CascadeWindow>
): void {
	for (const word of state.surface.typeField?.words ?? []) {
		const label = truncateMiddle(word.text, 32);
		const channels = resolveKineticWordChannelKeyframes(
			word,
			state.transport.orientation
		) as ChannelTrackMap;
		const keyframes = clipKeyframes(state, channels, 0);
		tracks.push({
			id: createTimelineTrackId({ kind: 'block', blockId: word.id }),
			label,
			color: BLOCK_COLOR,
			transitions: [
				{
					id: 'clip',
					label,
					color: BLOCK_COLOR,
					start: 0,
					duration: 1,
					...(keyframes.length > 0
						? {
								keyframes,
								onKeyframeRetime: makeKeyframeRetimer(state, channels, 0),
								onKeyframeDelete: (channel: string, index: number): void => {
									const track = channels[channel];
									if (!track?.[index]) return;
									track.splice(index, 1);
									if (track.length > 0) {
										delete track[0].ease;
										return;
									}
									const orientation = state.transport.orientation;
									const orientationChannels = word.animation?.orientationOverrides?.[orientation];
									if (isKineticWordSpatialChannel(channel) && orientationChannels !== undefined) {
										delete word.animation?.orientationOverrides?.[orientation];
									} else if (word.animation?.channels) {
										delete word.animation.channels[channel as keyof typeof word.animation.channels];
									}
									if (
										word.animation?.orientationOverrides &&
										Object.keys(word.animation.orientationOverrides).length === 0
									) {
										delete word.animation.orientationOverrides;
									}
									if (
										word.animation &&
										Object.keys(word.animation.channels ?? {}).length === 0 &&
										word.animation.orientationOverrides === undefined
									) {
										delete word.animation;
									}
								}
							}
						: {})
				}
			]
		});
	}

	for (const primitive of state.surface.diagram ?? []) {
		const trackId = createTimelineTrackId({ kind: 'block', blockId: primitive.id });
		const label = diagramTrackLabel(primitive);
		const channels = primitive.animation?.channels as ChannelTrackMap | undefined;
		const cascade = primitive.animation?.cascade;
		const window = windows.get(`block:${primitive.id}`);
		const link = cascadeLinkFor(cascade, windows);

		if (channels && clipKeyframes(state, channels, 0).length > 0) {
			const clipStart = window?.startFraction ?? 0;
			const transition: TimelineTransition = {
				id: 'clip',
				label,
				color: BLOCK_COLOR,
				start: clipStart,
				duration: Math.max(window?.durationFraction ?? 0, 0.02),
				keyframes: clipKeyframes(state, channels, clipStart),
				onKeyframeRetime: makeKeyframeRetimer(state, channels, clipStart),
				onKeyframeDelete: makeKeyframeDeleter(channels),
				cascade: link
			};
			if (cascade) {
				transition.minStart = 0;
				transition.maxStart = 0.98;
				transition.onUpdate = ({ start }) => writeCascadeStart(state, cascade, start);
			} else if (primitive.enter) {
				const enter = primitive.enter;
				transition.minStart = 0;
				transition.maxStart = 0.98;
				transition.onUpdate = ({ start }) => {
					enter.start = start;
				};
			}
			tracks.push({ id: trackId, label, color: BLOCK_COLOR, transitions: [transition] });
			continue;
		}

		const isStroke = primitive.type === 'edge-arrow' || primitive.type === 'timeline-segment';
		const enter = primitive.enter;
		const displayEnter =
			enter && cascade && window
				? { start: window.startFraction, duration: enter.duration }
				: (enter ?? {
						start: window?.startFraction ?? DEFAULT_BLOCK_ENTER.start,
						duration: DEFAULT_BLOCK_ENTER.duration
					});
		const bar = buildUnifiedTimelineTransition({
			id: 'clip',
			label,
			color: BLOCK_COLOR,
			enter: displayEnter,
			exit: primitive.exit,
			enterEase: isStroke ? 'power1.inOut' : getEaseGsap(enter?.ease ?? DEFAULT_BLOCK_ENTER.ease),
			exitEase: primitive.exit ? SUGAR_OPACITY_EXIT_EASES[primitive.exit.ease] : undefined,
			setEnter: (start, duration) => {
				const target = (primitive.enter ??= { ...DEFAULT_BLOCK_ENTER });
				target.duration = duration;
				if (cascade) writeCascadeStart(state, cascade, start);
				else target.start = start;
			}
		});
		bar.cascade = link;
		tracks.push({ id: trackId, label, color: BLOCK_COLOR, transitions: [bar] });
	}

	// Five clips on the existing Block row are an authoring projection of the
	// intrinsic ChartMotion declaration, not a second runtime timeline.
	const chartItems = state.surface.chart?.items ?? [];
	for (let chartIndex = 0; chartIndex < chartItems.length; chartIndex += 1) {
		const chartItem = chartItems[chartIndex];
		const label = truncateMiddle(chartItem.title || chartItem.type, 32);
		const previousItem = chartIndex > 0 ? chartItems[chartIndex - 1] : null;
		const nextItem = chartIndex + 1 < chartItems.length ? chartItems[chartIndex + 1] : null;
		const transitions = CHART_MOTION_PHASE_NAMES.map((phaseName, phaseIndex) => {
			const phase = chartItem.motion[phaseName];
			const previousPhase =
				phaseIndex > 0 ? chartItem.motion[CHART_MOTION_PHASE_NAMES[phaseIndex - 1]] : null;
			const nextPhase =
				phaseIndex + 1 < CHART_MOTION_PHASE_NAMES.length
					? chartItem.motion[CHART_MOTION_PHASE_NAMES[phaseIndex + 1]]
					: null;
			const minimumStart = previousPhase
				? previousPhase.start + previousPhase.duration
				: previousItem
					? previousItem.motion.exit.start + previousItem.motion.exit.duration
					: 0;
			const maximumEnd = nextPhase ? nextPhase.start : (nextItem?.motion.entry.start ?? 1);
			return {
				id: phaseName,
				label: phaseName,
				color: BLOCK_COLOR,
				start: phase.start,
				duration: phase.duration,
				minStart: minimumStart,
				maxStart: Math.max(minimumStart, maximumEnd - phase.duration),
				minDuration: Number.EPSILON,
				maxDuration: Math.max(Number.EPSILON, maximumEnd - phase.start),
				onUpdate: ({ start, duration }: { start: number; duration: number }) => {
					if (
						!Number.isFinite(start) ||
						!Number.isFinite(duration) ||
						duration <= 0 ||
						start + CHART_TIMING_EPSILON < minimumStart ||
						start + duration > maximumEnd + CHART_TIMING_EPSILON
					) {
						return;
					}
					phase.start = start;
					phase.duration = duration;
				}
			};
		});
		tracks.push({
			id: createTimelineTrackId({ kind: 'block', blockId: chartItem.id }),
			label,
			color: BLOCK_COLOR,
			transitions
		});
	}

	for (const primitive of state.surface.diagram ?? []) {
		if (primitive.type !== 'stat-callout') continue;
		tracks.push({
			id: createTimelineTrackId({
				kind: 'block-subtrack',
				blockId: primitive.id,
				subtrack: { kind: 'roll' }
			}),
			label: 'count roll',
			color: BLOCK_COLOR,
			transitions: [
				{
					id: 'roll',
					label: 'count',
					start: primitive.rollStart ?? primitive.enter?.start ?? DEFAULT_BLOCK_ENTER.start,
					duration: primitive.rollWindow ?? 0.5,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: 0.05,
					maxDuration: 1,
					onUpdate: ({ start, duration }) => {
						primitive.rollStart = start;
						primitive.rollWindow = Math.min(1, duration);
					}
				}
			]
		});
	}
}

function appendOverlayTracks(
	tracks: TimelineTrack[],
	state: EngineState,
	windows: Map<string, CascadeWindow>
): void {
	state.overlays.forEach((overlay) => {
		const trackId = createTimelineTrackId({ kind: 'overlay', overlayId: overlay.id });
		const channels = overlay.animation?.channels;
		const cascade = overlay.animation?.cascade;
		const window = windows.get(`overlay:${overlay.id}`);
		const link = cascadeLinkFor(cascade, windows);

		if (channels && clipKeyframes(state, channels, 0).length > 0) {
			const clipStart = window?.startFraction ?? 0;
			const transition: TimelineTransition = {
				id: 'clip',
				label: overlay.type,
				color: OVERLAY_COLOR,
				start: clipStart,
				duration: Math.max(window?.durationFraction ?? 0, 0.02),
				keyframes: clipKeyframes(state, channels, clipStart),
				onKeyframeRetime: makeKeyframeRetimer(state, channels, clipStart),
				onKeyframeDelete: makeKeyframeDeleter(channels),
				cascade: link
			};
			if (cascade) {
				transition.minStart = 0;
				transition.maxStart = 0.98;
				transition.onUpdate = ({ start }) => writeCascadeStart(state, cascade, start);
			} else if (overlay.enter) {
				const enter = overlay.enter;
				transition.minStart = 0;
				transition.maxStart = 0.98;
				transition.onUpdate = ({ start }) => {
					enter.start = start;
				};
			}
			tracks.push({
				id: trackId,
				label: overlay.type,
				color: OVERLAY_COLOR,
				transitions: [transition]
			});
			return;
		}

		if (!overlay.enter && !overlay.exit) {
			tracks.push({ id: trackId, label: overlay.type, color: OVERLAY_COLOR, transitions: [] });
			return;
		}
		const bar = buildUnifiedTimelineTransition({
			id: 'clip',
			label: overlay.type,
			color: OVERLAY_COLOR,
			enter:
				overlay.enter && cascade && window
					? { start: window.startFraction, duration: overlay.enter.duration }
					: overlay.enter,
			exit: overlay.exit,
			enterEase: overlay.enter ? getEaseGsap(overlay.enter.ease) : undefined,
			exitEase: overlay.exit ? getEaseGsap(overlay.exit.ease) : undefined,
			setEnter:
				overlay.enter && cascade
					? (start, duration) => {
							overlay.enter!.duration = duration;
							writeCascadeStart(state, cascade, start);
						}
					: undefined
		});
		bar.cascade = link;
		tracks.push({
			id: trackId,
			label: overlay.type,
			color: OVERLAY_COLOR,
			transitions: [bar]
		});
	});
}

function appendOverlaySubtracks(tracks: TimelineTrack[], state: EngineState): void {
	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'tweet-stack') return;
		const content = overlay.content as { pileStart?: number; pileWindow?: number };
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'pile' }
			}),
			label: 'tweet pile',
			color: '#1d9bf0',
			transitions: [
				{
					id: 'pile',
					label: 'pile up',
					start: content.pileStart ?? 0.08,
					duration: content.pileWindow ?? 0.52,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.92,
					minDuration: 0.08,
					maxDuration: 0.8,
					onUpdate: ({ start, duration }) => {
						content.pileStart = start;
						content.pileWindow = Math.min(1 - start, duration);
					}
				}
			]
		});
	});

	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'instance-stack') return;
		const content = overlay.content as { staggerStart?: number; lagWindow?: number };
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'stack' }
			}),
			label: 'stack stagger',
			color: '#9db0c9',
			transitions: [
				{
					id: 'stagger',
					label: 'stack',
					start: content.staggerStart ?? 0,
					duration: content.lagWindow ?? 0.4,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: 0.02,
					maxDuration: 0.9,
					onUpdate: ({ start, duration }) => {
						content.staggerStart = start;
						content.lagWindow = Math.min(1, duration);
					}
				}
			]
		});
	});

	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'counter') return;
		const content = overlay.content as { rollStart?: number; rollWindow?: number };
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'roll' }
			}),
			label: 'count roll',
			color: OVERLAY_COLOR,
			transitions: [
				{
					id: 'roll',
					label: 'count',
					start: content.rollStart ?? 0,
					duration: content.rollWindow ?? 0.78,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: 0.05,
					maxDuration: 1,
					onUpdate: ({ start, duration }) => {
						content.rollStart = start;
						content.rollWindow = Math.min(1, duration);
					}
				}
			]
		});
	});

	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'youtube-subscribe' && overlay.type !== 'instagram-follow') return;
		const content = overlay.content as { beat?: number };
		const beatWidth = Math.min(0.2, 0.79 / state.transport.durationSeconds);
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'beat' }
			}),
			label: 'press beat',
			color: '#e6322a',
			transitions: [
				{
					id: 'beat',
					label: 'press',
					start: content.beat ?? 0.42,
					duration: beatWidth,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: beatWidth,
					maxDuration: beatWidth,
					onUpdate: ({ start }) => {
						content.beat = Math.round(clampNumber(start, 0, 1) * 10000) / 10000;
					}
				}
			]
		});
	});

	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'achievement') return;
		const content = overlay.content as AchievementContent;
		const variantId = content.variant ?? 'checklist-complete';
		if (!isAchievementVariantId(variantId)) return;
		const focalWidth = Math.min(
			0.2,
			ACHIEVEMENT_VARIANTS[variantId].focalDurationMs / (state.transport.durationSeconds * 1000)
		);
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'beat' }
			}),
			label: 'completion beat',
			color: '#3fae52',
			transitions: [
				{
					id: 'beat',
					label: variantId === 'unlocked' ? 'unlock' : 'complete',
					start: content.beat ?? 0.3375,
					duration: focalWidth,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: focalWidth,
					maxDuration: focalWidth,
					onUpdate: ({ start }) => setAchievementBeat(content, start)
				}
			]
		});
	});
}

function appendCaptionsTrack(tracks: TimelineTrack[], state: EngineState): void {
	const captions = state.captions;
	if (!captions || captions.cues.length === 0) return;
	const durationMs = state.transport.durationSeconds * 1000;
	tracks.push({
		id: createTimelineTrackId({ kind: 'captions' }),
		label: 'Captions',
		color: captions.accent ?? '#ffd608',
		transitions: captions.cues.map((cue) => ({
			id: cue.id,
			label: truncateMiddle(cue.text, 16),
			start: cue.startMs / durationMs,
			duration: Math.max((cue.endMs - cue.startMs) / durationMs, 0.004),
			ramp: 'in',
			minStart: 0,
			maxStart: 0.995,
			minDuration: 0.004,
			maxDuration: 1,
			onUpdate: ({ start, duration }) => {
				cue.startMs = Math.round(start * durationMs);
				cue.endMs = Math.round((start + duration) * durationMs);
			}
		}))
	});
}

function appendSpecialOverlayTracks(tracks: TimelineTrack[], state: EngineState): void {
	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'text-3d') return;
		const content = overlay.content as { spinStart?: number; spinWindow?: number };
		tracks.push({
			id: createTimelineTrackId({
				kind: 'overlay-subtrack',
				overlayId: overlay.id,
				subtrack: { kind: 'spin' }
			}),
			label: 'spin in',
			color: OVERLAY_COLOR,
			transitions: [
				{
					id: 'spin',
					label: 'spin',
					start: content.spinStart ?? 0,
					duration: content.spinWindow ?? 0.42,
					ramp: 'in',
					minStart: 0,
					maxStart: 0.95,
					minDuration: 0.05,
					maxDuration: 1,
					onUpdate: ({ start, duration }) => {
						content.spinStart = start;
						content.spinWindow = Math.min(1, duration);
					}
				}
			]
		});
	});

	state.overlays.forEach((overlay) => {
		if (overlay.type !== 'cursor-trail') return;
		const path = (overlay.content as { path?: CursorPath[] }).path ?? [];
		const schedule = buildCursorSchedule(path);
		const totalMs = schedule.totalMs;
		for (const dwell of schedule.dwells) {
			const step = path[dwell.index];
			if (!step) continue;
			tracks.push({
				id: createTimelineTrackId({
					kind: 'overlay-subtrack',
					overlayId: overlay.id,
					subtrack: { kind: 'cursor', index: dwell.index }
				}),
				label: `↳ ${dwell.targetSlot}`,
				color: '#62788f',
				transitions: [
					{
						id: 'dwell',
						label: 'dwell',
						start: dwell.arrivalFraction,
						duration: Math.max(dwell.durationFraction, 0.015),
						ramp: 'in',
						minStart: 0,
						maxStart: dwell.hasGlide ? 0.98 : 0,
						minDuration: 0,
						maxDuration: 1,
						onUpdate: ({ start, duration }) => {
							step.dwellMs = Math.max(0, duration * totalMs);
							if (dwell.hasGlide) {
								step.travelMs = Math.max(0, start * totalMs - dwell.glideStartMs);
							}
						}
					}
				]
			});
		}
	});
}

function appendTextAnimationTracks(
	tracks: TimelineTrack[],
	state: EngineState,
	windows: Map<string, CascadeWindow>
): void {
	state.textAnimations.forEach((entry) => {
		const targetLabel =
			entry.target.kind === 'surface'
				? `T · ${entry.target.slot}`
				: `T · ${entry.target.overlayId}.${entry.target.slot}`;
		const label = `${targetLabel} · ${entry.effect}`;
		const spec = TEXT_EFFECT_CATALOG.get(entry.effect);
		const cascade = entry.cascade;
		const welded = cascade ? windows.get(`textAnimation:${entry.id}`)?.startFraction : undefined;
		const bar = buildUnifiedTimelineTransition({
			id: 'clip',
			label,
			color: TEXT_ANIMATION_COLOR,
			enter: welded !== undefined ? { start: welded, duration: entry.enter.duration } : entry.enter,
			exit: entry.exit,
			enterLandFrac: spec ? textAnimationLandingFraction(spec.target, spec.enter) : 1,
			exitLandFrac: spec?.exit ? textAnimationLandingFraction(spec.target, spec.exit) : 1,
			setEnter: cascade
				? (start, duration) => {
						entry.enter.duration = duration;
						writeCascadeStart(state, cascade, start);
					}
				: undefined
		});
		bar.cascade = cascadeLinkFor(cascade, windows);
		tracks.push({
			id: createTimelineTrackId({ kind: 'text-animation', textAnimationId: entry.id }),
			label,
			color: TEXT_ANIMATION_COLOR,
			transitions: [bar]
		});
	});
}

function appendMessageTracks(tracks: TimelineTrack[], state: EngineState): void {
	if (state.surface.type !== 'imessage') return;
	(state.surface.content.messages ?? []).forEach((message, index) => {
		const timing = messageEnter(message, index);
		const typing = messageTyping(message, index);
		const label = truncateMiddle(annotationBodyPlainText(message.text), 18) || '…';
		const leadInStart = typing ? typing.start : timing.start;
		const bubbleLanded = timing.start + timing.duration;
		const leadInSpan = bubbleLanded - leadInStart;
		const enterLandFrac =
			leadInSpan > 0
				? (timing.start - leadInStart + timing.duration * easeLandingFraction('back.out')) /
					leadInSpan
				: 1;
		tracks.push({
			id: createTimelineTrackId({ kind: 'surface-message', index }),
			label,
			color: message.from === 'me' ? '#0a84ff' : '#8e8e93',
			transitions: [
				buildUnifiedTimelineTransition({
					id: 'clip',
					label,
					color: message.from === 'me' ? '#0a84ff' : '#8e8e93',
					enter: { start: leadInStart, duration: Math.max(0.02, bubbleLanded - leadInStart) },
					enterLandFrac,
					setEnter: (start, duration) => {
						const slideIn = message.enter?.duration ?? timing.duration;
						if (typing) {
							const typingDuration = Math.max(0.01, duration - slideIn);
							message.typing = { duration: typingDuration };
							message.enter = {
								start: start + typingDuration,
								duration: slideIn,
								ease: message.enter?.ease
							};
						} else {
							message.enter = { start, duration, ease: message.enter?.ease };
						}
					}
				})
			]
		});
	});
}

function appendSoundTrack(tracks: TimelineTrack[], state: EngineState): void {
	const transitions: TimelineTransition[] = [];
	for (const cue of deriveSoundCues(state)) {
		const reference: SoundRailReference = { kind: 'derived', cueId: cue.id };
		transitions.push({
			id: createSoundRailReferenceId(reference),
			label: cue.event,
			start: cue.start,
			duration: 0.012,
			ramp: 'in',
			color: isAudibleSoundCue(cue) ? SOUND_CUE_COLOR : '#5c6773',
			soundReference: reference,
			soundAssetSlug: resolveCueSample(cue) ?? undefined
		});
	}
	state.audioCues.forEach((cue, index) => {
		const reference: SoundRailReference = { kind: 'manual', cueId: cue.id };
		transitions.push({
			id: createSoundRailReferenceId(reference),
			label: cue.kind === 'bed' ? `bed · ${cue.assetSlug}` : cue.assetSlug,
			start: cue.start,
			duration: Math.max(0.015, cue.duration),
			ramp: 'in',
			color: cue.kind === 'bed' ? '#3f7d78' : SOUND_CUE_COLOR,
			minStart: 0,
			maxStart: 0.98,
			minDuration: 0.01,
			maxDuration: 1,
			soundReference: reference,
			soundAssetSlug: cue.assetSlug,
			onUpdate: ({ start, duration }) => {
				const target = state.audioCues[index];
				target.start = start;
				target.duration = Math.min(1, duration);
			}
		});
	});
	if (transitions.length > 0) {
		tracks.push({
			id: createTimelineTrackId({ kind: 'sound' }),
			label: 'Sound',
			color: SOUND_CUE_COLOR,
			transitions
		});
	}
}

function appendVideoTrack(tracks: TimelineTrack[], state: EngineState): void {
	const assetNames = new Map(state.media.assets.map((asset) => [asset.id, asset.name]));
	const videoTrack: VideoTimelineTrack = {
		kind: 'video',
		id: createTimelineTrackId({ kind: 'video' }),
		label: 'Video',
		isRemovable: false,
		clips: state.media.videoTrack.clips.map((clip) => {
			const assetName = assetNames.get(clip.assetId);
			if (assetName === undefined) {
				throw new Error(
					`Video clip "${clip.id}" references missing Media entry "${clip.assetId}".`
				);
			}
			return {
				id: createVideoClipSelectionId(clip.id),
				clipId: clip.id,
				assetId: clip.assetId,
				label: assetName,
				timelineStartFrame: clip.timelineStartFrame,
				durationFrames: clip.durationFrames,
				sourceStartSeconds: clip.sourceStartSeconds,
				audio: { ...clip.audio }
			};
		}),
		transitions: []
	};
	tracks.push(videoTrack);
}

/**
 * The stage rows (ADR-0060), at the head of the outline while the stage is
 * on: the Camera row whose one clip is the travel of the camera the current
 * frame films through (the vertical travel under a vertical frame, when one
 * is authored — the same resolution the renderer makes), the Focus row whose
 * clip is the rack focus, and one row per body whose clip is its presence.
 * A row without its clip still stands, so the entity stays selectable.
 */
function appendStageTracks(tracks: TimelineTrack[], state: EngineState): void {
	const stage = state.stage;
	if (!stage || stage.type !== 'depth') return;
	const camera = resolveStageCameraForOrientation(stage.camera, state.transport.orientation);
	const travel = camera.travel;
	tracks.push({
		id: createTimelineTrackId({ kind: 'stage-camera' }),
		label: 'Camera',
		color: STAGE_COLOR,
		transitions: travel
			? [
					{
						id: 'travel',
						label: 'travel',
						start: travel.start,
						duration: travel.duration,
						ramp: 'in',
						...STAGE_WINDOW_LIMITS,
						onUpdate: ({ start, duration }) => {
							travel.start = start;
							travel.duration = Math.min(1, duration);
						}
					}
				]
			: []
	});
	const pull = stage.focus.pull;
	tracks.push({
		id: createTimelineTrackId({ kind: 'stage-focus' }),
		label: 'Focus',
		color: STAGE_COLOR,
		transitions: pull
			? [
					{
						id: 'pull',
						label: 'rack',
						start: pull.start,
						duration: pull.duration,
						ramp: 'in',
						...STAGE_WINDOW_LIMITS,
						onUpdate: ({ start, duration }) => {
							pull.start = start;
							pull.duration = Math.min(1, duration);
						}
					}
				]
			: []
	});
	if (stage.screen) {
		tracks.push({
			id: createTimelineTrackId({ kind: 'stage-body', bodyId: STAGE_SCREEN_BODY_ID }),
			label: getStageModel(stage.screen.model)?.label ?? stage.screen.model,
			color: STAGE_COLOR,
			transitions: [{ id: 'presence', label: 'on stage', start: 0, duration: 1 }]
		});
	}
}

/**
 * Build timeline rows in their canonical visual order. Returned transitions
 * contain the authored write-back closures consumed by TimelineOutline; no row
 * identity is inferred from string suffixes.
 */
export function buildCompositionTimelineTracks(
	state: EngineState,
	appearance: CompositionTimelineAppearance
): TimelineTrack[] {
	const tracks: TimelineTrack[] = [];
	const windows = resolveCascadeTimings(state);
	const surfaceColor = appearance.paperColor;
	const surfaceTrackColor = isDarkSurfaceColor(appearance.paperColor)
		? appearance.inkColor
		: surfaceColor;

	appendStageTracks(tracks, state);
	appendSurfaceTrack(tracks, state, surfaceTrackColor, windows);
	const strikeColor = resolveMarkForIndex(
		'strike',
		state.marks.timings.length,
		state.marks,
		appearance.resolveMarkColor('strike')
	).color;
	appendChecklistTracks(tracks, state, surfaceTrackColor, strikeColor);
	appendMarkTracks(tracks, state, appearance, windows);
	appendBlockTracks(tracks, state, windows);
	appendOverlayTracks(tracks, state, windows);
	appendOverlaySubtracks(tracks, state);
	appendCaptionsTrack(tracks, state);
	appendSpecialOverlayTracks(tracks, state);
	appendTextAnimationTracks(tracks, state, windows);
	appendMessageTracks(tracks, state);
	appendVideoTrack(tracks, state);
	appendSoundTrack(tracks, state);
	return tracks;
}
