import { describe, expect, it } from 'vite-plus/test';
import type { BarChartBlock, ChartDataTarget } from '../platform/engine-schema.ts';
import {
	ChartDataTargetInvariantError,
	createChartDatumIdentityKey,
	resolveChartDataTarget,
	resolveChartTargetGeometry,
	type ChartDatumGeometry
} from './chart-data-target.ts';

function dataTargetChartBlock(): BarChartBlock {
	return {
		id: 'target-chart',
		type: 'bar-chart',
		title: 'Target chart',
		data: {
			categories: [
				{ id: 'alpha', label: 'Alpha' },
				{ id: 'beta', label: 'Beta' },
				{ id: 'gamma', label: 'Gamma' }
			],
			series: [
				{
					id: 'primary',
					label: 'Primary',
					values: [
						{ categoryId: 'gamma', value: -2 },
						{ categoryId: 'alpha', value: 5 },
						{ categoryId: 'beta', value: 0 }
					]
				},
				{
					id: 'secondary',
					label: 'Secondary',
					values: [
						{ categoryId: 'alpha', value: 10 },
						{ categoryId: 'beta', value: 20 },
						{ categoryId: 'gamma', value: 30 }
					]
				}
			]
		},
		layout: { mode: 'grouped' },
		labels: { values: true, legend: true },
		fill: { role: 'series' },
		motion: {
			entry: { start: 0, duration: 0.1 },
			reveal: { start: 0.1, duration: 0.1 },
			emphasis: { start: 0.2, duration: 0.1 },
			annotation: { start: 0.3, duration: 0.1 },
			exit: { start: 0.9, duration: 0.1 }
		}
	};
}

function resolveTarget(target: ChartDataTarget) {
	return resolveChartDataTarget(dataTargetChartBlock(), target);
}

describe('createChartDatumIdentityKey', () => {
	it('uses a length-prefixed encoding that cannot collide through concatenation or delimiters', () => {
		const keys = [
			createChartDatumIdentityKey({ seriesId: 'ab', categoryId: 'c' }),
			createChartDatumIdentityKey({ seriesId: 'a', categoryId: 'bc' }),
			createChartDatumIdentityKey({ seriesId: '1:x', categoryId: '2:y' }),
			createChartDatumIdentityKey({ seriesId: '1', categoryId: 'x2:y' })
		];
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys[0]).toBe('2:ab1:c');
		expect(createChartDatumIdentityKey({ seriesId: 'ab', categoryId: 'c' })).toBe(keys[0]);
	});
});

describe('resolveChartDataTarget', () => {
	it('resolves one datum with its exact value and series total', () => {
		expect(resolveTarget({ kind: 'datum', seriesId: 'primary', categoryId: 'gamma' })).toEqual({
			seriesId: 'primary',
			data: [{ seriesId: 'primary', categoryId: 'gamma' }],
			value: -2,
			seriesTotal: 3
		});
	});

	it('returns category-set geometry identities in category declaration order', () => {
		expect(
			resolveTarget({
				kind: 'category-set',
				seriesId: 'primary',
				categoryIds: ['gamma', 'alpha']
			})
		).toEqual({
			seriesId: 'primary',
			data: [
				{ seriesId: 'primary', categoryId: 'alpha' },
				{ seriesId: 'primary', categoryId: 'gamma' }
			],
			value: 3,
			seriesTotal: 3
		});
	});

	it('resolves a series total through the established series-value order', () => {
		expect(resolveTarget({ kind: 'series-total', seriesId: 'secondary' })).toEqual({
			seriesId: 'secondary',
			data: [
				{ seriesId: 'secondary', categoryId: 'alpha' },
				{ seriesId: 'secondary', categoryId: 'beta' },
				{ seriesId: 'secondary', categoryId: 'gamma' }
			],
			value: 60,
			seriesTotal: 60
		});
	});

	it('preserves cancellation-sensitive arithmetic order while returning geometry identities in category order', () => {
		const block = dataTargetChartBlock();
		block.data.series[0].values = [
			{ categoryId: 'alpha', value: 1e16 },
			{ categoryId: 'gamma', value: -1e16 },
			{ categoryId: 'beta', value: 1 }
		];
		const resolved = resolveChartDataTarget(block, {
			kind: 'category-set',
			seriesId: 'primary',
			categoryIds: ['alpha', 'gamma', 'beta']
		});
		expect(resolved.value).toBe(1);
		expect(resolved.seriesTotal).toBe(1);
		expect(resolved.data.map((identity) => identity.categoryId)).toEqual([
			'alpha',
			'beta',
			'gamma'
		]);
	});

	it('retains exact negative and zero targets without repair', () => {
		expect(resolveTarget({ kind: 'datum', seriesId: 'primary', categoryId: 'beta' }).value).toBe(0);
		expect(resolveTarget({ kind: 'datum', seriesId: 'primary', categoryId: 'gamma' }).value).toBe(
			-2
		);
	});

	it.each<ChartDataTarget>([
		{ kind: 'datum', seriesId: 'missing', categoryId: 'alpha' },
		{ kind: 'datum', seriesId: 'primary', categoryId: 'missing' },
		{
			kind: 'category-set',
			seriesId: 'primary',
			categoryIds: ['alpha', 'alpha']
		}
	])('throws the named invariant error for unvalidated target $kind', (target) => {
		expect(() => resolveTarget(target)).toThrow(ChartDataTargetInvariantError);
		try {
			resolveTarget(target);
		} catch (error) {
			expect(error).toMatchObject({ name: 'ChartDataTargetInvariantError' });
		}
	});

	it('throws when validated completeness assumptions are bypassed', () => {
		const block = dataTargetChartBlock();
		block.data.series[0].values = block.data.series[0].values.filter(
			(datum) => datum.categoryId !== 'beta'
		);
		expect(() =>
			resolveChartDataTarget(block, { kind: 'series-total', seriesId: 'primary' })
		).toThrow(ChartDataTargetInvariantError);
	});
});

