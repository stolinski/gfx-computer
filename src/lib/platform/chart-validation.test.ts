import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type {
	BarChartBlock,
	ChartBlock,
	ChartGroup,
	ChartMotion,
	DiagramPrimitive,
	UnitGridChartBlock
} from './engine-schema';
import { validateChartGroupSemantics } from './chart-validation';

function chartMotion(start = 0): ChartMotion {
	return {
		entry: { start, duration: 0.05, ease: 'smooth' },
		reveal: { start: start + 0.05, duration: 0.1, ease: 'smooth' },
		emphasis: { start: start + 0.15, duration: 0.05, ease: 'sharp' },
		annotation: { start: start + 0.2, duration: 0.05, ease: 'smooth' },
		exit: { start: start + 0.25, duration: 0.05, ease: 'smooth' }
	};
}

function barChart(id = 'chart-a'): BarChartBlock {
	return {
		id,
		type: 'bar-chart',
		title: 'Agent count',
		data: {
			categories: [
				{ id: 'one', label: '1' },
				{ id: 'multiple', label: '2–5' }
			],
			series: [
				{
					id: 'responses',
					label: 'Responses',
					values: [
						{ categoryId: 'one', value: 360 },
						{ categoryId: 'multiple', value: 744 }
					]
				}
			]
		},
		layout: { mode: 'single' },
		domain: { min: 0, max: 800 },
		labels: { categories: true, values: true, legend: false },
		highlights: [{ target: { kind: 'datum', seriesId: 'responses', categoryId: 'multiple' } }],
		callouts: [
			{
				target: { kind: 'datum', seriesId: 'responses', categoryId: 'multiple' },
				valueLabel: {
					kind: 'approximate-fraction-and-percent',
					maxDenominator: 10,
					precision: 1
				}
			}
		],
		sourceNote: 'Syntax survey, n=1,104',
		fill: { role: 'default' },
		motion: chartMotion()
	};
}

function unitGridChart(id = 'chart-grid'): UnitGridChartBlock {
	return {
		...barChart(id),
		type: 'unit-grid-chart',
		normalization: { total: 1104, unitCount: 100 },
		data: barChart(id).data
	};
}

function singleChart(item: ChartBlock = barChart()): ChartGroup {
	return { mode: 'single', items: [item] };
}

function issuesFor(chart: ChartGroup, diagram: readonly DiagramPrimitive[] = []) {
	return validateChartGroupSemantics(chart, diagram);
}

function assertIssue(chart: ChartGroup, path: string, message: string): void {
	const issues = issuesFor(chart);
	assert.ok(
		issues.some((issue) => issue.path.join('.') === path && issue.message.includes(message)),
		`Expected ${path} to include "${message}". Got:
${issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`
	);
}

