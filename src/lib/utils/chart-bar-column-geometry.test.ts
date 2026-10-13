import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { BarChartBlock, ChartMotion, ColumnChartBlock } from '$lib/platform/engine-schema';
import {
	chartMarkMatchesTarget,
	resolveChartBarColumnGeometry,
	resolveChartBarColumnTargetRect
} from './chart-bar-column-geometry';
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

function barChart(): BarChartBlock {
	return {
		id: 'survey',
		type: 'bar-chart',
		title: 'Agent usage',
		data: {
			categories: [
				{ id: 'one', label: 'One agent' },
				{ id: 'many', label: 'Multiple agents' }
			],
			series: [
				{
					id: 'responses',
					label: 'Responses',
					values: [
						{ categoryId: 'one', value: 360 },
						{ categoryId: 'many', value: 744 }
					]
				}
			]
		},
		layout: { mode: 'single' },
		domain: { min: 0, max: 800 },
		labels: { categories: true, values: true, legend: false },
		highlights: [{ target: { kind: 'datum', seriesId: 'responses', categoryId: 'many' } }],
		fill: { role: 'default' },
		motion: motion()
	};
}

const measureText: ChartTextMeasurer = ({ text, role }) => ({
	width: text.length * (role === 'title' ? 34 : 22),
	height: role === 'title' ? 92 : 48
});

function geometry(
	block: BarChartBlock | ColumnChartBlock,
	orientation: 'horizontal' | 'vertical' = 'horizontal'
) {
	const layout = resolveChartFrameLayout({ block, orientation, measureText });
	return {
		layout,
		geometry: resolveChartBarColumnGeometry({ block, layout, orientation, measureText })
	};
}

