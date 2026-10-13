import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { VideoClip } from '$lib/platform/engine-schema';

import { framesToSeconds, resolveFrameRate } from './composition-timing.ts';
import {
	createVideoClipDragOrigin,
	resolveVideoClipDrag,
	resolveVideoClipDrop,
	snapVideoClipFrame
} from './video-clip-edit.ts';

const RATE_30 = resolveFrameRate(30);

function videoClip(overrides: Partial<VideoClip> = {}): VideoClip {
	return {
		id: 'selected',
		assetId: 'camera',
		timelineStartFrame: 100,
		durationFrames: 60,
		sourceStartSeconds: 4,
		audio: { enabled: true, gain: 0.8 },
		...overrides
	};
}

describe('Video clip frame snapping', () => {
	it('snaps to exact integer frames and resolves equal-distance ties earlier', () => {
		assert.equal(
			snapVideoClipFrame(105, 0, 200, { targetFrames: [110, 100], thresholdFrames: 5 }),
			100
		);
		assert.equal(
			snapVideoClipFrame(104.6, 0, 200, { targetFrames: [105], thresholdFrames: 0 }),
			105
		);
	});
});

describe('Video clip drag math', () => {
	const clips = [
		videoClip({ id: 'previous', timelineStartFrame: 20, durationFrames: 40 }),
		videoClip(),
		videoClip({ id: 'next', timelineStartFrame: 190, durationFrames: 30 })
	];

	function origin(sourceDurationSeconds = 20) {
		return createVideoClipDragOrigin({
			clips,
			clipId: 'selected',
			compositionFrameCount: 300,
			sourceDurationSeconds,
			frameRate: RATE_30
		});
	}

	it('moves only timelineStartFrame and clamps against both half-open neighbors', () => {
		const dragOrigin = origin();
		const left = resolveVideoClipDrag(dragOrigin, 'move', -100);
		const right = resolveVideoClipDrag(dragOrigin, 'move', 100);
		assert.deepEqual(left, videoClip({ timelineStartFrame: 60 }));
		assert.deepEqual(right, videoClip({ timelineStartFrame: 130 }));

		const repeatedPointerUpdate = resolveVideoClipDrag(dragOrigin, 'move', 20);
		assert.equal(repeatedPointerUpdate.timelineStartFrame, 120);
		assert.equal(dragOrigin.clip.timelineStartFrame, 100);
		assert.equal(clips[1].timelineStartFrame, 100);
	});

	it('snaps either moving edge to a neighbor frame with deterministic ties', () => {
		const moved = resolveVideoClipDrag(origin(), 'move', 27, {
			targetFrames: [128, 188],
			thresholdFrames: 2
		});
		assert.equal(moved.timelineStartFrame, 128);
		assert.equal(moved.timelineStartFrame + moved.durationFrames, 188);
	});

	it('left trim changes timeline start, duration, and Source start by the same frame delta', () => {
		const trimmed = resolveVideoClipDrag(origin(), 'trim-left', -30);
		assert.equal(trimmed.timelineStartFrame, 70);
		assert.equal(trimmed.durationFrames, 90);
		assert.equal(trimmed.sourceStartSeconds, 3);
		assert.deepEqual(trimmed.audio, clips[1].audio);

		const clamped = resolveVideoClipDrag(origin(), 'trim-left', 100);
		assert.equal(clamped.timelineStartFrame, 159);
		assert.equal(clamped.durationFrames, 1);
		assert.equal(clamped.sourceStartSeconds, 4 + 59 / 30);
	});

	it('left trim cannot extend farther than available Source frames', () => {
		const sourceLimitedClip = videoClip({ sourceStartSeconds: 1 });
		const dragOrigin = createVideoClipDragOrigin({
			clips: [sourceLimitedClip],
			clipId: sourceLimitedClip.id,
			compositionFrameCount: 300,
			sourceDurationSeconds: 20,
			frameRate: RATE_30
		});
		const trimmed = resolveVideoClipDrag(dragOrigin, 'trim-left', -100);
		assert.equal(trimmed.timelineStartFrame, 70);
		assert.equal(trimmed.durationFrames, 90);
		assert.equal(trimmed.sourceStartSeconds, 0);
	});

	it('right trim changes only duration and clamps to source, composition, and next clip', () => {
		const trimmed = resolveVideoClipDrag(origin(6), 'trim-right', 100);
		assert.equal(trimmed.durationFrames, 60);
		assert.equal(trimmed.timelineStartFrame, 100);
		assert.equal(trimmed.sourceStartSeconds, 4);

		const extended = resolveVideoClipDrag(origin(), 'trim-right', 25, {
			targetFrames: [188],
			thresholdFrames: 3
		});
		assert.equal(extended.durationFrames, 88);
	});

	it('right trim independently clamps to composition and neighboring clips', () => {
		const compositionClip = videoClip();
		const compositionOrigin = createVideoClipDragOrigin({
			clips: [compositionClip],
			clipId: compositionClip.id,
			compositionFrameCount: 180,
			sourceDurationSeconds: 20,
			frameRate: RATE_30
		});
		assert.equal(resolveVideoClipDrag(compositionOrigin, 'trim-right', 100).durationFrames, 80);

		const neighborOrigin = origin();
		assert.equal(resolveVideoClipDrag(neighborOrigin, 'trim-right', 100).durationFrames, 90);
	});

	it('slips only Source time and preserves exact NTSC frame deltas', () => {
		const rate = resolveFrameRate(29.97);
		const ntscClip = videoClip({ durationFrames: 300, sourceStartSeconds: 10 });
		const dragOrigin = createVideoClipDragOrigin({
			clips: [ntscClip],
			clipId: ntscClip.id,
			compositionFrameCount: 600,
			sourceDurationSeconds: 30,
			frameRate: rate
		});
		const slipped = resolveVideoClipDrag(dragOrigin, 'slip', 17);
		assert.equal(slipped.sourceStartSeconds, 10 + framesToSeconds(17, rate));
		assert.equal(slipped.timelineStartFrame, ntscClip.timelineStartFrame);
		assert.equal(slipped.durationFrames, ntscClip.durationFrames);

		const clamped = resolveVideoClipDrag(dragOrigin, 'slip', -1000);
		assert.ok(clamped.sourceStartSeconds >= 0);
		assert.ok(clamped.sourceStartSeconds < framesToSeconds(1, rate));
	});

	it('preserves exact NTSC source capacity and clamps positive slips at the Source end', () => {
		const rate = resolveFrameRate(29.97);
		const sourceStartSeconds = 4.25;
		const exactSourceDuration = sourceStartSeconds + framesToSeconds(300, rate);
		const ntscClip = videoClip({ durationFrames: 299, sourceStartSeconds });
		const dragOrigin = createVideoClipDragOrigin({
			clips: [ntscClip],
			clipId: ntscClip.id,
			compositionFrameCount: 600,
			sourceDurationSeconds: exactSourceDuration,
			frameRate: rate
		});
		assert.equal(resolveVideoClipDrag(dragOrigin, 'trim-right', 1).durationFrames, 300);
		assert.equal(resolveVideoClipDrag(dragOrigin, 'trim-right', 2).durationFrames, 300);

		const slipped = resolveVideoClipDrag(dragOrigin, 'slip', 10);
		assert.equal(slipped.sourceStartSeconds, sourceStartSeconds + framesToSeconds(1, rate));
	});
});

