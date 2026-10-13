import { describe, expect, it } from 'vite-plus/test';

import chartFixtureJson from '$lib/presets/chart-domain-survey-fixture.json';
import { parsePresetIngress } from '$lib/platform/preset-ingress';
import { resolveChartReadableText } from './chart-readable-text';

const fixture = parsePresetIngress(chartFixtureJson);

describe('resolveChartReadableText', () => {
	it('uses chart layout and formatting authority for every active family', () => {
		const chart = fixture.state.surface.chart;
		expect(chart).toBeDefined();
		for (const block of chart?.items ?? []) {
			const settledProgress =
				(block.motion.entry.start + block.motion.entry.duration + block.motion.exit.start) / 2;
			const entries = resolveChartReadableText(block, 'horizontal', settledProgress);
			expect(entries.length, block.type).toBeGreaterThan(0);
			expect(entries[0].id).toBe(`block:${block.id}:title`);
			expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
		}
	});

	it('returns no readable identities while chart alpha is zero', () => {
		const block = fixture.state.surface.chart?.items[0];
		expect(block).toBeDefined();
		if (block) expect(resolveChartReadableText(block, 'horizontal', 0)).toEqual([]);
	});
});
