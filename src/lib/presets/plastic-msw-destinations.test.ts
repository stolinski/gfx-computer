import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import presetJson from './plastic-msw-destinations.json';
import { parsePresetIngress } from '../platform/preset-ingress';
import { listFixtures, listPresets } from '../platform/preset-catalog';
import { parsePreset } from '../platform/preset-parser';
import { presetToWireFormat } from '../platform/preset-pure';
import { validatePresetSemantics } from '../platform/preset-validation';
import { resolveChartDataTarget } from '../utils/chart-data-target';
import { resolveChartFrameLayout } from '../utils/chart-layout';
import { createChartRenderTextMeasurer } from '../utils/chart-text-measurement';
import { formatChartValueLabel } from '../utils/chart-editorial-annotation';
import { allocateChartNormalizedUnits } from '../utils/chart-normalized-allocation';

const preset = parsePresetIngress(presetJson);
const chart = preset.state.surface.chart;
if (!chart || chart.items.length !== 1)
	throw new Error('Plastic MSW Preset must declare one chart.');
const block = chart.items[0];
if (!block || block.type !== 'unit-grid-chart')
	throw new Error('Plastic MSW Preset must use unit-grid-chart.');

describe('U.S. plastic MSW unit-grid Preset', () => {
	it('is one listed Pack-neutral production deliverable', () => {
		assert.equal(preset.kind, 'deliverable');
		assert.equal(preset.state.backgroundFill, 'pack');
		assert.equal(chart.mode, 'single');
		assert.equal(
			listPresets().some((entry) => entry.slug === 'plastic-msw-destinations'),
			true
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'plastic-msw-destinations'),
			false
		);
		assert.equal(JSON.stringify(preset).includes('#'), false);
	});

	it('preserves exact EPA values and allocates all 100 units honestly', () => {
		const values = block.data.series[0]?.values.map((datum) => datum.value);
		assert.deepEqual(values, [3_090, 5_620, 26_970]);
		assert.equal(
			values?.reduce((sum, value) => sum + value, 0),
			35_680
		);
		assert.deepEqual(block.normalization, { total: 35_680, unitCount: 100 });
		assert.deepEqual(
			allocateChartNormalizedUnits(block).categories.map((category) => category.allocatedUnits),
			[9, 16, 75]
		);
		assert.deepEqual(block.labels, { categories: true, values: true, legend: true });
	});

	it('computes the recycled annotation from the resolved datum', () => {
		const callout = block.callouts?.[0];
		assert.ok(callout);
		const resolved = resolveChartDataTarget(block, callout.target);
		assert.equal(resolved.value, 3_090);
		assert.equal(resolved.seriesTotal, 35_680);
		assert.equal(formatChartValueLabel(resolved, callout.valueLabel), '1 in 12 · 8.7%');
	});

	it('keeps whole-frame phases, a shorter exit, and a long settled hold', () => {
		const frameCount = preset.state.transport.durationSeconds * preset.state.transport.fps;
		for (const phase of Object.values(block.motion)) {
			assert.ok(Math.abs(phase.start * frameCount - Math.round(phase.start * frameCount)) < 1e-9);
			assert.ok(
				Math.abs(phase.duration * frameCount - Math.round(phase.duration * frameCount)) < 1e-9
			);
		}
		const entryMilliseconds = block.motion.entry.duration * 10_000;
		const exitMilliseconds = block.motion.exit.duration * 10_000;
		assert.ok(exitMilliseconds <= entryMilliseconds * 0.8 + 1e-9);
		assert.ok(exitMilliseconds >= 180 && exitMilliseconds <= 280);
		assert.ok(
			block.motion.exit.start -
				(block.motion.annotation.start + block.motion.annotation.duration) >=
				0.32
		);
	});

	it('fits its compact title at the enlarged native portrait typography floor', () => {
		const layout = resolveChartFrameLayout({
			block,
			orientation: 'vertical',
			measureText: createChartRenderTextMeasurer('vertical')
		});
		assert.equal(block.title, 'U.S. plastic MSW, 2018');
		assert.deepEqual(layout.overflow, []);
	});

	it('round-trips through the same strict model used by agents and the GUI', () => {
		assert.deepEqual(validatePresetSemantics(preset), []);
		assert.deepEqual(parsePreset(presetToWireFormat(preset)), preset);
	});
});
