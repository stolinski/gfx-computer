import { describe, expect, it } from 'vite-plus/test';

import type { ResolvedChartMarkFill } from '$lib/platform/packs/resolve';
import {
	chartOrderedDitherRank,
	createChartMarkFillWgsl,
	packChartMarkFillUniforms,
	sampleChartMarkFillReference,
	type ChartMarkFillSampleInput
} from './chart-mark-fill';

function treatment(
	mode: ResolvedChartMarkFill['mode'],
	overrides: Partial<ResolvedChartMarkFill> = {}
): ResolvedChartMarkFill {
	return {
		mode,
		colorA: [1, 0.5, 0.25, 1],
		colorB: [0, 0.25, 1, 0.5],
		gradientAxis: 'inline',
		matrix: '4x4',
		cellPx: 8,
		...overrides
	};
}

function sampleInput(overrides: Partial<ChartMarkFillSampleInput> = {}): ChartMarkFillSampleInput {
	return {
		localUv: { x: 0.25, y: 0.75 },
		localPx: { x: 12, y: 20 },
		canvasWidth: 3840,
		canvasHeight: 2160,
		maskAlpha: 1,
		terminalCoverage: 1,
		emphasisProgress: 0,
		seriesIndex: 0,
		...overrides
	};
}

function expectPremultiplied(color: readonly number[]): void {
	expect(color).toHaveLength(4);
	for (const channel of color) expect(Number.isFinite(channel)).toBe(true);
	expect(color[3]).toBeGreaterThanOrEqual(0);
	expect(color[3]).toBeLessThanOrEqual(1);
	for (const channel of color.slice(0, 3)) {
		expect(channel).toBeGreaterThanOrEqual(0);
		expect(channel).toBeLessThanOrEqual(color[3] + Number.EPSILON * 8);
	}
	if (color[3] === 0) expect(color.slice(0, 3)).toEqual([0, 0, 0]);
}

describe('chartOrderedDitherRank', () => {
	it.each([
		['2x2', 2],
		['4x4', 4],
		['8x8', 8]
	] as const)('generates one complete deterministic Bayer permutation for %s', (matrix, size) => {
		const ranks = Array.from({ length: size * size }, (_, index) =>
			chartOrderedDitherRank(matrix, index % size, Math.floor(index / size), 0)
		);
		expect([...ranks].sort((a, b) => a - b)).toEqual(
			Array.from({ length: size * size }, (_, index) => index)
		);
		expect(ranks).toEqual(
			Array.from({ length: size * size }, (_, index) =>
				chartOrderedDitherRank(matrix, index % size, Math.floor(index / size), 0)
			)
		);
	});

	it('phases only from deterministic series index and rejects unstable coordinates', () => {
		expect(chartOrderedDitherRank('4x4', 0, 0, 0)).not.toBe(chartOrderedDitherRank('4x4', 0, 0, 1));
		expect(() => chartOrderedDitherRank('4x4', 0.5, 0, 0)).toThrow(RangeError);
		expect(() => chartOrderedDitherRank('4x4', 0, 0, -1)).toThrow(RangeError);
	});
});

