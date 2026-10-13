import { describe, expect, it } from 'vite-plus/test';

import { analyzeDeterministicReadableCapture } from './deterministic-render-capture-controller';

function pixels(values: readonly [number, number, number, number][]): ImageData {
	return {
		width: values.length,
		height: 1,
		colorSpace: 'srgb',
		data: new Uint8ClampedArray(values.flat())
	} as ImageData;
}

describe('analyzeDeterministicReadableCapture', () => {
	it('accepts a canonical treatment displaced by one post-effect pixel', () => {
		const result = analyzeDeterministicReadableCapture({
			canonical: pixels([
				[255, 255, 255, 128],
				[255, 255, 255, 255],
				[0, 0, 0, 0]
			]),
			background: pixels([
				[0, 0, 0, 0],
				[255, 255, 255, 255],
				[0, 0, 0, 0]
			]),
			mask: pixels([
				[255, 255, 255, 100],
				[255, 255, 255, 200],
				[255, 255, 255, 20]
			]),
			region: { x: 0, y: 0, width: 3, height: 1 }
		});
		expect(result).toMatchObject({
			peakAlpha: 200,
			threshold: 180,
			expectedPixels: 1,
			visiblePixels: 1
		});
		expect(result.minimumContrastRatio).toBe(1);
	});

	it('retains occlusion when no canonical treatment is visible nearby', () => {
		const background = pixels([
			[0, 0, 0, 0],
			[0, 0, 0, 0],
			[0, 0, 0, 0]
		]);
		const result = analyzeDeterministicReadableCapture({
			canonical: background,
			background,
			mask: pixels([
				[0, 0, 0, 0],
				[255, 255, 255, 255],
				[0, 0, 0, 0]
			]),
			region: { x: 0, y: 0, width: 3, height: 1 }
		});
		expect(result).toMatchObject({ expectedPixels: 1, visiblePixels: 0 });
	});

	it('fails closed when target-only capture has no alpha signal', () => {
		const transparent = pixels([[0, 0, 0, 0]]);
		expect(
			analyzeDeterministicReadableCapture({
				canonical: transparent,
				background: transparent,
				mask: transparent,
				region: { x: 0, y: 0, width: 1, height: 1 }
			})
		).toMatchObject({ expectedPixels: 0, threshold: 0 });
	});
});
