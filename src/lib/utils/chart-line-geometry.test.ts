import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { LineChartBlock } from '$lib/platform/engine-schema';
import { resolveChartFrameLayout } from './chart-layout';
import { resolveChartLineGeometry } from './chart-line-geometry';
import { createChartRenderTextMeasurer } from './chart-text-measurement';

function lineChart(): LineChartBlock {
	return {
		id: 'trend',
		type: 'line-chart',
		title: 'Measured trend',
		data: {
			categories: [
				{ id: 'q1', label: 'Q1' },
				{ id: 'q2', label: 'Q2' },
				{ id: 'q3', label: 'Q3' }
			],
			series: [
				{
					id: 'actual',
					label: 'Actual',
					values: [
						{ categoryId: 'q1', value: 42 },
						{ categoryId: 'q2', value: 57 },
						{ categoryId: 'q3', value: 51 }
					]
				}
			]
		},
		domain: { min: 0, max: 60 },
		labels: { categories: true, values: true, legend: true },
		fill: { role: 'series' },
		motion: {
			entry: { start: 0.05, duration: 0.08 },
			reveal: { start: 0.13, duration: 0.18 },
			emphasis: { start: 0.31, duration: 0.08 },
			annotation: { start: 0.39, duration: 0.1 },
			exit: { start: 0.84, duration: 0.1 }
		}
	};
}

describe('resolveChartLineGeometry', () => {
	it('maps declaration-order facts to connected points at both native targets', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const block = lineChart();
			const measureText = createChartRenderTextMeasurer(orientation);
			const layout = resolveChartFrameLayout({ block, orientation, measureText });
			const geometry = resolveChartLineGeometry({ block, layout, orientation, measureText });
			assert.deepEqual(layout.overflow, []);
			assert.deepEqual(geometry.overflow, []);
			assert.equal(geometry.series.length, 1);
			assert.equal(geometry.series[0].points.length, 3);
			assert.deepEqual(
				geometry.marks.map((mark) => mark.value),
				[42, 57, 51]
			);
			assert.deepEqual(
				geometry.valueLabels.map((label) => label.text),
				['42', '57', '51']
			);
			assert.ok(geometry.series[0].points[1].y < geometry.series[0].points[0].y);
		}
	});
});
