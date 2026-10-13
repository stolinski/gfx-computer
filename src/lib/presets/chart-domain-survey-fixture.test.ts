import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import fixtureJson from './chart-domain-survey-fixture.json';
import type { ChartBlock } from '../platform/engine-schema';
import { parsePresetIngress } from '../platform/preset-ingress';
import { listFixtures, listPresets } from '../platform/preset-catalog';
import { parsePreset } from '../platform/preset-parser';
import { presetToWireFormat } from '../platform/preset-pure';
import { validatePresetSemantics } from '../platform/preset-validation';
import { resolveChartDataTarget } from '../utils/chart-data-target';
import { allocateChartNormalizedUnits } from '../utils/chart-normalized-allocation';
import { resolveChartFrameLayout } from '../utils/chart-layout';
import { createChartRenderTextMeasurer } from '../utils/chart-text-measurement';
import {
	resolveChartBarColumnGeometry,
	type ChartBarColumnGeometry
} from '../utils/chart-bar-column-geometry';
import {
	resolveChartNormalizedGeometry,
	type ChartNormalizedGeometry
} from '../utils/chart-normalized-geometry';

const fixture = parsePresetIngress(fixtureJson);
const chart = fixture.state.surface.chart;

if (!chart) throw new Error('Chart-domain fixture must declare a chart group.');

describe('chart-domain survey fixture', () => {
	it('stays an unlisted Pack-neutral full-frame fixture with all four chart Pipelines', () => {
		assert.equal(fixture.kind, 'fixture');
		assert.equal(fixture.state.backgroundFill, 'pack');
		assert.equal(chart.mode, 'sequence');
		assert.deepEqual(
			chart.items.map((item) => item.type),
			['column-chart', 'bar-chart', 'unit-grid-chart', 'dot-field-chart']
		);
		assert.equal(
			listPresets().some((entry) => entry.slug === 'chart-domain-survey-fixture'),
			false
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'chart-domain-survey-fixture'),
			true
		);
		assert.equal(JSON.stringify(fixture).includes('#'), false);
	});

	it('preserves the supplied survey facts and exact computed 744-of-1,104 targets', () => {
		const expectedDistribution = [360, 354, 237, 73, 80];
		for (const item of chart.items) {
			const values = item.data.series[0].values.map((datum) => datum.value);
			assert.deepEqual(
				values,
				item.data.categories.length === 5 ? expectedDistribution : [360, 744]
			);
			assert.equal(
				values.reduce((sum, value) => sum + value, 0),
				1104
			);
			const callout = item.callouts?.[0];
			assert.ok(callout);
			const target = resolveChartDataTarget(item, callout.target);
			assert.equal(target.value, 744);
			assert.equal(target.seriesTotal, 1104);
			assert.equal(callout.valueLabel.kind, 'approximate-fraction-and-percent');
		}
	});

	it('allocates normalized marks exactly and keeps sequence visibility windows disjoint', () => {
		for (const item of chart.items) {
			if (item.type === 'unit-grid-chart' || item.type === 'dot-field-chart') {
				const allocation = allocateChartNormalizedUnits(item);
				assert.equal(allocation.unitCategoryIndexes.length, item.normalization.unitCount);
			}
		}
		for (let index = 1; index < chart.items.length; index += 1) {
			const previousItem: ChartBlock | undefined = chart.items[index - 1];
			const currentItem: ChartBlock | undefined = chart.items[index];
			if (!previousItem || !currentItem) throw new Error('Missing chart sequence item.');
			assert.ok(
				previousItem.motion.exit.start + previousItem.motion.exit.duration <=
					currentItem.motion.entry.start
			);
		}
	});

	it('keeps broadcast-paced entries, shorter exits, and a readable settled annotation hold', () => {
		for (const item of chart.items) {
			const entryMilliseconds =
				item.motion.entry.duration * fixture.state.transport.durationSeconds * 1000;
			const exitMilliseconds =
				item.motion.exit.duration * fixture.state.transport.durationSeconds * 1000;
			const settledHoldSeconds =
				(item.motion.exit.start -
					(item.motion.annotation.start + item.motion.annotation.duration)) *
				fixture.state.transport.durationSeconds;
			assert.ok(Math.abs(entryMilliseconds - 300) < 1e-9);
			assert.ok(Math.abs(exitMilliseconds - 216) < 1e-9);
			assert.ok(exitMilliseconds <= entryMilliseconds * 0.8);
			assert.ok(settledHoldSeconds >= 1.7);
		}
	});

	it('keeps every survey scene readable with safe annotation geometry at both native targets', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			for (const block of chart.items) {
				const measureText = createChartRenderTextMeasurer(orientation);
				const layout = resolveChartFrameLayout({ block, orientation, measureText });
				if (block.type === 'line-chart')
					throw new Error('Survey fixture does not include line charts.');
				const resolvedGeometry: ChartBarColumnGeometry | ChartNormalizedGeometry =
					block.type === 'bar-chart' || block.type === 'column-chart'
						? resolveChartBarColumnGeometry({ block, layout, orientation, measureText })
						: resolveChartNormalizedGeometry({ block, layout, orientation, measureText });
				assert.deepEqual(layout.overflow, [], `${orientation}:${block.id}:layout`);
				assert.deepEqual(resolvedGeometry.overflow, [], `${orientation}:${block.id}:geometry`);
				assert.equal(resolvedGeometry.annotations.length, block.callouts?.length ?? 0);
			}
		}
	});

	it('round-trips through the same strict wire model used by agents and the GUI', () => {
		assert.deepEqual(validatePresetSemantics(fixture), []);
		const wire = presetToWireFormat(fixture);
		assert.deepEqual(parsePreset(wire), fixture);
	});
});
