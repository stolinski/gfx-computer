import { describe, expect, it } from 'vitest';

import {
	beginVideoMoshReference,
	computeVideoMoshLuma,
	resolveVideoMoshCorruption,
	resolveVideoMoshHealWeight,
	searchVideoMoshMotion,
	stepVideoMoshReference,
	type VideoMoshImage,
	type VideoMoshStepParams
} from './video-mosh-reference';

const WIDTH = 64;
const HEIGHT = 48;

/** A deterministic textured pattern shifted right by `shift` native pixels. */
function pattern(shift: number, variant = 0): VideoMoshImage {
	const data = new Float32Array(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			const u = x - shift;
			const offset = (y * WIDTH + x) * 4;
			const value = ((Math.floor(u / 3) * 37 + Math.floor(y / 5) * 11 + variant * 53) % 97) / 96;
			data[offset] = Math.f16round(value);
			data[offset + 1] = Math.f16round((value * 0.6 + 0.2) % 1);
			data[offset + 2] = Math.f16round(1 - value);
			data[offset + 3] = 1;
		}
	}
	return { width: WIDTH, height: HEIGHT, data };
}

const PARAMS: VideoMoshStepParams = {
	motion: 'follow',
	blockSize: 16,
	bleed: 0,
	corruption: 0,
	seed: 0,
	durationFrames: 10,
	healFrames: 2
};

/** A held frame that differs from the live footage, which starts at `previous`. */
function beginStale(held: VideoMoshImage, previous: VideoMoshImage) {
	return {
		...beginVideoMoshReference(held),
		previousLive: previous,
		previousLuma: computeVideoMoshLuma(previous)
	};
}

function pixel(image: VideoMoshImage, x: number, y: number): number[] {
	const offset = (y * image.width + x) * 4;
	return Array.from(image.data.subarray(offset, offset + 4));
}

describe('Mosh window reference maths', () => {
	it('sums 8-bit luma over each 4×4 quarter pixel', () => {
		const white: VideoMoshImage = {
			width: 8,
			height: 4,
			data: new Float32Array(8 * 4 * 4).fill(1)
		};
		const luma = computeVideoMoshLuma(white);
		expect([luma.width, luma.height]).toEqual([2, 1]);
		expect(Array.from(luma.data)).toEqual([16 * 255, 16 * 255]);
	});

	it('finds whole-block translation in native pixels', () => {
		const field = searchVideoMoshMotion(
			computeVideoMoshLuma(pattern(8)),
			computeVideoMoshLuma(pattern(0)),
			16
		);
		// Interior blocks see the pattern move 8 px right.
		expect([field.data[2], field.data[3]]).toEqual([8, 0]);
	});

	it('holds the frame when nothing moves and nothing bleeds', () => {
		let state = beginStale(pattern(0, 1), pattern(0));
		for (let step = 0; step < 3; step += 1) {
			const result = stepVideoMoshReference(state, pattern(0), PARAMS);
			expect(Array.from(result.output.data)).toEqual(Array.from(state.held.data));
			state = result.state;
		}
	});

	it('drags the held frame by the live footage motion', () => {
		const moshState = beginStale(pattern(0, 1), pattern(0));
		const { output } = stepVideoMoshReference(moshState, pattern(8), PARAMS);
		for (const [x, y] of [
			[24, 20],
			[40, 30]
		]) {
			expect(pixel(output, x, y)).toEqual(pixel(moshState.held, x - 8, y));
		}
	});

	it('decodes the live frame exactly when the held frame is the true reference and bleed is 1', () => {
		const state = beginVideoMoshReference(pattern(0));
		const live = pattern(8);
		const { output } = stepVideoMoshReference(state, live, { ...PARAMS, bleed: 1 });
		expect(pixel(output, 32, 20)).toEqual(pixel(live, 32, 20));
	});

	it('repeats the first motion step under repeat', () => {
		const state = beginStale(pattern(0, 1), pattern(0));
		const first = stepVideoMoshReference(state, pattern(8), { ...PARAMS, motion: 'repeat' });
		const second = stepVideoMoshReference(first.state, pattern(8), {
			...PARAMS,
			motion: 'repeat'
		});
		expect(second.state.vectors).toBe(first.state.vectors);
		expect(pixel(second.output, 40, 20)).toEqual(pixel(first.output, 32, 20));
	});

	it('heals to the live frame exactly on the last frame', () => {
		expect(resolveVideoMoshHealWeight(7, 10, 2)).toBe(0);
		expect(resolveVideoMoshHealWeight(8, 10, 2)).toBeCloseTo(0.875, 12);
		expect(resolveVideoMoshHealWeight(9, 10, 2)).toBe(1);

		let state = beginStale(pattern(0, 1), pattern(0));
		let output: VideoMoshImage = state.held;
		for (let step = 0; step < 10; step += 1) {
			const result = stepVideoMoshReference(state, pattern(0), PARAMS);
			output = result.output;
			state = result.state;
		}
		expect(output.data).toEqual(pattern(0).data);
	});

	it('corrupts a seeded share of blocks the same way every time', () => {
		const sample = (seed: number, corruption: number): string[] =>
			Array.from({ length: 200 }, (_, index) =>
				resolveVideoMoshCorruption(seed, index % 20, Math.floor(index / 20), 3, corruption)
			);
		expect(sample(7, 0.3)).toEqual(sample(7, 0.3));
		expect(sample(7, 0.3)).not.toEqual(sample(8, 0.3));
		expect(sample(7, 0).every((kind) => kind === 'none')).toBe(true);
		expect(sample(7, 1).every((kind) => kind !== 'none')).toBe(true);
		const share = sample(7, 0.3).filter((kind) => kind !== 'none').length / 200;
		expect(share).toBeGreaterThan(0.2);
		expect(share).toBeLessThan(0.4);
	});
});
