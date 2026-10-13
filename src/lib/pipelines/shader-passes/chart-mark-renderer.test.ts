import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import type { BarChartBlock, ChartMotion } from '$lib/platform/engine-schema';
import { PACK_REGISTRY } from '$lib/platform/packs/registry';
import { resolveChartMarkFillTreatment } from '$lib/platform/packs/resolve';
import type { ChartRenderInputs } from '$lib/platform/pipelines/types';
import { resolveChartBarColumnGeometry } from '$lib/utils/chart-bar-column-geometry';
import { resolveChartFrameLayout } from '$lib/utils/chart-layout';
import { chartRenderTextMeasurer } from '$lib/utils/chart-text-measurement';
import {
	countChartMarkRendererInstances,
	packChartMarkRendererInstances
} from './chart-mark-renderer';

function motion(): ChartMotion {
	return {
		entry: { start: 0, duration: 0.1 },
		reveal: { start: 0.1, duration: 0.1 },
		emphasis: { start: 0.2, duration: 0.1 },
		annotation: { start: 0.3, duration: 0.1 },
		exit: { start: 0.8, duration: 0.1 }
	};
}
function block(): BarChartBlock {
	return {
		id: 'grouped',
		type: 'bar-chart',
		title: 'Grouped',
		data: {
			categories: [{ id: 'a', label: 'A' }],
			series: [
				{ id: 'first', label: 'First', values: [{ categoryId: 'a', value: 4 }] },
				{ id: 'second', label: 'Second', values: [{ categoryId: 'a', value: 8 }] }
			]
		},
		layout: { mode: 'grouped' },
		domain: { min: 0, max: 10 },
		labels: { values: false, legend: true },
		highlights: [{ target: { kind: 'datum', seriesId: 'second', categoryId: 'a' } }],
		fill: { role: 'series' },
		motion: motion()
	};
}
function inputs(): ChartRenderInputs {
	const chart = block();
	const layout = resolveChartFrameLayout({
		block: chart,
		orientation: 'horizontal',
		measureText: chartRenderTextMeasurer
	});
	const geometry = resolveChartBarColumnGeometry({
		block: chart,
		layout,
		orientation: 'horizontal',
		measureText: chartRenderTextMeasurer
	});
	return {
		block: chart,
		marks: geometry.marks.map((mark, index) => ({
			bounds: mark.bounds,
			cornerRadius: mark.cornerRadius,
			fillVoiceIndex: mark.fillVoiceIndex,
			labelPlateBounds: null,
			labelPlateProgress: 0.5,
			revealProgress: index === 0 ? 0.25 : 0.75,
			revealAxis: 'inline' as const,
			revealDirection: index === 0 ? ('forward' as const) : ('reverse' as const),
			emphasisProgress: index === 0 ? 0 : 0.5
		})),
		swatches: geometry.legendSwatches.map((swatch) => ({
			bounds: swatch.bounds,
			cornerRadius: swatch.cornerRadius,
			fillVoiceIndex: swatch.fillVoiceIndex
		})),
		baseFillByVoice: chart.data.series.map((_, index) =>
			resolveChartMarkFillTreatment(PACK_REGISTRY.syntax, 'series', index)
		),
		emphasisFillByVoice: chart.data.series.map((_, index) =>
			resolveChartMarkFillTreatment(PACK_REGISTRY.syntax, 'emphasis', index)
		),
		alpha: 0.75
	};
}

describe('packChartMarkRendererInstances', () => {
	it('packs factual bounds, fill discriminators, reveal direction, continuous emphasis, and alpha', () => {
		const source = inputs();
		const packed = packChartMarkRendererInstances(source, 3840, 2160);
		assert.equal(packed.byteLength, countChartMarkRendererInstances(source) * 176);
		assert.equal(countChartMarkRendererInstances(source), 4);
		const view = new DataView(packed);
		assert.ok(Math.abs(view.getFloat32(0, true) - source.marks[0].bounds.x) < 1e-4);
		assert.ok(Math.abs(view.getFloat32(8, true) - source.marks[0].bounds.width) < 1e-4);
		assert.equal(view.getUint32(96, true), 0);
		assert.equal(view.getUint32(176 + 96, true), 1);
		assert.equal(view.getUint32(112 + 12, true), 0);
		assert.equal(view.getFloat32(176 + 144 + 4, true), 0.5);
		assert.equal(view.getFloat32(80 + 12, true), 0.75);
		assert.equal(view.getFloat32(144, true), 0.25);
		assert.equal(view.getFloat32(160, true), 0.5);
		assert.equal(view.getFloat32(144 + 8, true), 0);
		assert.equal(view.getFloat32(176 + 144, true), 0.75);
		assert.equal(view.getFloat32(176 + 144 + 12, true), 1);
		assert.equal(view.getFloat32(16 + 12, true), 1);
		assert.notEqual(view.getFloat32(20, true), view.getFloat32(176 + 20, true));
	});

	it('packs one thousand normalized-style mark voices in one bounded instance buffer', () => {
		const source = inputs();
		const marks = Array.from({ length: 1000 }, (_, index) => ({
			...source.marks[index % source.marks.length],
			fillVoiceIndex: index % 2,
			bounds: { x: index % 100, y: Math.floor(index / 100), width: 1, height: 1 }
		}));
		const packed = packChartMarkRendererInstances({ ...source, marks }, 3840, 2160);
		assert.equal(packed.byteLength, (1000 + source.swatches.length) * 176);
		assert.equal(new DataView(packed).getUint32(999 * 176 + 96, true), 1);
	});

	it('fails closed when treatment cardinality does not match the declaration', () => {
		const source = inputs();
		assert.throws(
			() =>
				packChartMarkRendererInstances(
					{ ...source, baseFillByVoice: source.baseFillByVoice.slice(0, 1) },
					3840,
					2160
				),
			/matching base and emphasis fill voices/
		);
	});

	it('fails closed on invalid chart or per-mark motion progress', () => {
		const source = inputs();
		assert.throws(
			() => packChartMarkRendererInstances({ ...source, alpha: Number.NaN }, 3840, 2160),
			/alpha must be finite/
		);
		const marks = source.marks.map((mark, index) =>
			index === 0 ? { ...mark, revealProgress: 1.1 } : mark
		);
		assert.throws(
			() => packChartMarkRendererInstances({ ...source, marks }, 3840, 2160),
			/motion progress must be finite/
		);
		const invalidDirection = source.marks.map((mark, index) =>
			index === 0
				? ({ ...mark, revealDirection: 'sideways' } as unknown as (typeof source.marks)[number])
				: mark
		);
		assert.throws(
			() => packChartMarkRendererInstances({ ...source, marks: invalidDirection }, 3840, 2160),
			/reveal direction/
		);
	});
});
