import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type {
	BarChartBlock,
	ChartMotion,
	ColumnChartBlock,
	DotFieldChartBlock,
	UnitGridChartBlock
} from '$lib/platform/engine-schema';
import {
	resolveChartAuthoredFrame,
	resolveChartFrameLayout,
	resolveChartLayoutBounds,
	resolveChartSafeBounds,
	type ChartTextMeasurer
} from './chart-layout';

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
		title: 'How many agents?',
		data: {
			categories: [
				{ id: 'one', label: '1' },
				{ id: 'many', label: '2–5' }
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
		labels: { categories: true, values: true, legend: true },
		callouts: [
			{
				target: { kind: 'datum', seriesId: 'responses', categoryId: 'many' },
				valueLabel: { kind: 'value' }
			}
		],
		sourceNote: 'Source: Syntax survey, n=1,104',
		fill: { role: 'default' },
		motion: motion()
	};
}
const measureText: ChartTextMeasurer = ({ text, role }) => ({
	width: text.length * (role === 'title' ? 34 : 22),
	height: role === 'title' ? 92 : 48
});

function inside(
	inner: { x: number; y: number; width: number; height: number },
	outer: { x: number; y: number; width: number; height: number }
): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

describe('resolveChartSafeBounds', () => {
	it('uses native target sizes and the shared platform safe-area policy', () => {
		assert.deepEqual(resolveChartSafeBounds('horizontal'), {
			x: 196,
			y: 108,
			width: 3448,
			height: 1944
		});
		const vertical = resolveChartSafeBounds('vertical');
		assert.equal(vertical.x, 112);
		assert.ok(Math.abs(vertical.y - 230.4) < 1e-9);
		assert.ok(Math.abs(vertical.width - 1849.6) < 1e-9);
		assert.ok(Math.abs(vertical.height - 2995.2) < 1e-9);
	});
});

