import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import presetJson from './column-us-population-1950-2020.json';
import { parsePresetIngress } from '../platform/preset-ingress';
import { listFixtures, listPresets } from '../platform/preset-catalog';
import { parsePreset } from '../platform/preset-parser';
import { presetToWireFormat } from '../platform/preset-pure';
import { validatePresetSemantics } from '../platform/preset-validation';
import { resolveChartDataTarget } from '../utils/chart-data-target';
import { resolveChartFrameLayout } from '../utils/chart-layout';
import { createChartRenderTextMeasurer } from '../utils/chart-text-measurement';

const preset = parsePresetIngress(presetJson);
const chart = preset.state.surface.chart;
if (!chart || chart.items.length !== 1) throw new Error('Census Preset must declare one chart.');
const block = chart.items[0];
if (!block || block.type !== 'column-chart')
	throw new Error('Census Preset must use column-chart.');

const exactCounts = [
	151_325_798, 179_323_175, 203_211_926, 226_545_805, 248_709_873, 281_421_906, 308_745_538,
	331_449_281
];

describe('U.S. population column-chart Preset', () => {
	it('is one listed Pack-neutral production deliverable', () => {
		assert.equal(preset.kind, 'deliverable');
		assert.equal(preset.state.backgroundFill, 'pack');
		assert.equal(chart.mode, 'single');
		assert.equal(
			listPresets().some((entry) => entry.slug === 'column-us-population-1950-2020'),
			true
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'column-us-population-1950-2020'),
			false
		);
		assert.equal(JSON.stringify(preset).includes('#'), false);
	});

	it('preserves exact Census counts and the more-than-doubled claim', () => {
		assert.deepEqual(
			block.data.categories.map((category) => category.label),
			['1950', '1960', '1970', '1980', '1990', '2000', '2010', '2020']
		);
		assert.deepEqual(
			block.data.series[0]?.values.map((datum) => datum.value),
			exactCounts
		);
		assert.ok(exactCounts[7] / exactCounts[0] > 2);
		assert.ok(Math.abs(exactCounts[7] / exactCounts[0] - 2.1903025484) < 1e-10);
		assert.equal(block.domain?.min, 0);
		assert.equal(block.domain?.max, 350_000_000);
		const callout = block.callouts?.[0];
		assert.ok(callout);
		assert.equal(resolveChartDataTarget(block, callout.target).value, 331_449_281);
		assert.equal(callout.valueLabel.kind, 'value');
	});

	it('keeps whole-frame phases, a shorter exit, and a settled endpoint hold', () => {
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
				0.22
		);
	});

	it('fits its compact title at the enlarged native portrait typography floor', () => {
		const layout = resolveChartFrameLayout({
			block,
			orientation: 'vertical',
			measureText: createChartRenderTextMeasurer('vertical')
		});
		assert.equal(block.title, 'U.S. population grew 2.2×');
		assert.deepEqual(layout.overflow, []);
	});

	it('round-trips through the same strict model used by agents and the GUI', () => {
		assert.deepEqual(validatePresetSemantics(preset), []);
		assert.deepEqual(parsePreset(presetToWireFormat(preset)), preset);
	});
});
