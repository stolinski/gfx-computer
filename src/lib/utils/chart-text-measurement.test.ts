import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import {
	chartRenderTextMeasurer,
	measureChartTextForRender,
	resolveChartTextRoleStyle
} from './chart-text-measurement';

describe('measureChartTextForRender', () => {
	it('returns deterministic native-pixel measurements for every chart text role', () => {
		const roles = ['title', 'axis', 'category', 'value', 'legend', 'source', 'callout'] as const;
		for (const role of roles) {
			const first = measureChartTextForRender({ text: '2 in 3 · 67.4%', role });
			const second = chartRenderTextMeasurer({ text: '2 in 3 · 67.4%', role });
			assert.deepEqual(first, second);
			assert.ok(first.width > 0);
			assert.ok(first.height > 0);
			assert.ok(resolveChartTextRoleStyle(role).fontSize > 0);
		}
	});

	it('keeps every vertical chart role above the native portrait typography floor', () => {
		assert.ok(resolveChartTextRoleStyle('title', 'vertical').fontSize >= 112);
		assert.equal(resolveChartTextRoleStyle('callout').fontSize, 72);
		assert.equal(resolveChartTextRoleStyle('callout', 'vertical').fontSize, 72);
		for (const role of ['axis', 'category', 'value', 'legend', 'source', 'callout'] as const) {
			assert.ok(resolveChartTextRoleStyle(role, 'vertical').fontSize >= 48, role);
		}
	});

	it('keeps chart keys and supporting labels readable at editor scale', () => {
		assert.ok(resolveChartTextRoleStyle('legend').fontSize >= 64);
		for (const role of ['axis', 'category', 'value', 'source'] as const) {
			assert.ok(resolveChartTextRoleStyle(role).fontSize >= 48, role);
		}
	});

	it('measures narrow and wide glyphs without consulting browser state', () => {
		const narrow = measureChartTextForRender({ text: '1111', role: 'value' });
		const wide = measureChartTextForRender({ text: 'MMMM', role: 'value' });
		assert.ok(wide.width > narrow.width * 2);
		assert.equal(measureChartTextForRender({ text: '', role: 'source' }).width, 0);
	});
});
