import { resolveMarkForIndex, type Preset } from './engine-schema';
import { listSurfaceMarkInstances } from './surface-mark-instances';
import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { deterministicFrameAddressFor } from '../utils/deterministic-render-measurements';
import { listKineticTypeCriticalMoments } from '../utils/kinetic-type-critical-moments';

export interface DeterministicRenderCheckpointSample {
	kind: 'checkpoint';
	sampleId: string;
	frameIndex: number;
	timestampMicroseconds: number;
	auxiliaryFrameIndices: readonly number[];
	stableGeometryCandidateIds: readonly string[];
}

export interface DeterministicRenderTransitionSample {
	kind: 'transition-window';
	sampleId: string;
	transitionId: string;
	frameIndex: number;
	timestampMicroseconds: number;
	auxiliaryFrameIndices: readonly number[];
	stableGeometryCandidateIds: readonly string[];
}

export type DeterministicRenderSamplePlanEntry =
	DeterministicRenderCheckpointSample | DeterministicRenderTransitionSample;

export interface DeterministicRenderSamplePlan {
	frameRate: { num: number; den: number };
	frameCount: number;
	samples: readonly DeterministicRenderSamplePlanEntry[];
}

const CHECKPOINTS = [
	{ id: 'checkpoint:opening', progress: 0 },
	{ id: 'checkpoint:quarter', progress: 0.25 },
	{ id: 'checkpoint:middle', progress: 0.5 },
	{ id: 'checkpoint:three-quarter', progress: 0.75 },
	{ id: 'checkpoint:closing', progress: 1 }
] as const;

const FOCAL_MARK_STYLES = new Set(['magnify', 'lift-out', 'tear-out', 'isolate']);

function uniqueOrderedFrames(frames: readonly number[], maximumFrame: number): number[] {
	return [...new Set(frames.map((frame) => Math.max(0, Math.min(maximumFrame, frame))))].sort(
		(left, right) => left - right
	);
}

function stableGeometryCandidates(preset: Preset, excludedOwnerId?: string): string[] {
	return [
		'composition-root',
		'overlay-root',
		...preset.state.overlays.map((overlay) => `overlay:${overlay.id}`)
	]
		.filter((identity) => identity !== excludedOwnerId)
		.sort((left, right) => left.localeCompare(right));
}

/** Fixed, frame-addressed policy shared by matrix inventory and capture. */
export function deriveDeterministicRenderSamplePlan(preset: Preset): DeterministicRenderSamplePlan {
	const frameRate = resolveFrameRate(preset.state.transport.fps);
	const frameCount = Math.max(
		1,
		secondsToFrames(preset.state.transport.durationSeconds, frameRate)
	);
	const maximumFrame = frameCount - 1;
	const checkpointFrames = new Set<number>();
	const samples: DeterministicRenderSamplePlanEntry[] = [];
	for (const checkpoint of CHECKPOINTS) {
		const frameIndex = Math.round(checkpoint.progress * maximumFrame);
		if (checkpointFrames.has(frameIndex)) continue;
		checkpointFrames.add(frameIndex);
		const address = deterministicFrameAddressFor(frameIndex, frameRate);
		samples.push({
			kind: 'checkpoint',
			sampleId: checkpoint.id,
			...address,
			auxiliaryFrameIndices: [frameIndex],
			stableGeometryCandidateIds: stableGeometryCandidates(preset)
		});
	}

	for (const [markIndex, mark] of listSurfaceMarkInstances(preset.state.surface).entries()) {
		if (!FOCAL_MARK_STYLES.has(mark.style)) continue;
		const timing = resolveMarkForIndex(mark.style, markIndex, preset.state.marks);
		const authoredWindow = mark.window && mark.window !== 'static' ? mark.window : timing;
		const startFrame = Math.round(authoredWindow.start * maximumFrame);
		const endFrame = Math.round((authoredWindow.start + authoredWindow.duration) * maximumFrame);
		const auxiliaryFrameIndices = uniqueOrderedFrames(
			[startFrame, Math.round((startFrame + endFrame) / 2), endFrame],
			maximumFrame
		);
		const frameIndex =
			auxiliaryFrameIndices[Math.floor(auxiliaryFrameIndices.length / 2)] ?? startFrame;
		const transitionId = `mark:${mark.slot ?? mark.itemIndex ?? 'body'}:${mark.startChar}-${mark.endChar}:${mark.style}`;
		const address = deterministicFrameAddressFor(frameIndex, frameRate);
		samples.push({
			kind: 'transition-window',
			sampleId: `transition:${transitionId}`,
			transitionId,
			...address,
			auxiliaryFrameIndices,
			stableGeometryCandidateIds: stableGeometryCandidates(preset, transitionId)
		});
	}

	// Kinetic Type (ADR-0064): every Motion Beat, and each word's keyframe
	// envelopes at start, middle, and end. The first frame at or after a
	// millisecond is the frame on which that value has been reached.
	const frameAtOrAfter = (atMs: number): number =>
		Math.max(0, Math.ceil((atMs / 1000) * (frameRate.num / frameRate.den) - 1e-6));
	for (const moment of listKineticTypeCriticalMoments(
		preset.state.surface.typeField,
		preset.state.motionBeats
	)) {
		const startFrame = frameAtOrAfter(moment.startMs);
		const endFrame = frameAtOrAfter(moment.endMs);
		const auxiliaryFrameIndices = uniqueOrderedFrames(
			moment.kind === 'beat'
				? [startFrame]
				: [startFrame, Math.round((startFrame + endFrame) / 2), endFrame],
			maximumFrame
		);
		const frameIndex =
			auxiliaryFrameIndices[Math.floor(auxiliaryFrameIndices.length / 2)] ?? startFrame;
		const address = deterministicFrameAddressFor(frameIndex, frameRate);
		samples.push({
			kind: 'transition-window',
			sampleId: `transition:${moment.id}`,
			transitionId: moment.id,
			...address,
			auxiliaryFrameIndices,
			stableGeometryCandidateIds: stableGeometryCandidates(preset)
		});
	}

	return {
		frameRate: { num: frameRate.num, den: frameRate.den },
		frameCount,
		samples
	};
}