describe('sampleChartMarkFillReference', () => {
	it('samples solid and both bounded local gradient axes without frame anchoring', () => {
		const solid = treatment('solid');
		expect(sampleChartMarkFillReference(solid, solid, sampleInput())).toEqual([1, 0.5, 0.25, 1]);
		const inline = treatment('gradient');
		expect(sampleChartMarkFillReference(inline, inline, sampleInput())).toEqual([
			0.75, 0.40625, 0.3125, 0.875
		]);
		const block = treatment('gradient', { gradientAxis: 'block' });
		expect(sampleChartMarkFillReference(block, block, sampleInput())).toEqual([
			0.25, 0.21875, 0.4375, 0.625
		]);
		expect(
			sampleChartMarkFillReference(inline, inline, sampleInput({ localUv: { x: 0.25, y: 0.75 } }))
		).toEqual(sampleChartMarkFillReference(inline, inline, sampleInput()));
	});

	it.each(['2x2', '4x4', '8x8'] as const)(
		'samples locally anchored ordered %s texture with no random input',
		(matrix) => {
			const dither = treatment('ordered-dither', { matrix });
			const first = sampleChartMarkFillReference(dither, dither, sampleInput());
			const repeated = sampleChartMarkFillReference(dither, dither, sampleInput());
			expect(first).toEqual(repeated);
			expect([dither.colorA, [0, 0.125, 0.5, 0.5]]).toContainEqual(first);
		}
	);

	it('mixes exact premultiplied emphasis endpoints and stable intermediate progress', () => {
		const base = treatment('solid', { colorA: [1, 0, 0, 0.5] });
		const emphasis = treatment('solid', { colorA: [0, 1, 0, 1] });
		expect(sampleChartMarkFillReference(base, emphasis, sampleInput())).toEqual([0.5, 0, 0, 0.5]);
		expect(
			sampleChartMarkFillReference(base, emphasis, sampleInput({ emphasisProgress: 1 }))
		).toEqual([0, 1, 0, 1]);
		const middle = sampleChartMarkFillReference(
			base,
			emphasis,
			sampleInput({ emphasisProgress: 0.5 })
		);
		expect(middle).toEqual([0.25, 0.5, 0, 0.75]);
		expect(middle).toEqual(
			sampleChartMarkFillReference(base, emphasis, sampleInput({ emphasisProgress: 0.5 }))
		);
	});

	it('quantizes factual terminal occupancy within one Bayer cell without changing geometry', () => {
		const base = treatment('solid', { matrix: '4x4', cellPx: 8 });
		const coverage = 0.3;
		let occupied = 0;
		for (let y = 0; y < 4; y += 1) {
			for (let x = 0; x < 4; x += 1) {
				const output = sampleChartMarkFillReference(
					base,
					base,
					sampleInput({
						localPx: { x: x * 8 + 4, y: y * 8 + 4 },
						terminalCoverage: coverage
					})
				);
				if (output[3] > 0) occupied += 1;
			}
		}
		expect(Math.abs(occupied / 16 - coverage)).toBeLessThanOrEqual(1 / 16);
		expect(sampleChartMarkFillReference(base, base, sampleInput({ terminalCoverage: 0 }))).toEqual([
			0, 0, 0, 0
		]);
	});

	it('applies the current fragment mask after fill evaluation and preserves premultiplied alpha', () => {
		const base = treatment('gradient');
		for (const maskAlpha of [0, 0.125, 0.5, 1]) {
			const output = sampleChartMarkFillReference(base, base, sampleInput({ maskAlpha }));
			expectPremultiplied(output);
			if (maskAlpha === 0) expect(output).toEqual([0, 0, 0, 0]);
		}
	});

	it('never emits pixels outside a synthetic circular mark mask', () => {
		const base = treatment('ordered-dither');
		for (let y = 0; y < 16; y += 1) {
			for (let x = 0; x < 16; x += 1) {
				const dx = x + 0.5 - 8;
				const dy = y + 0.5 - 8;
				const maskAlpha = dx * dx + dy * dy <= 64 ? 1 : 0;
				const output = sampleChartMarkFillReference(
					base,
					base,
					sampleInput({ localUv: { x: x / 15, y: y / 15 }, localPx: { x, y }, maskAlpha })
				);
				if (maskAlpha === 0) expect(output).toEqual([0, 0, 0, 0]);
			}
		}
	});

	it('rejects invalid runtime scalars instead of clamping factual or timing inputs', () => {
		const base = treatment('solid');
		for (const overrides of [
			{ maskAlpha: -0.1 },
			{ terminalCoverage: 1.1 },
			{ emphasisProgress: Number.NaN },
			{ canvasWidth: 0 },
			{ seriesIndex: 0.5 },
			{ localPx: { x: Number.NaN, y: 0 } }
		] satisfies Partial<ChartMarkFillSampleInput>[]) {
			expect(() => sampleChartMarkFillReference(base, base, sampleInput(overrides))).toThrow(
				RangeError
			);
		}
	});
});

describe('chart mark fill shader contract', () => {
	it('packs bounded treatments and native canvas size for future mark renderers', () => {
		const packed = packChartMarkFillUniforms(
			treatment('gradient'),
			treatment('ordered-dither', { matrix: '8x8', cellPx: 16 }),
			3840,
			2160
		);
		expect(packed.baseMode).toBe(1);
		expect(packed.emphasisMode).toBe(2);
		expect(packed.emphasisMatrixBits).toBe(3);
		expect(packed.emphasisCellPx).toBe(16);
		expect(() =>
			packChartMarkFillUniforms(treatment('solid'), treatment('solid'), 0, 2160)
		).toThrow(RangeError);
	});

	it('exports a mark-local mask-aware WGSL contract without texture sampling, random, or wall clock', () => {
		const wgsl = createChartMarkFillWgsl();
		expect(wgsl).toContain('localUv');
		expect(wgsl).toContain('localPx');
		expect(wgsl).toContain('maskAlpha');
		expect(wgsl).toContain('terminalCoverage');
		expect(wgsl).toContain('emphasisProgress');
		expect(wgsl).toContain('resolveChartMarkFillSample');
		expect(wgsl).toContain('baseMode: u32');
		expect(wgsl).not.toContain('textureSample');
		expect(wgsl).not.toContain('random');
		expect(wgsl).not.toContain('timestamp');
	});
});
