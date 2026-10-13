import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { AnnotationDrawContext } from '$lib/platform/pipelines/types';

import { magnifyAnnotationRenderer } from './index';

function focalSlot(options: {
	durationMs?: number;
	width: number;
	intensity?: number;
	progress?: number;
}): ReturnType<NonNullable<typeof magnifyAnnotationRenderer.computeFocalSlot>> {
	const bounds = { x: 800, y: 900, width: options.width, height: 80 };
	const context: AnnotationDrawContext = {
		bounds: { x: 0, y: 0, width: 3840, height: 2160 },
		canvasHeight: 2160,
		canvasWidth: 3840,
		color: '#ffd54a',
		context: null as never,
		durationMs: options.durationMs ?? 660,
		intensity: options.intensity ?? 0.75,
		layout: { bounds, fragments: [bounds], style: 'magnify' },
		markIndex: 0,
		paperLayout: { x: 0, y: 0, width: 3840, height: 2160 },
		progress: options.progress ?? 0.5
	};

	return magnifyAnnotationRenderer.computeFocalSlot!(context);
}

describe('magnifyAnnotationRenderer', () => {
	it('uses a circular optical lens for short focal phrases', () => {
		const slot = focalSlot({ width: 140 });

		assert.equal(slot.opticalShape, 'circle');
		assert.ok(Math.abs(slot.rect.width - slot.rect.height * (2160 / 3840)) < 1e-12);
		assert.ok(slot.dim > 0);
		assert.equal(slot.opticalColor, '#ffd54a');
	});

	it('bounds longer focal phrases inside a rounded rectangle', () => {
		const slot = focalSlot({ width: 900 });
		const widthPixels = slot.rect.width * 3840;

		assert.equal(slot.opticalShape, 'rounded-rect');
		assert.equal(widthPixels, 80 * 18);
		assert.ok(slot.rect.height * 2160 > 80);
	});

	it('derives deterministic optical strength and ripple from focal progress', () => {
		const first = focalSlot({ width: 240, intensity: 0.4, progress: 0.2 });
		const second = focalSlot({ width: 240, intensity: 0.4, progress: 0.2 });

		assert.deepEqual(first, second);
		assert.ok((first.opticalRipple ?? 0) > 0);
		assert.ok((first.opticalIntensity ?? 0) === 0.4);
	});

	it('derives smooth G6-compliant bookends from absolute Mark duration', () => {
		const early = focalSlot({ width: 240, durationMs: 660, progress: 0.15 });
		const settled = focalSlot({ width: 240, durationMs: 660, progress: 0.4 });
		const exiting = focalSlot({ width: 240, durationMs: 660, progress: 0.85 });

		assert.ok(early.magnify > 0 && early.magnify < settled.magnify);
		assert.ok(settled.magnify > exiting.magnify);
		assert.ok(exiting.magnify > 0);
	});
});
