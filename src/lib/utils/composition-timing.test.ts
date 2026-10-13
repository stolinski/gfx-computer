import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { EngineState } from '$lib/platform/engine-schema';
import {
	dropTimecodeToFrames,
	formatFrameRateRational,
	framesToDropTimecode,
	framesToSeconds,
	framesToTimecode,
	isDropTimecode,
	isNonDropTimecode,
	rescaleCompositionTimings,
	resolveFrameRate,
	secondsToFrames,
	timecodeToFrames
} from './composition-timing.ts';

// Minimal EngineState carrying one of each fraction-timed window plus an
// absolute (keyframe atMs) one, enough to prove the rescale preserves absolute
// time and leaves absolute timing alone.
function makeState(): EngineState {
	return {
		transport: { orientation: 'horizontal', durationSeconds: 6, fps: 30, format: 'webm' },
		marks: { defaults: {}, timings: [{ start: 0.5, duration: 0.2, ease: 'smooth' }] },
		surface: {
			type: 'checklist',
			content: {
				body: [],
				items: [
					{ text: 'a', checked: false, enter: { start: 0.4, duration: 0.1, ease: 'settled' } },
					{ text: 'b', checked: true, strike: { start: 0.6, duration: 0.1, ease: 'sharp' } }
				]
			},
			enter: { start: 0, duration: 0.05, ease: 'settled' },
			// An absolute keyframe channel — must NOT be rescaled.
			animation: { channels: { opacity: [{ atMs: 0, value: 0 }, { atMs: 300, value: 1 }] } }
		},
		textAnimations: [],
		overlays: [],
		effects: [],
		audioCues: []
	} as unknown as EngineState;
}

describe('rescaleCompositionTimings', () => {
	it('preserves absolute time when the clip duration changes', () => {
		const state = makeState();
		// 6s → 30s: factor = 6/30 = 0.2. A window at fraction f keeps f × 6s = (f×0.2) × 30s.
		rescaleCompositionTimings(state, 6 / 30);

		assert.equal(state.surface.enter!.duration, 0.05 * 0.2, 'surface enter duration rescaled');
		assert.equal(state.marks.timings[0].start, 0.5 * 0.2, 'mark start rescaled');
		assert.equal(state.marks.timings[0].duration, 0.2 * 0.2, 'mark duration rescaled');
		assert.equal(state.surface.content.items![0].enter!.start, 0.4 * 0.2, 'item enter rescaled');
		assert.equal(state.surface.content.items![1].strike!.start, 0.6 * 0.2, 'item strike rescaled');
	});

	it('leaves absolute-time timing (keyframe atMs) untouched', () => {
		const state = makeState();
		rescaleCompositionTimings(state, 6 / 30);
		const frames = state.surface.animation!.channels!.opacity!;
		assert.equal(frames[1].atMs, 300, 'keyframe atMs is absolute — not rescaled');
	});

	it('is a no-op for factor 1 or invalid factors', () => {
		const state = makeState();
		rescaleCompositionTimings(state, 1);
		rescaleCompositionTimings(state, 0);
		rescaleCompositionTimings(state, Number.NaN);
		assert.equal(state.surface.enter!.duration, 0.05, 'unchanged');
	});

	it('clamps to [0,1] when shortening the clip', () => {
		const state = makeState();
		// 6s → 2s: factor = 3. A 0.5 start becomes 1.5 → clamped to 1.
		rescaleCompositionTimings(state, 6 / 2);
		assert.equal(state.marks.timings[0].start, 1, 'over-range start clamps to 1');
	});
});