describe('validateChartGroupSemantics', () => {
	it('accepts valid bar and normalized chart declarations', () => {
		assert.deepEqual(issuesFor(singleChart()), []);
		assert.deepEqual(issuesFor(singleChart(unitGridChart())), []);
	});

	it('enforces single and sequence cardinality', () => {
		const single = { mode: 'single', items: [barChart('a'), barChart('b')] } as ChartGroup;
		assertIssue(single, 'chart.items', 'exactly one');
		const sequence = { mode: 'sequence', items: [barChart()] } as ChartGroup;
		assertIssue(sequence, 'chart.items', 'two through four');
	});

	it('rejects duplicate chart IDs and cross-Diagram Block collisions', () => {
		const chart = { mode: 'sequence', items: [barChart('same'), barChart('same')] } as ChartGroup;
		assertIssue(chart, 'chart.items.1.id', 'Duplicate chart Block id');
		const diagram = [
			{ id: 'same', type: 'label', position: { x: 0.5, y: 0.5 }, text: 'x' }
		] as DiagramPrimitive[];
		assert.ok(
			issuesFor(singleChart(barChart('same')), diagram).some((issue) =>
				issue.message.includes('surface.diagram')
			)
		);
	});

	it('rejects duplicate category and series IDs', () => {
		const chart = singleChart();
		chart.items[0].data.categories[1].id = 'one';
		chart.items[0].data.series.push({ ...chart.items[0].data.series[0], values: [] });
		assertIssue(chart, 'chart.items.0.data.categories.1.id', 'Duplicate chart category');
		assertIssue(chart, 'chart.items.0.data.series.1.id', 'Duplicate chart series');
	});

	it('allows authored emphasis and annotation windows to be deterministic no-ops', () => {
		const chart = singleChart();
		chart.items[0].highlights = [];
		chart.items[0].callouts = [];
		chart.items[0].labels.values = false;
		assert.deepEqual(issuesFor(chart), []);
	});

	it('rejects emphasis as a base fill when authored highlights require contrast', () => {
		const chart = singleChart();
		chart.items[0].fill = { role: 'emphasis' };
		assertIssue(chart, 'chart.items.0.fill.role', 'cannot use emphasis as the base fill');
		chart.items[0].highlights = [];
		assertIssue(chart, 'chart.items.0.fill.role', 'reserved for choreography');
	});

	it('rejects missing, repeated, and unknown category values', () => {
		const missing = singleChart();
		missing.items[0].data.series[0].values.pop();
		assertIssue(missing, 'chart.items.0.data.series.0.values', 'missing category');

		const repeated = singleChart();
		repeated.items[0].data.series[0].values[1].categoryId = 'one';
		assertIssue(repeated, 'chart.items.0.data.series.0.values.1.categoryId', 'repeats category');

		const unknown = singleChart();
		unknown.items[0].data.series[0].values[1].categoryId = 'missing';
		assertIssue(unknown, 'chart.items.0.data.series.0.values.1.categoryId', 'unknown category');
	});

	it('enforces single, grouped, and stacked series shape', () => {
		const single = singleChart();
		single.items[0].data.series.push({
			id: 'other',
			label: 'Other',
			values: [
				{ categoryId: 'one', value: 1 },
				{ categoryId: 'multiple', value: 2 }
			]
		});
		assertIssue(single, 'chart.items.0.layout.mode', 'exactly one series');

		const grouped = singleChart();
		if (grouped.items[0].type !== 'bar-chart') throw new Error('fixture type');
		grouped.items[0].layout.mode = 'grouped';
		assertIssue(grouped, 'chart.items.0.layout.mode', 'at least two series');
	});

	it('rejects negative stacked values', () => {
		const chart = singleChart();
		if (chart.items[0].type !== 'bar-chart') throw new Error('fixture type');
		chart.items[0].layout.mode = 'stacked';
		chart.items[0].data.series.push({
			id: 'other',
			label: 'Other',
			values: [
				{ categoryId: 'one', value: -1 },
				{ categoryId: 'multiple', value: 1 }
			]
		});
		assertIssue(chart, 'chart.items.0.data.series.1.values.0.value', 'non-negative');
	});

	it('rejects invalid, zero-excluding, and clipping domains', () => {
		const invalid = singleChart();
		invalid.items[0].domain = { min: 10, max: 0 };
		assertIssue(invalid, 'chart.items.0.domain', 'min must be less');
		assertIssue(invalid, 'chart.items.0.domain.min', 'include zero');

		const clipped = singleChart();
		clipped.items[0].domain = { min: 0, max: 700 };
		assertIssue(clipped, 'chart.items.0.domain.max', 'clips value 744');
	});

	it('validates normalized totals, non-negative parts, and tolerance', () => {
		const negative = singleChart(unitGridChart());
		negative.items[0].data.series[0].values[0].value = -1;
		assertIssue(negative, 'chart.items.0.data.series.0.values.0.value', 'non-negative');

		const mismatch = singleChart(unitGridChart());
		if (mismatch.items[0].type !== 'unit-grid-chart') throw new Error('fixture type');
		mismatch.items[0].normalization.total = 1105;
		assertIssue(mismatch, 'chart.items.0.normalization.total', 'parts sum');

		const tolerance = singleChart(unitGridChart());
		if (tolerance.items[0].type !== 'unit-grid-chart') throw new Error('fixture type');
		tolerance.items[0].normalization.total = 1104 + 1e-7;
		assert.deepEqual(issuesFor(tolerance), []);
	});

	it('rejects unresolved and duplicate data targets', () => {
		const missingSeries = singleChart();
		missingSeries.items[0].callouts![0].target.seriesId = 'missing';
		assertIssue(missingSeries, 'chart.items.0.callouts.0.target.seriesId', 'Unknown chart series');

		const duplicateSet = singleChart();
		duplicateSet.items[0].callouts![0].target = {
			kind: 'category-set',
			seriesId: 'responses',
			categoryIds: ['one', 'one']
		};
		assertIssue(
			duplicateSet,
			'chart.items.0.callouts.0.target.categoryIds.1',
			'Duplicate chart target'
		);
	});

	it('guards percent and approximate-fraction formatter domains', () => {
		const nonPositiveTotal = singleChart();
		nonPositiveTotal.items[0].data.series[0].values[0].value = -744;
		assertIssue(nonPositiveTotal, 'chart.items.0.callouts.0.valueLabel', 'positive series total');

		const zero = singleChart();
		zero.items[0].data.series[0].values[1].value = 0;
		assertIssue(zero, 'chart.items.0.callouts.0.valueLabel', 'ratio in (0, 1]');

		const aboveOne = singleChart();
		aboveOne.items[0].data.series[0].values[0].value = -1;
		assertIssue(aboveOne, 'chart.items.0.callouts.0.valueLabel', 'ratio in (0, 1]');

		const unity = singleChart();
		unity.items[0].data.series[0].values[0].value = 0;
		assert.deepEqual(issuesFor(unity), []);
	});

	it('rejects non-finite derived series, stack, and target totals', () => {
		const seriesOverflow = singleChart();
		seriesOverflow.items[0].data.series[0].values[0].value = Number.MAX_VALUE;
		seriesOverflow.items[0].data.series[0].values[1].value = Number.MAX_VALUE;
		assertIssue(
			seriesOverflow,
			'chart.items.0.data.series.0.values',
			'series "responses" total must be finite'
		);

		const stackOverflow = singleChart();
		if (stackOverflow.items[0].type !== 'bar-chart') throw new Error('fixture type');
		stackOverflow.items[0].layout.mode = 'stacked';
		stackOverflow.items[0].domain = undefined;
		stackOverflow.items[0].data.series[0].values = [
			{ categoryId: 'one', value: Number.MAX_VALUE },
			{ categoryId: 'multiple', value: 0 }
		];
		stackOverflow.items[0].data.series.push({
			id: 'other',
			label: 'Other',
			values: [
				{ categoryId: 'one', value: Number.MAX_VALUE },
				{ categoryId: 'multiple', value: 0 }
			]
		});
		assertIssue(stackOverflow, 'chart.items.0.data.series', 'Stacked chart total');

		const targetOverflow = singleChart();
		targetOverflow.items[0].data.categories.push({ id: 'offset', label: 'Offset' });
		targetOverflow.items[0].data.series[0].values = [
			{ categoryId: 'one', value: Number.MAX_VALUE },
			{ categoryId: 'multiple', value: Number.MAX_VALUE },
			{ categoryId: 'offset', value: -Number.MAX_VALUE }
		];
		targetOverflow.items[0].callouts![0] = {
			target: {
				kind: 'category-set',
				seriesId: 'responses',
				categoryIds: ['one', 'multiple']
			},
			valueLabel: { kind: 'value' }
		};
		assertIssue(
			targetOverflow,
			'chart.items.0.callouts.0.target',
			'Resolved chart target value must be finite'
		);
	});

	it('preserves series and target declaration order for cancellation-sensitive sums', () => {
		const chart = singleChart();
		chart.items[0].data.categories = [
			{ id: 'alpha', label: 'A' },
			{ id: 'beta', label: 'B' },
			{ id: 'gamma', label: 'C' }
		];
		chart.items[0].data.series[0].values = [
			{ categoryId: 'alpha', value: 1e16 },
			{ categoryId: 'gamma', value: -1e16 },
			{ categoryId: 'beta', value: 1 }
		];
		chart.items[0].domain = { min: -1e16, max: 1e16 };
		chart.items[0].highlights = undefined;
		chart.items[0].callouts = [
			{
				target: { kind: 'series-total', seriesId: 'responses' },
				valueLabel: { kind: 'percent-of-series-total', precision: 1 }
			}
		];
		const issues = issuesFor(chart);
		assert.equal(
			issues.some((issue) => issue.message.includes('positive series total')),
			false
		);
	});

	it('rejects phase overflow and phase overlap while permitting gaps', () => {
		const overflow = singleChart();
		overflow.items[0].motion.exit = { start: 0.98, duration: 0.05 };
		assertIssue(overflow, 'chart.items.0.motion.exit.duration', 'ends after 1');

		const overlap = singleChart();
		overlap.items[0].motion.emphasis.start = 0.1;
		assertIssue(overlap, 'chart.items.0.motion.emphasis.start', 'previous phase ends');

		const gap = singleChart();
		gap.items[0].motion.exit.start = 0.8;
		assert.deepEqual(issuesFor(gap), []);
	});

	it('requires ordered non-overlapping sequence visibility intervals', () => {
		const first = barChart('first');
		const second = barChart('second');
		second.motion = chartMotion(0.2);
		const chart = { mode: 'sequence', items: [first, second] } as ChartGroup;
		assertIssue(chart, 'chart.items.1.motion.entry.start', 'previous item exits');
		second.motion = chartMotion(0.3);
		assert.deepEqual(issuesFor(chart), []);
	});
	it('rejects charts on Surfaces that cannot composite analytic chart marks', () => {
		const issues = validateChartGroupSemantics(singleChart(), [], 'checklist');
		assert.ok(
			issues.some(
				(issue) => issue.path.join('.') === 'chart' && issue.message.includes('plain or paper')
			)
		);
	});
});
