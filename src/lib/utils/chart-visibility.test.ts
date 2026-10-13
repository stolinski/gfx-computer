import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { BarChartBlock, ChartGroup, ChartMotion } from '$lib/platform/engine-schema';
import { resolveVisibleChartBlock } from './chart-visibility';

function motion(entry: number, exit: number): ChartMotion {
	return {
		entry: { start: entry, duration: 0.05 },
		reveal: { start: entry + 0.05, duration: 0.05 },
		emphasis: { start: entry + 0.1, duration: 0.05 },
		annotation: { start: entry + 0.15, duration: 0.05 },
		exit: { start: exit, duration: 0.05 }
	};
}
function block(id: string, entry: number, exit: number): BarChartBlock {
	return {
		id,
		type: 'bar-chart',
		title: id,
		data: {
			categories: [{ id: 'a', label: 'A' }],
			series: [{ id: 's', label: 'S', values: [{ categoryId: 'a', value: 1 }] }]
		},
		layout: { mode: 'single' },
		labels: { values: false, legend: false },
		fill: { role: 'default' },
		motion: motion(entry, exit)
	};
}

describe('resolveVisibleChartBlock', () => {
	it('uses deterministic half-open visibility windows for chart sequences', () => {
		const chart: ChartGroup = {
			mode: 'sequence',
			items: [block('first', 0, 0.4), block('second', 0.45, 0.9)]
		};
		assert.equal(resolveVisibleChartBlock(chart, 0)?.id, 'first');
		assert.equal(resolveVisibleChartBlock(chart, 0.449999)?.id, 'first');
		assert.equal(resolveVisibleChartBlock(chart, 0.45)?.id, 'second');
		assert.equal(resolveVisibleChartBlock(chart, 0.95), null);
	});

	it('clamps finite out-of-range progress and rejects non-finite progress', () => {
		const chart: ChartGroup = { mode: 'single', items: [block('only', 0, 0.9)] };
		assert.equal(resolveVisibleChartBlock(chart, -1)?.id, 'only');
		assert.equal(resolveVisibleChartBlock(undefined, 0.2), null);
		assert.throws(() => resolveVisibleChartBlock(chart, Number.NaN), /finite/);
	});
});
