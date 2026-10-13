import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type {
	ChartMotion,
	DotFieldChartBlock,
	UnitGridChartBlock
} from '$lib/platform/engine-schema';
import { resolveChartDataTarget, resolveChartTargetGeometry } from './chart-data-target';
import { resolveChartNormalizedGeometry } from './chart-normalized-geometry';
import { resolveChartFrameLayout, type ChartTextMeasurer } from './chart-layout';

function motion(): ChartMotion {
	return {
		entry: { start: 0, duration: 0.1 },
		reveal: { start: 0.1, duration: 0.1 },
		emphasis: { start: 0.2, duration: 0.1 },
		annotation: { start: 0.3, duration: 0.1 },
		exit: { start: 0.8, duration: 0.1 }
	};
}

function unitGrid(unitCount = 100): UnitGridChartBlock {
	return {
		id: 'share',
		type: 'unit-grid-chart',
		title: 'People using multiple agents',
		data: {
			categories: [
				{ id: 'multiple', label: 'Multiple agents' },
				{ id: 'one', label: 'One agent' }
			],
			series: [
				{
					id: 'respondents',
					label: 'Respondents',
					values: [
						{ categoryId: 'multiple', value: 67.4 },
						{ categoryId: 'one', value: 32.6 }
					]
				}
			]
		},
		normalization: { total: 100, unitCount },
		labels: { categories: true, values: true, legend: false },
		highlights: [{ target: { kind: 'datum', seriesId: 'respondents', categoryId: 'multiple' } }],
		callouts: [
			{
				target: { kind: 'datum', seriesId: 'respondents', categoryId: 'multiple' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		],
		fill: { role: 'series' },
		motion: motion()
	};
}

const measureText: ChartTextMeasurer = ({ text, role }) => ({
	width: text.length * (role === 'title' ? 32 : 20),
	height: role === 'title' ? 88 : 44
});

function geometry(
	block: UnitGridChartBlock | DotFieldChartBlock,
	orientation: 'horizontal' | 'vertical'
) {
	const layout = resolveChartFrameLayout({ block, orientation, measureText });
	return {
		layout,
		geometry: resolveChartNormalizedGeometry({ block, layout, orientation, measureText })
	};
}

function segmentIntersectsRectInterior(
	from: { x: number; y: number },
	to: { x: number; y: number },
	rect: { x: number; y: number; width: number; height: number }
): boolean {
	const epsilon = 1e-6;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const p = [-dx, dx, -dy, dy];
	const q = [
		from.x - (rect.x + epsilon),
		rect.x + rect.width - epsilon - from.x,
		from.y - (rect.y + epsilon),
		rect.y + rect.height - epsilon - from.y
	];
	let entry = 0;
	let exit = 1;
	for (let index = 0; index < p.length; index += 1) {
		const direction = p[index];
		const distance = q[index];
		if (direction === undefined || distance === undefined) return false;
		if (Math.abs(direction) < Number.EPSILON) {
			if (distance < 0) return false;
			continue;
		}
		const ratio = distance / direction;
		if (direction < 0) entry = Math.max(entry, ratio);
		else exit = Math.min(exit, ratio);
		if (entry > exit) return false;
	}
	return entry < 1 && exit > 0;
}

describe('resolveChartNormalizedGeometry', () => {
	it('produces stable bounded row-major geometry and exact category voices at both native targets', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const first = geometry(unitGrid(100), orientation);
			const second = geometry(unitGrid(100), orientation);
			assert.equal(JSON.stringify(first.geometry), JSON.stringify(second.geometry));
			assert.equal(first.geometry.marks.length, 100);
			assert.deepEqual(first.geometry.overflow, []);
			assert.equal(first.geometry.marks.filter((mark) => mark.fillVoiceIndex === 0).length, 67);
			assert.equal(first.geometry.marks.filter((mark) => mark.fillVoiceIndex === 1).length, 33);
			assert.equal(first.geometry.marks.filter((mark) => mark.isHighlighted).length, 67);
			assert.equal(first.geometry.annotations[0].text, '67.4%');
			for (const mark of first.geometry.marks) {
				assert.ok(mark.bounds.x >= first.layout.plotBounds.x);
				assert.ok(mark.bounds.y >= first.layout.plotBounds.y);
				assert.ok(
					mark.bounds.x + mark.bounds.width <=
						first.layout.plotBounds.x + first.layout.plotBounds.width
				);
				assert.ok(
					mark.bounds.y + mark.bounds.height <=
						first.layout.plotBounds.y + first.layout.plotBounds.height
				);
			}
		}
	});

	it('distinguishes square unit-grid marks from circular dot-field marks', () => {
		const grid = geometry(unitGrid(10), 'horizontal').geometry;
		const dotBlock: DotFieldChartBlock = { ...unitGrid(10), type: 'dot-field-chart' };
		const dots = geometry(dotBlock, 'horizontal').geometry;
		assert.ok(grid.marks[0].cornerRadius < grid.marks[0].bounds.width / 2);
		assert.equal(dots.marks[0].cornerRadius, dots.marks[0].bounds.width / 2);
	});

	it('keeps one thousand marks bounded and records quantization provenance without fractional pixels', () => {
		const result = geometry(unitGrid(1000), 'vertical').geometry;
		assert.equal(result.marks.length, 1000);
		assert.ok(result.grid.columns * result.grid.rows >= 1000);
		assert.ok(result.grid.markSize >= 8);
		assert.equal(
			result.marks.filter((mark) => mark.allocationKind === 'largest-remainder').length,
			0
		);
		assert.deepEqual(
			result.allocations.map((allocation) => allocation.exactUnitQuota),
			[674, 326]
		);
	});
	it('materializes every declared unit without overlap for both variants, orientations, and bounds', () => {
		for (const unitCount of [10, 100, 1000]) {
			for (const type of ['unit-grid-chart', 'dot-field-chart'] as const) {
				for (const orientation of ['horizontal', 'vertical'] as const) {
					const block = { ...unitGrid(unitCount), type } as UnitGridChartBlock | DotFieldChartBlock;
					const result = geometry(block, orientation);
					assert.deepEqual(result.layout.overflow, []);
					assert.deepEqual(result.geometry.overflow, []);
					assert.equal(result.geometry.marks.length, unitCount);
					assert.equal(result.geometry.annotations[0].text, '67.4%');
					assert.equal(
						new Set(result.geometry.marks.map((mark) => `${mark.bounds.x}:${mark.bounds.y}`)).size,
						unitCount
					);
					assert.ok(
						result.geometry.marks.every((mark) =>
							[mark.bounds.x, mark.bounds.y, mark.bounds.width, mark.bounds.height].every(
								Number.isFinite
							)
						)
					);
				}
			}
		}
	});

	it('routes normalized callouts without crossing unrelated category marks', () => {
		const block = unitGrid(100);
		block.data.categories = [
			{ id: 'recycled', label: 'Recycled' },
			{ id: 'energy', label: 'Energy recovery' },
			{ id: 'landfill', label: 'Landfilled' }
		];
		block.data.series[0].values = [
			{ categoryId: 'recycled', value: 3090 },
			{ categoryId: 'energy', value: 5620 },
			{ categoryId: 'landfill', value: 26970 }
		];
		block.normalization = { total: 35680, unitCount: 100 };
		block.highlights = [
			{ target: { kind: 'datum', seriesId: 'respondents', categoryId: 'recycled' } }
		];
		block.callouts = [
			{
				target: { kind: 'datum', seriesId: 'respondents', categoryId: 'recycled' },
				valueLabel: {
					kind: 'approximate-fraction-and-percent',
					maxDenominator: 20,
					precision: 1
				}
			}
		];
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const resolvedGeometry = geometry(block, orientation);
			const result = resolvedGeometry.geometry;
			const annotation = result.annotations[0];
			assert.ok(annotation);
			const targetMarks = result.marks.filter((mark) => mark.categoryId === 'recycled');
			assert.equal(
				targetMarks.some((mark) => {
					const { x, y, width, height } = mark.bounds;
					return [
						{ x: x + width, y: y + height / 2 },
						{ x: x + width / 2, y },
						{ x: x + width / 2, y: y + height },
						{ x, y: y + height / 2 }
					].some(
						(point) => point.x === annotation.leaderFrom.x && point.y === annotation.leaderFrom.y
					);
				}),
				true,
				`${orientation} terminal uses a mark-edge midpoint`
			);
			const leaderPoints = [
				annotation.leaderFrom,
				...annotation.leaderWaypoints,
				annotation.leaderTo
			];
			assert.equal(
				leaderPoints.slice(1).every((point, index) => {
					const previous = leaderPoints[index];
					return previous ? point.x === previous.x || point.y === previous.y : false;
				}),
				true,
				`${orientation} leader segments are orthogonal`
			);
			assert.equal(
				result.marks
					.filter((mark) => mark.categoryId !== 'recycled')
					.some((mark) =>
						leaderPoints.slice(1).some((point, index) => {
							const previous = leaderPoints[index];
							const clearance = 18;
							return previous
								? segmentIntersectsRectInterior(previous, point, {
										x: mark.bounds.x - clearance,
										y: mark.bounds.y - clearance,
										width: mark.bounds.width + clearance * 2,
										height: mark.bounds.height + clearance * 2
									})
								: false;
						})
					),
				false,
				orientation
			);
			assert.equal(
				leaderPoints.every(
					(point) =>
						point.x >= resolvedGeometry.layout.safeBounds.x &&
						point.x <=
							resolvedGeometry.layout.safeBounds.x + resolvedGeometry.layout.safeBounds.width &&
						point.y >= resolvedGeometry.layout.safeBounds.y &&
						point.y <=
							resolvedGeometry.layout.safeBounds.y + resolvedGeometry.layout.safeBounds.height
				),
				true,
				`${orientation} leader stays inside safe bounds`
			);
			const { box, leaderTo } = annotation;
			const attachesAtVerticalMidpoint =
				(leaderTo.x === box.x || leaderTo.x === box.x + box.width) &&
				leaderTo.y === box.y + box.height / 2;
			const attachesAtHorizontalMidpoint =
				(leaderTo.y === box.y || leaderTo.y === box.y + box.height) &&
				leaderTo.x === box.x + box.width / 2;
			assert.equal(attachesAtVerticalMidpoint || attachesAtHorizontalMidpoint, true, orientation);
		}
	});

	it('keeps multiple callout routes out of every callout box interior', () => {
		const block = unitGrid(100);
		block.callouts = [
			{
				target: { kind: 'datum', seriesId: 'respondents', categoryId: 'multiple' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			},
			{
				target: { kind: 'datum', seriesId: 'respondents', categoryId: 'one' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		];
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const result = geometry(block, orientation).geometry;
			assert.equal(result.annotations.length, 2, orientation);
			assert.deepEqual(result.overflow, [], orientation);
			for (const annotation of result.annotations) {
				const points = [annotation.leaderFrom, ...annotation.leaderWaypoints, annotation.leaderTo];
				for (const box of result.annotations.map((candidate) => candidate.box)) {
					assert.equal(
						points.slice(1).some((point, index) => {
							const previous = points[index];
							return previous ? segmentIntersectsRectInterior(previous, point, box) : false;
						}),
						false,
						orientation
					);
				}
			}
		}
	});

	it('keeps a zero-allocation category available to exact callout targeting', () => {
		const block = unitGrid(10);
		block.data.series[0].values = [
			{ categoryId: 'multiple', value: 100 },
			{ categoryId: 'one', value: 0 }
		];
		block.callouts = [
			{
				target: { kind: 'datum', seriesId: 'respondents', categoryId: 'one' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		];
		const result = geometry(block, 'horizontal').geometry;
		assert.equal(result.marks.filter((mark) => mark.categoryId === 'one').length, 0);
		assert.equal(result.annotations[0].text, '0.0%');
		assert.deepEqual(result.overflow, []);
	});
	it('exposes aggregate datum targets for datum, category-set, and series-total annotations', () => {
		const block = unitGrid(100);
		const result = geometry(block, 'horizontal').geometry;
		const datum = resolveChartTargetGeometry(
			resolveChartDataTarget(block, {
				kind: 'datum',
				seriesId: 'respondents',
				categoryId: 'multiple'
			}),
			result.datumGeometry
		);
		const categorySet = resolveChartTargetGeometry(
			resolveChartDataTarget(block, {
				kind: 'category-set',
				seriesId: 'respondents',
				categoryIds: ['multiple', 'one']
			}),
			result.datumGeometry
		);
		const seriesTotal = resolveChartTargetGeometry(
			resolveChartDataTarget(block, { kind: 'series-total', seriesId: 'respondents' }),
			result.datumGeometry
		);
		assert.ok(datum.bounds.x >= categorySet.bounds.x);
		assert.ok(datum.bounds.y >= categorySet.bounds.y);
		assert.ok(
			datum.bounds.x + datum.bounds.width <= categorySet.bounds.x + categorySet.bounds.width
		);
		assert.ok(
			datum.bounds.y + datum.bounds.height <= categorySet.bounds.y + categorySet.bounds.height
		);
		assert.deepEqual(categorySet.bounds, seriesTotal.bounds);
		assert.deepEqual(categorySet.anchor, seriesTotal.anchor);
	});
	it('fails closed when direct-call highlight targets do not resolve factually', () => {
		const wrongSeries = unitGrid(100);
		wrongSeries.highlights = [
			{ target: { kind: 'datum', seriesId: 'missing', categoryId: 'multiple' } }
		];
		assert.throws(() => geometry(wrongSeries, 'horizontal'), /Unknown chart series "missing"/);

		const unknownCategory = unitGrid(100);
		unknownCategory.highlights = [
			{ target: { kind: 'datum', seriesId: 'respondents', categoryId: 'missing' } }
		];
		assert.throws(
			() => geometry(unknownCategory, 'horizontal'),
			/Unknown chart category "missing"/
		);

		const partiallyInvalidSet = unitGrid(100);
		partiallyInvalidSet.highlights = [
			{
				target: {
					kind: 'category-set',
					seriesId: 'respondents',
					categoryIds: ['multiple', 'missing']
				}
			}
		];
		assert.throws(
			() => geometry(partiallyInvalidSet, 'horizontal'),
			/Unknown chart category "missing"/
		);
	});
});