describe('frame-rate rationals (ADR-0042)', () => {
	it('maps NTSC fractional literals to exact rationals and integers to n/1', () => {
		assert.deepEqual(resolveFrameRate(29.97), { fps: 29.97, num: 30000, den: 1001 });
		assert.deepEqual(resolveFrameRate(23.976), { fps: 23.976, num: 24000, den: 1001 });
		assert.deepEqual(resolveFrameRate(59.94), { fps: 59.94, num: 60000, den: 1001 });
		assert.deepEqual(resolveFrameRate(30), { fps: 30, num: 30, den: 1 });
		assert.throws(() => resolveFrameRate(29.9), TypeError);
		assert.throws(() => resolveFrameRate(0), TypeError);
	});

	it('formats the ffmpeg -framerate argument as a rational, never a rounded float', () => {
		assert.equal(formatFrameRateRational(resolveFrameRate(29.97)), '30000/1001');
		assert.equal(formatFrameRateRational(resolveFrameRate(30)), '30');
	});

	it('does frame ↔ seconds math exactly at 29.97', () => {
		const rate = resolveFrameRate(29.97);
		// 300 frames at 30000/1001 is exactly 10.01 s — the literal 29.97 would drift.
		assert.equal(framesToSeconds(300, rate), 10.01);
		assert.equal(secondsToFrames(10.01, rate), 300);
		// Whole-frame quantization survives the round trip for every frame index.
		for (const frame of [1, 45, 161, 299, 10000]) {
			assert.equal(secondsToFrames(framesToSeconds(frame, rate), rate), frame);
		}
	});

	it('labels non-drop timecode at the nominal integer rate', () => {
		const rate = resolveFrameRate(29.97);
		assert.equal(framesToTimecode(0, rate), '00:00:00:00');
		assert.equal(framesToTimecode(240, rate), '00:00:08:00');
		assert.equal(framesToTimecode(108240, rate), '01:00:08:00');
		assert.equal(timecodeToFrames('01:00:08:00', rate), 108240);
		assert.equal(timecodeToFrames(framesToTimecode(456789, rate), rate), 456789);
		assert.ok(isNonDropTimecode('01:00:08:00'));
		assert.ok(!isNonDropTimecode('01:00:08;00'), 'drop-frame separators are rejected');
		assert.ok(!isNonDropTimecode('1:0:8:0'));
		assert.throws(() => timecodeToFrames('00:00:00:30', rate), /beyond the 30 fps/);
	});

	it('labels drop-frame timecode at 29.97 (skip 2 per minute, none every 10th)', () => {
		const rate = resolveFrameRate(29.97);
		assert.equal(framesToDropTimecode(0, rate), '00:00:00;00');
		// Minute 0 drops nothing: the full 1800 labels exist.
		assert.equal(framesToDropTimecode(1799, rate), '00:00:59;29');
		// Minute 1 starts at label ;02 — ;00 and ;01 are dropped.
		assert.equal(framesToDropTimecode(1800, rate), '00:01:00;02');
		// Every 10th minute drops nothing: 10 real minutes land exactly on ;00.
		assert.equal(framesToDropTimecode(17982, rate), '00:10:00;00');
		assert.equal(framesToDropTimecode(17984, rate), '00:10:00;02');
		// One DF hour is 107892 frames — the ReachyMini timeline's 01:00:00;00 start.
		assert.equal(framesToDropTimecode(107892, rate), '01:00:00;00');
		assert.equal(dropTimecodeToFrames('01:00:00;00', rate), 107892);
		assert.equal(dropTimecodeToFrames('00:01:00;02', rate), 1800);
		for (const frame of [1, 45, 1799, 1800, 17981, 17982, 107892, 456789]) {
			assert.equal(dropTimecodeToFrames(framesToDropTimecode(frame, rate), rate), frame);
		}
	});

	it('labels drop-frame timecode at 59.94 (skip 4 per minute)', () => {
		const rate = resolveFrameRate(59.94);
		assert.equal(framesToDropTimecode(3599, rate), '00:00:59;59');
		assert.equal(framesToDropTimecode(3600, rate), '00:01:00;04');
		assert.equal(framesToDropTimecode(35964, rate), '00:10:00;00');
		assert.equal(framesToDropTimecode(215784, rate), '01:00:00;00');
		assert.equal(dropTimecodeToFrames('01:00:00;00', rate), 215784);
	});

	it('recognizes the drop-frame separator', () => {
		assert.ok(isDropTimecode('01:00:08;00'));
		assert.ok(!isDropTimecode('01:00:08:00'), 'NDF separators are not drop-frame');
		assert.ok(!isDropTimecode('01;00;08;00'), 'only the frame separator is a semicolon');
	});

	it('rejects drop-frame labels that do not exist', () => {
		const rate = resolveFrameRate(29.97);
		// The first two labels of every non-tenth minute are dropped.
		assert.throws(() => dropTimecodeToFrames('00:01:00;00', rate), /dropped label/);
		assert.throws(() => dropTimecodeToFrames('00:01:00;01', rate), /dropped label/);
		// Tenth minutes drop nothing.
		assert.equal(dropTimecodeToFrames('00:10:00;00', rate), 17982);
		assert.throws(() => dropTimecodeToFrames('00:00:00;30', rate), /beyond the 30 fps/);
		assert.throws(() => dropTimecodeToFrames('01:00:00:00', rate), /drop-frame HH:MM:SS;FF/);
	});

	it('rejects drop-frame conversion outside 29.97/59.94', () => {
		assert.throws(() => framesToDropTimecode(0, resolveFrameRate(30)), /only defined for 29\.97/);
		assert.throws(() => framesToDropTimecode(0, resolveFrameRate(23.976)), /only defined for 29\.97/);
		assert.throws(() => dropTimecodeToFrames('00:00:01;00', resolveFrameRate(24)), /only defined for 29\.97/);
	});
});