describe('resolveChartTargetGeometry', () => {
	const geometry: readonly ChartDatumGeometry[] = [
		{
			identity: { seriesId: 'primary', categoryId: 'alpha' },
			bounds: { x: 10, y: 20, width: 30, height: 40 },
			calloutAnchor: { x: 25, y: 20 }
		},
		{
			identity: { seriesId: 'primary', categoryId: 'beta' },
			bounds: { x: 70, y: 10, width: 20, height: 15 },
			calloutAnchor: { x: 80, y: 10 }
		},
		{
			identity: { seriesId: 'primary', categoryId: 'gamma' },
			bounds: { x: -10, y: 80, width: 15, height: 10 },
			calloutAnchor: { x: -2.5, y: 90 }
		}
	];

	it('uses renderer-supplied datum bounds and callout anchor directly', () => {
		const target = resolveTarget({ kind: 'datum', seriesId: 'primary', categoryId: 'alpha' });
		expect(resolveChartTargetGeometry(target, geometry)).toEqual({
			bounds: { x: 10, y: 20, width: 30, height: 40 },
			anchor: { x: 25, y: 20 }
		});
	});

	it('unions mark bounds and uses the arithmetic centroid of selected anchors', () => {
		const target = resolveTarget({
			kind: 'category-set',
			seriesId: 'primary',
			categoryIds: ['gamma', 'alpha']
		});
		expect(resolveChartTargetGeometry(target, geometry)).toEqual({
			bounds: { x: -10, y: 20, width: 50, height: 70 },
			anchor: { x: 11.25, y: 55 }
		});
	});

	it('uses the same deterministic union and centroid for a series total', () => {
		const target = resolveTarget({ kind: 'series-total', seriesId: 'primary' });
		expect(resolveChartTargetGeometry(target, geometry)).toEqual({
			bounds: { x: -10, y: 10, width: 100, height: 80 },
			anchor: { x: 34.166666666666664, y: 40 }
		});
		expect(resolveChartTargetGeometry(target, geometry)).toEqual(
			resolveChartTargetGeometry(target, geometry)
		);
	});

	it('keeps derived anchor centroids finite across opposite extreme coordinates', () => {
		const target = resolveTarget({
			kind: 'category-set',
			seriesId: 'primary',
			categoryIds: ['alpha', 'beta']
		});
		const extreme = Number.MAX_VALUE;
		const result = resolveChartTargetGeometry(target, [
			{
				...geometry[0],
				bounds: { x: 0, y: 0, width: 1, height: 1 },
				calloutAnchor: { x: -extreme, y: 0 }
			},
			{
				...geometry[1],
				bounds: { x: 2, y: 0, width: 1, height: 1 },
				calloutAnchor: { x: extreme, y: 0 }
			}
		]);
		expect(result.anchor).toEqual({ x: 0, y: 0 });
	});

	it('rejects non-finite or negative renderer geometry before anchor resolution', () => {
		const target = resolveTarget({ kind: 'datum', seriesId: 'primary', categoryId: 'alpha' });
		expect(() =>
			resolveChartTargetGeometry(target, [
				{ ...geometry[0], bounds: { ...geometry[0].bounds, width: -1 } }
			])
		).toThrow(ChartDataTargetInvariantError);
		expect(() =>
			resolveChartTargetGeometry(target, [
				{ ...geometry[0], calloutAnchor: { x: Number.NaN, y: 0 } }
			])
		).toThrow(ChartDataTargetInvariantError);
	});

	it('throws the named invariant error for missing, duplicate, or empty renderer resolution', () => {
		const datumTarget = resolveTarget({
			kind: 'datum',
			seriesId: 'primary',
			categoryId: 'alpha'
		});
		expect(() => resolveChartTargetGeometry(datumTarget, [])).toThrow(
			ChartDataTargetInvariantError
		);
		expect(() => resolveChartTargetGeometry(datumTarget, [geometry[0], geometry[0]])).toThrow(
			ChartDataTargetInvariantError
		);
		expect(() =>
			resolveChartTargetGeometry(
				{ seriesId: 'primary', data: [], value: 0, seriesTotal: 3 },
				geometry
			)
		).toThrow(ChartDataTargetInvariantError);
	});
});