describe('resolveChartFrameLayout', () => {
	it('reflows one declaration deterministically inside both native safe areas', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const first = resolveChartFrameLayout({ block: barChart(), orientation, measureText });
			const second = resolveChartFrameLayout({ block: barChart(), orientation, measureText });
			assert.equal(JSON.stringify(first), JSON.stringify(second));
			assert.equal(inside(first.plotBounds, first.safeBounds), true);
			assert.equal(first.frame.width, orientation === 'horizontal' ? 3840 : 2160);
			assert.equal(first.chrome.title.origin.x, first.safeBounds.x);
			assert.ok(first.chrome.title.origin.y > first.safeBounds.y);
			assert.ok(first.chrome.calloutLane);
			assert.equal(first.overflow.length, 0);
		}
	});

	it('builds factual bar axes, a zero baseline, ticks, labels, legend, counters, and source chrome', () => {
		const layout = resolveChartFrameLayout({
			block: barChart(),
			orientation: 'horizontal',
			measureText
		});
		assert.ok(layout.linearScale);
		assert.equal(layout.linearScale.map(0), layout.plotBounds.x);
		assert.equal(layout.linearScale.map(800), layout.plotBounds.x + layout.plotBounds.width);
		assert.equal(
			layout.axes.linearTicks.some((tick) => tick.isZero && tick.value === 0),
			true
		);
		assert.deepEqual(
			layout.axes.categoryLabels.map((label) => label.categoryId),
			['one', 'many']
		);
		assert.deepEqual(
			layout.chrome.counterSlots.map((slot) => slot.text),
			['360', '744']
		);
		assert.equal(layout.chrome.legendItems[0].itemId, 'responses');
		assert.ok(
			layout.chrome.legendItems[0].swatch.height >=
				layout.chrome.legendItems[0].labelLayout.measurement.height * 0.5
		);
		assert.equal(layout.chrome.sourceNote?.text, 'Source: Syntax survey, n=1,104');
	});

	it('reverses the numeric pixel range for columns without changing the domain', () => {
		const block = { ...barChart(), type: 'column-chart' } satisfies ColumnChartBlock;
		const layout = resolveChartFrameLayout({ block, orientation: 'horizontal', measureText });
		assert.ok(layout.linearScale);
		assert.equal(layout.linearScale.map(0), layout.plotBounds.y + layout.plotBounds.height);
		assert.equal(layout.linearScale.map(800), layout.plotBounds.y);
		assert.equal(layout.axes.zeroBaseline?.from.y, layout.plotBounds.y + layout.plotBounds.height);
	});

	it('reserves shared chrome but does not invent a linear axis for normalized families', () => {
		const source = barChart();
		const block: UnitGridChartBlock = {
			id: source.id,
			type: 'unit-grid-chart',
			title: source.title,
			data: source.data,
			normalization: { total: 1104, unitCount: 100 },
			labels: source.labels,
			callouts: source.callouts,
			sourceNote: source.sourceNote,
			fill: source.fill,
			motion: source.motion
		};
		const layout = resolveChartFrameLayout({ block, orientation: 'vertical', measureText });
		assert.equal(layout.linearScale, null);
		assert.deepEqual(layout.axes.linearTicks, []);
		assert.ok(layout.chrome.calloutLane);
		assert.equal(inside(layout.plotBounds, layout.safeBounds), true);
	});

	it('reports unrenderable measurements and bounded-layout overflow instead of clipping silently', () => {
		const huge: ChartTextMeasurer = ({ text, role }) => ({
			width: role === 'title' ? 9000 : text.length * 800,
			height: role === 'legend' ? 1000 : 80
		});
		const layout = resolveChartFrameLayout({
			block: barChart(),
			orientation: 'vertical',
			measureText: huge
		});
		assert.equal(
			layout.overflow.some((issue) => issue.code === 'title-too-wide'),
			true
		);
		assert.equal(
			layout.overflow.some((issue) => issue.code === 'legend-too-tall'),
			true
		);
		assert.equal(
			layout.overflow.some((issue) => issue.code === 'category-label-too-wide'),
			true
		);
		assert.equal(
			layout.overflow.some((issue) => issue.code === 'plot-too-small'),
			true
		);
		const invalid = resolveChartFrameLayout({
			block: barChart(),
			orientation: 'horizontal',
			measureText: () => ({ width: Number.NaN, height: 0 })
		});
		assert.equal(
			invalid.overflow.some((issue) => issue.code === 'invalid-measurement'),
			true
		);
	});

	it('keeps every returned readable rectangle safe when layout reports no overflow', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			for (const block of [
				barChart(),
				{ ...barChart(), type: 'column-chart' } satisfies ColumnChartBlock
			]) {
				block.labels.categories = false;
				const layout = resolveChartFrameLayout({ block, orientation, measureText });
				assert.deepEqual(layout.overflow, []);
				const readable = [
					layout.chrome.title,
					...layout.chrome.legendItems.map((item) => item.labelLayout),
					...layout.axes.linearTicks.map((tick) => tick.labelLayout),
					...layout.axes.categoryLabels.map((label) => label.labelLayout),
					...(layout.chrome.sourceNote ? [layout.chrome.sourceNote] : [])
				];
				for (const text of readable) {
					assert.equal(
						inside(
							{ ...text.origin, width: text.measurement.width, height: text.measurement.height },
							layout.safeBounds
						),
						true
					);
				}
			}
		}
	});

	it('reports wide tick, category, legend, counter, and tall-title layout failures', () => {
		const block = { ...barChart(), type: 'column-chart' } satisfies ColumnChartBlock;
		block.data.categories[0].label =
			'A category label that cannot fit one narrow declaration-order band';
		block.data.series[0].label = 'A'.repeat(300);
		const hostile: ChartTextMeasurer = ({ text, role }) => ({
			width: role === 'axis' ? 900 : role === 'value' ? 5000 : text.length * 28,
			height: role === 'title' ? 2500 : 64
		});
		const layout = resolveChartFrameLayout({
			block,
			orientation: 'horizontal',
			measureText: hostile
		});
		for (const code of [
			'legend-item-too-wide',
			'category-label-too-wide',
			'counter-too-large',
			'plot-too-small'
		] as const) {
			assert.equal(
				layout.overflow.some((issue) => issue.code === code),
				true,
				code
			);
		}
		assert.equal(
			layout.overflow.some(
				(issue) => issue.code === 'text-collision' || issue.code === 'text-outside-safe'
			),
			true
		);
	});

	it('lays out normalized category chrome for both families and honors explicit omission', () => {
		const source = barChart();
		const common = {
			id: source.id,
			title: source.title,
			data: source.data,
			normalization: { total: 1104, unitCount: 100 },
			labels: source.labels,
			callouts: source.callouts,
			sourceNote: source.sourceNote,
			fill: source.fill,
			motion: source.motion
		};
		const blocks: [UnitGridChartBlock, DotFieldChartBlock] = [
			{ ...common, type: 'unit-grid-chart' },
			{ ...common, type: 'dot-field-chart' }
		];
		for (const block of blocks) {
			block.labels.categories = true;
			const visible = resolveChartFrameLayout({ block, orientation: 'vertical', measureText });
			assert.deepEqual(
				visible.chrome.legendItems.map((item) => [item.itemId, item.labelLayout.text]),
				[
					['one', '1 · 360'],
					['many', '2–5 · 744']
				]
			);
			assert.deepEqual(visible.axes.categoryLabels, []);
			block.labels = { categories: false, values: false, legend: false };
			const hidden = resolveChartFrameLayout({ block, orientation: 'horizontal', measureText });
			assert.deepEqual(hidden.chrome.legendItems, []);
		}
	});

	it('reports deterministic category collisions for dense declarations', () => {
		const block = { ...barChart(), type: 'column-chart' } satisfies ColumnChartBlock;
		block.data.categories = Array.from({ length: 30 }, (_, index) => ({
			id: `c${index}`,
			label: `Category ${index}`
		}));
		block.data.series[0].values = block.data.categories.map((category, index) => ({
			categoryId: category.id,
			value: index + 1
		}));
		const layout = resolveChartFrameLayout({ block, orientation: 'vertical', measureText });
		assert.equal(
			layout.overflow.some(
				(issue) => issue.code === 'category-label-too-wide' || issue.code === 'text-collision'
			),
			true
		);
	});

	it('defaults omitted category-label visibility without mutating the declaration', () => {
		const block = barChart();
		block.labels.categories = undefined;
		const before = structuredClone(block);
		const layout = resolveChartFrameLayout({ block, orientation: 'horizontal', measureText });
		assert.equal(layout.axes.categoryLabels.length, 2);
		assert.deepEqual(block, before);
	});
});