describe('resolveChartBarColumnGeometry', () => {
	it('maps horizontal bars from the factual zero baseline in declaration order', () => {
		const first = geometry(barChart());
		const second = geometry(barChart());
		assert.equal(JSON.stringify(first.geometry), JSON.stringify(second.geometry));
		assert.deepEqual(
			first.geometry.marks.map((mark) => mark.id),
			['9:responses3:one', '9:responses4:many']
		);
		assert.equal(first.geometry.marks[0].bounds.x, first.layout.linearScale?.map(0));
		assert.equal(
			first.geometry.marks[1].bounds.width,
			(first.layout.linearScale?.map(744) ?? 0) - (first.layout.linearScale?.map(0) ?? 0)
		);
		assert.equal(first.geometry.marks[0].isHighlighted, false);
		assert.equal(first.geometry.marks[1].isHighlighted, true);
		assert.ok(first.geometry.marks.every((mark) => mark.revealDirection === 'forward'));
		assert.equal(first.geometry.valueLabels.length, 2);
	});

	it('maps negative columns away from zero and keeps all geometry inside the plot', () => {
		const block: ColumnChartBlock = {
			...barChart(),
			type: 'column-chart',
			domain: { min: -400, max: 800 },
			data: {
				...barChart().data,
				series: [
					{
						id: 'responses',
						label: 'Responses',
						values: [
							{ categoryId: 'one', value: -360 },
							{ categoryId: 'many', value: 744 }
						]
					}
				]
			}
		};
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const { layout, geometry: result } = geometry(block, orientation);
			const zero = layout.linearScale?.map(0) ?? 0;
			assert.equal(result.marks[0].revealDirection, 'forward');
			assert.equal(result.marks[1].revealDirection, 'reverse');
			assert.equal(result.marks[0].bounds.y, zero);
			assert.equal(result.marks[1].bounds.y + result.marks[1].bounds.height, zero);
			for (const mark of result.marks) {
				assert.ok(mark.bounds.x >= layout.plotBounds.x);
				assert.ok(mark.bounds.y >= layout.plotBounds.y);
				assert.ok(
					mark.bounds.x + mark.bounds.width <= layout.plotBounds.x + layout.plotBounds.width
				);
				assert.ok(
					mark.bounds.y + mark.bounds.height <= layout.plotBounds.y + layout.plotBounds.height
				);
			}
		}
	});

	it('reveals negative bars in reverse pixel direction from their factual baseline', () => {
		const block = barChart();
		block.domain = { min: -800, max: 800 };
		block.data.series[0].values[0].value = -360;
		const result = geometry(block).geometry;
		assert.equal(result.marks[0].revealDirection, 'reverse');
		assert.equal(result.marks[1].revealDirection, 'forward');
	});

	it('subdivides grouped categories by series without overlap', () => {
		const source = barChart();
		const block: BarChartBlock = {
			...source,
			layout: { mode: 'grouped' },
			data: {
				...source.data,
				series: [
					source.data.series[0],
					{
						id: 'returning',
						label: 'Returning',
						values: [
							{ categoryId: 'one', value: 200 },
							{ categoryId: 'many', value: 500 }
						]
					}
				]
			}
		};
		const result = geometry(block).geometry;
		assert.deepEqual(
			result.marks.map((mark) => mark.id),
			['9:responses3:one', '9:returning3:one', '9:responses4:many', '9:returning4:many']
		);
		const [first, second] = result.marks;
		assert.ok(first.bounds.y + first.bounds.height < second.bounds.y);
		assert.equal(first.bounds.height, second.bounds.height);
	});

	it('builds cumulative stacked geometry and preserves each factual segment', () => {
		const source = barChart();
		const block: ColumnChartBlock = {
			...source,
			type: 'column-chart',
			layout: { mode: 'stacked' },
			domain: { min: 0, max: 1000 },
			data: {
				...source.data,
				series: [
					source.data.series[0],
					{
						id: 'returning',
						label: 'Returning',
						values: [
							{ categoryId: 'one', value: 100 },
							{ categoryId: 'many', value: 200 }
						]
					}
				]
			}
		};
		const { layout, geometry: result } = geometry(block);
		const oneMarks = result.marks.filter((mark) => mark.categoryId === 'one');
		assert.equal(oneMarks[0].bounds.x, oneMarks[1].bounds.x);
		assert.equal(oneMarks[0].bounds.width, oneMarks[1].bounds.width);
		assert.equal(oneMarks[1].bounds.y + oneMarks[1].bounds.height, oneMarks[0].bounds.y);
		assert.equal(oneMarks[1].bounds.y, layout.linearScale?.map(460));
	});

	it('exposes target-aware 2D geometry for later annotation placement', () => {
		const result = geometry(barChart()).geometry;
		const datum = { kind: 'datum', seriesId: 'responses', categoryId: 'many' } as const;
		const total = { kind: 'series-total', seriesId: 'responses' } as const;
		assert.equal(chartMarkMatchesTarget(result.marks[1], datum), true);
		assert.deepEqual(resolveChartBarColumnTargetRect(result.marks, datum), result.marks[1].bounds);
		const totalRect = resolveChartBarColumnTargetRect(result.marks, total);
		assert.ok(totalRect);
		assert.ok(totalRect.height > result.marks[0].bounds.height);
		assert.equal(
			resolveChartBarColumnTargetRect(result.marks, {
				kind: 'series-total',
				seriesId: 'missing'
			}),
			null
		);
	});

	it('keeps zero marks factual and emits a precise zero label without inventing area', () => {
		const block = barChart();
		block.data.series[0].values[0].value = 0;
		const result = geometry(block).geometry;
		assert.equal(result.marks[0].isZero, true);
		assert.equal(result.marks[0].bounds.width, 0);
		assert.equal(result.valueLabels[0].text, '0');
		assert.equal(result.valueLabels[0].anchor, 'outside');
	});

	it('centers stacked value labels inside their factual segments for a punched chrome plate', () => {
		const source = barChart();
		const block: ColumnChartBlock = {
			...source,
			type: 'column-chart',
			layout: { mode: 'stacked' },
			domain: { min: 0, max: 1200 },
			data: {
				...source.data,
				series: [
					source.data.series[0],
					{
						id: 'returning',
						label: 'Returning',
						values: [
							{ categoryId: 'one', value: 200 },
							{ categoryId: 'many', value: 300 }
						]
					}
				]
			}
		};
		const result = geometry(block).geometry;
		assert.equal(result.valueLabels.length, 4);
		assert.equal(
			result.valueLabels.every((label) => label.anchor === 'inside'),
			true
		);
		assert.equal(
			result.marks.every((mark) => mark.cornerRadius === 0),
			true
		);
	});

	it('places computed callouts from resolved target geometry in declaration order', () => {
		const block = barChart();
		block.callouts = [
			{
				target: {
					kind: 'datum',
					seriesId: 'responses',
					categoryId: 'many'
				},
				valueLabel: {
					kind: 'approximate-fraction-and-percent',
					maxDenominator: 10,
					precision: 1
				}
			}
		];
		const result = geometry(block).geometry;
		assert.equal(result.annotations.length, 1);
		assert.equal(result.annotations[0].text, '2 in 3 · 67.4%');
		assert.equal(result.annotations[0].id, 'survey:callout:0');
		assert.equal(result.annotations[0].lane, 'local-right');
		assert.equal(
			result.annotations[0].leaderFrom.y,
			result.marks[1].bounds.y + result.marks[1].bounds.height / 2
		);
		assert.deepEqual(result.annotations[0].leaderWaypoints, []);
		assert.ok(result.annotations[0].leaderTo.x > result.annotations[0].leaderFrom.x);
		assert.equal(
			result.valueLabels.find((label) => label.markId === result.marks[1].id)?.anchor,
			'inside'
		);
	});

	it('uses a spanning bracket instead of implying an aggregate belongs to one column', () => {
		const source = barChart();
		const block: ColumnChartBlock = { ...source, type: 'column-chart' };
		block.callouts = [
			{
				target: {
					kind: 'category-set',
					seriesId: 'responses',
					categoryIds: ['one', 'many']
				},
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		];
		const result = geometry(block).geometry;
		const annotation = result.annotations[0];
		assert.ok(annotation.bracket);
		assert.equal(annotation.lane, 'local-above');
		assert.equal(annotation.bracket.from.y, annotation.bracket.to.y);
		assert.equal(annotation.bracket.from.x, result.marks[0].bounds.x);
		assert.equal(annotation.bracket.to.x, result.marks[1].bounds.x + result.marks[1].bounds.width);
		assert.equal(
			annotation.leaderFrom.x,
			(annotation.bracket.from.x + annotation.bracket.to.x) / 2
		);
	});

	it('keeps later aggregate brackets clear of earlier callout boxes', () => {
		const source = barChart();
		const block: ColumnChartBlock = {
			...source,
			type: 'column-chart',
			callouts: [
				{
					target: { kind: 'datum', seriesId: 'responses', categoryId: 'many' },
					valueLabel: { kind: 'value' }
				},
				{
					target: {
						kind: 'category-set',
						seriesId: 'responses',
						categoryIds: ['one', 'many']
					},
					valueLabel: { kind: 'percent-of-series-total', precision: 1 }
				}
			]
		};
		const result = geometry(block).geometry;
		assert.deepEqual(result.overflow, []);
		const firstBox = result.annotations[0].box;
		const bracket = result.annotations[1].bracket;
		assert.ok(bracket);
		const bracketBounds = {
			x: Math.min(bracket.from.x, bracket.to.x) - 15,
			y: Math.min(bracket.from.y, bracket.to.y) - 15,
			width: Math.abs(bracket.to.x - bracket.from.x) + 30,
			height: Math.abs(bracket.to.y - bracket.from.y) + 30
		};
		const overlaps =
			bracketBounds.x < firstBox.x + firstBox.width &&
			bracketBounds.x + bracketBounds.width > firstBox.x &&
			bracketBounds.y < firstBox.y + firstBox.height &&
			bracketBounds.y + bracketBounds.height > firstBox.y;
		assert.equal(overlaps, false);
	});

	it('moves aggregate brackets clear of taller non-target series', () => {
		const source = barChart();
		const block: ColumnChartBlock = {
			...source,
			type: 'column-chart',
			data: {
				...source.data,
				series: [
					{
						id: 'target',
						label: 'Target',
						values: [
							{ categoryId: 'one', value: 200 },
							{ categoryId: 'many', value: 220 }
						]
					},
					{
						id: 'other',
						label: 'Other',
						values: [
							{ categoryId: 'one', value: 420 },
							{ categoryId: 'many', value: 400 }
						]
					}
				]
			},
			highlights: [],
			callouts: [
				{
					target: {
						kind: 'category-set',
						seriesId: 'target',
						categoryIds: ['one', 'many']
					},
					valueLabel: { kind: 'percent-of-series-total', precision: 1 }
				}
			]
		};
		const result = geometry(block);
		const annotation = result.geometry.annotations[0];
		assert.deepEqual(result.geometry.overflow, []);
		assert.ok(annotation.bracket);
		const tallestNonTargetTop = Math.min(
			...result.geometry.marks
				.filter((mark) => mark.seriesId === 'other')
				.map((mark) => mark.bounds.y)
		);
		assert.ok(annotation.bracket.from.y + 15 <= tallestNonTargetTop);
		assert.ok(annotation.bracket.from.y - 15 >= result.layout.safeBounds.y);
	});

	it('fails closed before allocating more than four series', () => {
		const block = barChart();
		block.layout = { mode: 'grouped' };
		block.data.series = Array.from({ length: 5 }, (_, index) => ({
			id: `series-${index}`,
			label: `Series ${index}`,
			values: block.data.categories.map((category) => ({ categoryId: category.id, value: 1 }))
		}));
		const layout = resolveChartFrameLayout({ block, orientation: 'horizontal', measureText });
		assert.throws(
			() =>
				resolveChartBarColumnGeometry({
					block,
					layout,
					orientation: 'horizontal',
					measureText
				}),
			/at most 4/
		);
	});

	it('fails closed when a renderer receives incomplete data', () => {
		const block = barChart();
		block.data.series[0].values = [{ categoryId: 'one', value: 360 }];
		const layout = resolveChartFrameLayout({ block, orientation: 'horizontal', measureText });
		assert.throws(
			() =>
				resolveChartBarColumnGeometry({ block, layout, orientation: 'horizontal', measureText }),
			/has no value for category "many"/
		);
	});
});
