import { describe, expect, it } from 'vite-plus/test';
import type { BarChartBlock, ChartDomain } from '../platform/engine-schema.ts';
import {
	createChartCategoricalScale,
	createChartLinearScale,
	generateChartLinearTicks,
	resolveChartLinearDomain,
	resolveChartNumericExtent,
	type ChartLinearDomain
} from './chart-scale.ts';

const chartMotion = {
	entry: { start: 0, duration: 0.1 },
	reveal: { start: 0.1, duration: 0.1 },
	emphasis: { start: 0.2, duration: 0.1 },
	annotation: { start: 0.3, duration: 0.1 },
	exit: { start: 0.9, duration: 0.1 }
} as const;

function scaleChartBlock(input: {
	seriesValues: readonly (readonly number[])[];
	layout?: 'single' | 'grouped' | 'stacked';
	domain?: ChartDomain;
}): BarChartBlock {
	const categoryCount = input.seriesValues[0]?.length ?? 0;
	return {
		id: 'scale-chart',
		type: 'bar-chart',
		title: 'Scale chart',
		data: {
			categories: Array.from({ length: categoryCount }, (_, index) => ({
				id: `category-${index}`,
				label: `Category ${index}`
			})),
			series: input.seriesValues.map((values, seriesIndex) => ({
				id: `series-${seriesIndex}`,
				label: `Series ${seriesIndex}`,
				values: values.map((value, categoryIndex) => ({
					categoryId: `category-${categoryIndex}`,
					value
				}))
			}))
		},
		layout: { mode: input.layout ?? (input.seriesValues.length === 1 ? 'single' : 'grouped') },
		...(input.domain ? { domain: input.domain } : {}),
		labels: { values: true, legend: input.seriesValues.length > 1 },
		fill: { role: 'default' },
		motion: chartMotion
	};
}

describe('resolveChartNumericExtent', () => {
	it('uses every authored value for single and grouped charts', () => {
		expect(resolveChartNumericExtent(scaleChartBlock({ seriesValues: [[4, 9]] }))).toEqual({
			min: 4,
			max: 9
		});
		expect(
			resolveChartNumericExtent(
				scaleChartBlock({
					seriesValues: [
						[4, -2],
						[20, 3]
					]
				})
			)
		).toEqual({ min: -2, max: 20 });
	});

	it('uses per-category stack sums rather than individual values or series totals', () => {
		const block = scaleChartBlock({
			seriesValues: [
				[8, 1],
				[3, 20]
			],
			layout: 'stacked'
		});
		expect(resolveChartNumericExtent(block)).toEqual({ min: 11, max: 21 });
	});

	it('preserves tiny, huge, near-equal, negative, and zero values', () => {
		expect(resolveChartNumericExtent(scaleChartBlock({ seriesValues: [[1e-12, 2e-12]] }))).toEqual({
			min: 1e-12,
			max: 2e-12
		});
		expect(resolveChartNumericExtent(scaleChartBlock({ seriesValues: [[1e20, -1e20]] }))).toEqual({
			min: -1e20,
			max: 1e20
		});
		expect(resolveChartNumericExtent(scaleChartBlock({ seriesValues: [[1, 1 + 1e-12]] }))).toEqual({
			min: 1,
			max: 1 + 1e-12
		});
		expect(resolveChartNumericExtent(scaleChartBlock({ seriesValues: [[-0, 0]] }))).toEqual({
			min: 0,
			max: 0
		});
	});
});

describe('resolveChartLinearDomain', () => {
	it.each([
		{ values: [3, 7], expected: { min: 0, max: 8, zero: 0 } },
		{ values: [-7, -3], expected: { min: -8, max: 0, zero: 0 } },
		{ values: [-3, 7], expected: { min: -4, max: 8, zero: 0 } },
		{ values: [0, 0], expected: { min: 0, max: 1, zero: 0 } },
		{ values: [1e-12], expected: { min: 0, max: 1e-12, zero: 0 } },
		{ values: [1e20], expected: { min: 0, max: 1e20, zero: 0 } }
	])('infers a stable outward domain for $values', ({ values, expected }) => {
		expect(resolveChartLinearDomain(scaleChartBlock({ seriesValues: [values] }))).toEqual(expected);
	});

	it('preserves the factual bound when subnormal nice-step inference underflows', () => {
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[Number.MIN_VALUE]] }))
		).toEqual({ min: 0, max: Number.MIN_VALUE, zero: 0 });
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[-Number.MIN_VALUE]] }))
		).toEqual({ min: -Number.MIN_VALUE, max: 0, zero: 0 });
	});

	it('keeps inferred and tick domains finite at subnormal and maximum finite magnitudes', () => {
		for (const value of [1e-300, Number.MIN_VALUE, Number.MAX_VALUE]) {
			const domain = resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[value]] }));
			expect(Number.isFinite(domain.min)).toBe(true);
			expect(Number.isFinite(domain.max)).toBe(true);
			const scale = createChartLinearScale(domain, [0, 400]);
			const ticks = generateChartLinearTicks(scale, 400);
			expect(ticks.length).toBeGreaterThan(0);
			expect(ticks.length).toBeLessThanOrEqual(1_001);
			expect(
				ticks.every((tick) => Number.isFinite(tick.value) && Number.isFinite(tick.position))
			).toBe(true);
		}
	});

	it('preserves explicit bounds exactly and nices only a missing bound', () => {
		expect(
			resolveChartLinearDomain(
				scaleChartBlock({ seriesValues: [[3, 7]], domain: { min: -1, max: 7.25 } })
			)
		).toEqual({ min: -1, max: 7.25, zero: 0 });
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[3, 7]], domain: { min: -1 } }))
		).toEqual({ min: -1, max: 8, zero: 0 });
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[-7, -3]], domain: { max: 1 } }))
		).toEqual({ min: -8, max: 1, zero: 0 });
	});

	it('makes partial all-zero domains useful without changing their explicit edge', () => {
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[0]], domain: { min: 0 } }))
		).toEqual({ min: 0, max: 1, zero: 0 });
		expect(
			resolveChartLinearDomain(scaleChartBlock({ seriesValues: [[0]], domain: { max: 0 } }))
		).toEqual({ min: -1, max: 0, zero: 0 });
	});
});