describe('Video clip drop math', () => {
	it('inserts clips into the nearest legal gap without ripple or overlap', () => {
		const existing = [
			videoClip({ id: 'a', timelineStartFrame: 0, durationFrames: 40 }),
			videoClip({ id: 'b', timelineStartFrame: 100, durationFrames: 40 })
		];
		const dropped = resolveVideoClipDrop({
			clips: existing,
			clip: videoClip({ id: 'new', timelineStartFrame: 30, durationFrames: 30 }),
			compositionFrameCount: 180,
			sourceDurationSeconds: 20,
			frameRate: RATE_30
		});
		assert.ok(dropped);
		assert.deepEqual(
			dropped.map((clip) => [clip.id, clip.timelineStartFrame, clip.durationFrames]),
			[
				['a', 0, 40],
				['new', 40, 30],
				['b', 100, 40]
			]
		);
		assert.equal(existing.length, 2);
	});

	it('clamps new duration to composition and Source coverage and returns null when no gap fits', () => {
		const sourceClamped = resolveVideoClipDrop({
			clips: [],
			clip: videoClip({ id: 'new', timelineStartFrame: 0, durationFrames: 100 }),
			compositionFrameCount: 80,
			sourceDurationSeconds: 5,
			frameRate: RATE_30
		});
		assert.ok(sourceClamped);
		assert.equal(sourceClamped[0].durationFrames, 30);

		const noGap = resolveVideoClipDrop({
			clips: [videoClip({ id: 'full', timelineStartFrame: 0, durationFrames: 80 })],
			clip: videoClip({ id: 'new', timelineStartFrame: 40, durationFrames: 1 }),
			compositionFrameCount: 80,
			sourceDurationSeconds: 20,
			frameRate: RATE_30
		});
		assert.equal(noGap, null);
	});

	it('snaps drops to exact targets and permits clips to touch at half-open edges', () => {
		const dropped = resolveVideoClipDrop({
			clips: [videoClip({ id: 'later', timelineStartFrame: 90, durationFrames: 30 })],
			clip: videoClip({ id: 'new', timelineStartFrame: 58, durationFrames: 30 }),
			compositionFrameCount: 150,
			sourceDurationSeconds: 20,
			frameRate: RATE_30,
			snap: { targetFrames: [60, 90], thresholdFrames: 2 }
		});
		assert.ok(dropped);
		assert.equal(dropped[0].timelineStartFrame, 60);
		assert.equal(dropped[0].timelineStartFrame + dropped[0].durationFrames, 90);
	});

	it('resolves equal-distance legal drop positions to the earlier gap', () => {
		const dropped = resolveVideoClipDrop({
			clips: [videoClip({ id: 'center', timelineStartFrame: 50, durationFrames: 50 })],
			clip: videoClip({ id: 'new', timelineStartFrame: 70, durationFrames: 10 }),
			compositionFrameCount: 150,
			sourceDurationSeconds: 20,
			frameRate: RATE_30
		});
		assert.ok(dropped);
		assert.equal(dropped[0].id, 'new');
		assert.equal(dropped[0].timelineStartFrame, 40);
	});
});