describe('authored chart frame', () => {
	it('keeps the automatic title-safe layout when no frame is authored', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			assert.equal(resolveChartAuthoredFrame(barChart(), orientation), null);
			assert.deepEqual(
				resolveChartLayoutBounds(barChart(), orientation),
				resolveChartSafeBounds(orientation)
			);
		}
	});

	it('lays the chart out inside the frame its orientation resolves to', () => {
		const block: BarChartBlock = {
			...barChart(),
			frame: { x: 0.4, y: 0.1, width: 0.55, height: 0.8 },
			frameOrientationOverrides: { vertical: { x: 0.05, y: 0.1, width: 0.86, height: 0.5 } }
		};
		assert.deepEqual(resolveChartLayoutBounds(block, 'horizontal'), {
			x: 0.4 * 3840,
			y: 0.1 * 2160,
			width: 0.55 * 3840,
			height: 0.8 * 2160
		});
		assert.deepEqual(resolveChartLayoutBounds(block, 'vertical'), {
			x: 0.05 * 2160,
			y: 0.1 * 3840,
			width: 0.86 * 2160,
			height: 0.5 * 3840
		});
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const bounds = resolveChartLayoutBounds(block, orientation);
			const layout = resolveChartFrameLayout({ block, orientation, measureText });
			assert.deepEqual(layout.safeBounds, bounds);
			assert.ok(layout.plotBounds.x >= bounds.x && layout.plotBounds.y >= bounds.y);
			assert.ok(
				layout.plotBounds.x + layout.plotBounds.width <= bounds.x + bounds.width + 1e-6 &&
					layout.plotBounds.y + layout.plotBounds.height <= bounds.y + bounds.height + 1e-6
			);
		}
	});
});
