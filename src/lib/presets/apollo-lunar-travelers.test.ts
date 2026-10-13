import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import presetJson from './apollo-lunar-travelers.json';
import { parsePresetIngress } from '../platform/preset-ingress';
import { listFixtures, listPresets } from '../platform/preset-catalog';
import { parsePreset } from '../platform/preset-parser';
import { presetToWireFormat } from '../platform/preset-pure';
import { validatePresetSemantics } from '../platform/preset-validation';
import { resolveChartDataTarget } from '../utils/chart-data-target';
import { formatChartValueLabel } from '../utils/chart-editorial-annotation';
import { allocateChartNormalizedUnits } from '../utils/chart-normalized-allocation';
import { resolveChartFrameLayout } from '../utils/chart-layout';
import { createChartRenderTextMeasurer } from '../utils/chart-text-measurement';

const preset = parsePresetIngress(presetJson);
const chart = preset.state.surface.chart;
if (!chart || chart.items.length !== 1)
	throw new Error('Apollo travelers Preset must declare one chart.');
const block = chart.items[0];
if (!block || block.type !== 'dot-field-chart')
	throw new Error('Apollo travelers Preset must use dot-field-chart.');

describe('Apollo lunar travelers dot-field Preset', () => {
	it('is one listed Pack-neutral production deliverable', () => {
		assert.equal(preset.kind, 'deliverable');
		assert.equal(preset.state.backgroundFill, 'pack');
		assert.equal(chart.mode, 'single');
		assert.equal(
			listPresets().some((entry) => entry.slug === 'apollo-lunar-travelers'),
			true
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'apollo-lunar-travelers'),
			false
		);
		assert.equal(JSON.stringify(preset).includes('#'), false);
	});

	it('fits the compact subject title at the enlarged native portrait typography floor', () => {
		const layout = resolveChartFrameLayout({
			block,
			orientation: 'vertical',
			measureText: createChartRenderTextMeasurer('vertical')
		});
		assert.equal(block.title, 'Half of Apollo lunar travelers');
		assert.deepEqual(layout.overflow, []);
	});

	it('preserves the exhaustive 12/12 traveler split as one dot per person', () => {
		const values = block.data.series[0]?.values.map((datum) => datum.value);
		assert.deepEqual(values, [12, 12]);
		assert.equal(
			values?.reduce((sum, value) => sum + value, 0),
			24
		);
		assert.deepEqual(block.normalization, { total: 24, unitCount: 24 });
		assert.deepEqual(
			allocateChartNormalizedUnits(block).categories.map((category) => category.allocatedUnits),
			[12, 12]
		);
		assert.deepEqual(block.labels, { categories: true, values: true, legend: true });
	});

	it('computes the moonwalker annotation from the resolved datum', () => {
		const callout = block.callouts?.[0];
		assert.ok(callout);
		const resolved = resolveChartDataTarget(block, callout.target);
		assert.equal(resolved.value, 12);
		assert.equal(resolved.seriesTotal, 24);
		assert.equal(formatChartValueLabel(resolved, callout.valueLabel), '1 in 2 · 50%');
	});

	it('keeps whole-frame phases, a shorter exit, and a settled reading hold', () => {
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
				0.28
		);
	});

	it('round-trips through the same strict model used by agents and the GUI', () => {
		assert.deepEqual(validatePresetSemantics(preset), []);
		assert.deepEqual(parsePreset(presetToWireFormat(preset)), preset);
	});
});
