import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import presetJson from './bar-chart-apollo-sample-return.json';
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

if (!chart || chart.items.length !== 1) {
	throw new Error('Apollo sample return Preset must declare one chart Block.');
}
const block = chart.items[0];
if (!block || block.type !== 'bar-chart') {
	throw new Error('Apollo sample return Preset must use the bar-chart Pipeline.');
}

describe('Apollo sample return bar-chart Preset', () => {
	it('is a listed Pack-neutral production deliverable rather than a fixture', () => {
		assert.equal(preset.kind, 'deliverable');
		assert.equal(preset.state.backgroundFill, 'pack');
		assert.equal(chart.mode, 'single');
		assert.equal(
			listPresets().some((entry) => entry.slug === 'bar-chart-apollo-sample-return'),
			true
		);
		assert.equal(
			listFixtures().some((entry) => entry.slug === 'bar-chart-apollo-sample-return'),
			false
		);
		assert.equal(JSON.stringify(preset).includes('#'), false);
	});

	it('preserves NASA’s exact endpoint masses and the 5.1× editorial claim', () => {
		const values = block.data.series[0]?.values.map((datum) => datum.value);
		assert.deepEqual(values, [21.5, 110.5]);
		assert.equal(Math.round((110.5 / 21.5) * 10) / 10, 5.1);
		assert.equal(block.labels.legend, true);
		assert.match(block.data.series[0]?.label ?? '', /\(kg\)$/);
		assert.equal(block.domain?.min, 0);
		assert.equal(block.domain?.max, 120);
		assert.match(block.sourceNote ?? '', /NASA NTRS 20090011852/);
		const highlight = block.highlights?.[0];
		assert.ok(highlight);
		const target = resolveChartDataTarget(block, highlight.target);
		assert.equal(target.value, 110.5);
		assert.equal(block.callouts, undefined);
	});

	it('uses whole-frame deterministic phases with a shorter exit and long reading hold', () => {
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

	it('fits its compact title at the enlarged native portrait typography floor', () => {
		const layout = resolveChartFrameLayout({
			block,
			orientation: 'vertical',
			measureText: createChartRenderTextMeasurer('vertical')
		});
		assert.equal(block.title, 'Apollo 17 sample: 5.1× Apollo 11');
		assert.deepEqual(layout.overflow, []);
	});

	it('round-trips through the same strict model used by agents and the GUI', () => {
		assert.deepEqual(validatePresetSemantics(preset), []);
		assert.deepEqual(parsePreset(presetToWireFormat(preset)), preset);
	});
});