describe('chart scales', () => {
	it('maps min, zero, and max through forward and reversed ranges', () => {
		const domain: ChartLinearDomain = { min: -5, max: 15, zero: 0 };
		const forward = createChartLinearScale(domain, [100, 500]);
		const reversed = createChartLinearScale(domain, [500, 100]);
		expect([forward.map(-5), forward.map(0), forward.map(15)]).toEqual([100, 200, 500]);
		expect([reversed.map(-5), reversed.map(0), reversed.map(15)]).toEqual([500, 400, 100]);
	});

	it('maps the full finite number range without overflowing its derived span', () => {
		const max = Number.MAX_VALUE;
		const scale = createChartLinearScale({ min: -max, max, zero: 0 }, [0, 1000]);
		expect(scale.map(-max)).toBe(0);
		expect(scale.map(0)).toBe(500);
		expect(scale.map(max)).toBe(1000);
		expect(generateChartLinearTicks(scale, 1000).map((tick) => tick.value)).toEqual([-max, 0, max]);
		expect(() => scale.map(Infinity)).toThrow(RangeError);
	});

	it('rejects degenerate and non-finite scale inputs', () => {
		expect(() => createChartLinearScale({ min: 1, max: 1, zero: 0 }, [0, 100])).toThrow(RangeError);
		expect(() => createChartLinearScale({ min: 0, max: 1, zero: 0 }, [0, Infinity])).toThrow(
			RangeError
		);
	});

	it('generates deterministic nice ticks inside the domain without negative zero or duplicates', () => {
		const scale = createChartLinearScale({ min: -3, max: 7, zero: 0 }, [700, 100]);
		const ticks = generateChartLinearTicks(scale, 800);
		expect(ticks.map((tick) => tick.value)).toEqual([-2, 0, 2, 4, 6]);
		expect(ticks.every((tick) => tick.value >= -3 && tick.value <= 7)).toBe(true);
		expect(new Set(ticks.map((tick) => tick.value)).size).toBe(ticks.length);
		expect(ticks.find((tick) => tick.isZero)).toEqual({ value: 0, position: 520, isZero: true });
		expect(ticks.some((tick) => Object.is(tick.value, -0))).toBe(false);
		expect(generateChartLinearTicks(scale, 800)).toEqual(ticks);
	});

	it('keeps ticks within non-nice explicit bounds at tiny magnitudes', () => {
		const scale = createChartLinearScale({ min: 1.1e-12, max: 1.9e-12, zero: 0 }, [0, 400]);
		const ticks = generateChartLinearTicks(scale, 400);
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((tick) => tick.value >= 1.1e-12 && tick.value <= 1.9e-12)).toBe(true);
	});
});

describe('createChartCategoricalScale', () => {
	it('keeps declaration order with stable equal bands', () => {
		const scale = createChartCategoricalScale(['a', 'b', 'c'], [10, 100]);
		expect(scale.step).toBe(30);
		expect(scale.bandwidth).toBe(30);
		expect(scale.bands).toEqual([
			{ categoryId: 'a', index: 0, start: 10, center: 25, end: 40 },
			{ categoryId: 'b', index: 1, start: 40, center: 55, end: 70 },
			{ categoryId: 'c', index: 2, start: 70, center: 85, end: 100 }
		]);
	});

	it('supports one category, reversed ranges, and defensive empty input', () => {
		expect(createChartCategoricalScale(['only'], [20, 80]).bands[0]).toEqual({
			categoryId: 'only',
			index: 0,
			start: 20,
			center: 50,
			end: 80
		});
		expect(createChartCategoricalScale(['first', 'second'], [100, 0]).bands).toEqual([
			{ categoryId: 'first', index: 0, start: 50, center: 75, end: 100 },
			{ categoryId: 'second', index: 1, start: 0, center: 25, end: 50 }
		]);
		expect(createChartCategoricalScale([], [0, 100])).toEqual({
			bands: [],
			bandwidth: 0,
			step: 0
		});
	});
});
