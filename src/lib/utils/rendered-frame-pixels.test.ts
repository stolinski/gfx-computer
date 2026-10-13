import { describe, expect, it } from 'vite-plus/test';

import {
	classifyRenderedFrameEdge,
	measureRenderedFrameBorderAlpha,
	measureRenderedFrameDrift,
	measureRenderedFramePixels,
	type RenderedFramePixels
} from './rendered-frame-pixels.ts';

function frameOf(
	width: number,
	height: number,
	paint: (x: number, y: number) => readonly [number, number, number, number]
): RenderedFramePixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const [red, green, blue, alpha] = paint(x, y);
			const offset = (y * width + x) * 4;
			data[offset] = red;
			data[offset + 1] = green;
			data[offset + 2] = blue;
			data[offset + 3] = alpha;
		}
	}
	return { width, height, data };
}

describe('measureRenderedFramePixels', () => {
	it('calls a fully uniform frame blank whatever its uniform value is', () => {
		const clear = measureRenderedFramePixels(frameOf(4, 4, () => [0, 0, 0, 0]));
		const flatFill = measureRenderedFramePixels(frameOf(4, 4, () => [18, 18, 20, 255]));

		expect(clear.isBlank).toBe(true);
		expect(clear.nonUniformPixelCount).toBe(0);
		expect(clear.alphaCoverage).toBe(0);
		expect(flatFill.isBlank).toBe(true);
		expect(flatFill.alphaCoverage).toBe(1);
		expect(flatFill.opaqueCoverage).toBe(1);
	});

	it('reports coverage as the fraction of pixels carrying any alpha', () => {
		const measurement = measureRenderedFramePixels(
			frameOf(4, 4, (x, y) => (y === 0 ? [255, 255, 255, 128] : [0, 0, 0, 0]))
		);

		expect(measurement.pixelCount).toBe(16);
		expect(measurement.alphaCoverage).toBeCloseTo(0.25, 10);
		expect(measurement.opaqueCoverage).toBe(0);
		// Uniformity is measured against the first pixel, which is one of the four
		// painted ones, so the twelve clear pixels are the ones that differ.
		expect(measurement.nonUniformPixelCount).toBe(12);
		expect(measurement.isBlank).toBe(false);
	});

	it('rejects a byte count that disagrees with the frame size', () => {
		expect(() =>
			measureRenderedFramePixels({ width: 2, height: 2, data: new Uint8ClampedArray(8) })
		).toThrow(/needs 16 RGBA bytes/);
	});
});

describe('classifyRenderedFrameEdge', () => {
	it('classifies a clear border as the transparent overlay lane', () => {
		expect(
			classifyRenderedFrameEdge(
				frameOf(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
			)
		).toBe('transparent');
	});

	it('classifies a fully opaque border as a full-frame piece', () => {
		expect(classifyRenderedFrameEdge(frameOf(5, 5, () => [10, 10, 10, 255]))).toBe('opaque');
	});

	it('classifies a border that is neither wholly clear nor wholly opaque as mixed', () => {
		expect(
			classifyRenderedFrameEdge(
				frameOf(5, 5, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [0, 0, 0, 0]))
			)
		).toBe('mixed');
	});
});

describe('measureRenderedFrameBorderAlpha', () => {
	it('reads the highest alpha on the border and how many border pixels carry any', () => {
		// One corner at 3/255 (an encoder's residue), the centre fully opaque.
		const border = measureRenderedFrameBorderAlpha(
			frameOf(5, 5, (x, y) =>
				x === 0 && y === 0 ? [0, 0, 0, 3] : x === 2 && y === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]
			)
		);

		expect(border.pixelCount).toBe(16);
		expect(border.coveredPixelCount).toBe(1);
		expect(border.maxAlpha).toBe(3);
	});

	it('reports a clear border as carrying nothing', () => {
		const border = measureRenderedFrameBorderAlpha(frameOf(3, 3, () => [0, 0, 0, 0]));

		expect(border).toEqual({ maxAlpha: 0, coveredPixelCount: 0, pixelCount: 8 });
	});
});

describe('measureRenderedFrameDrift', () => {
	it('compares colour only under the source’s opaque pixels and alpha everywhere', () => {
		const source = frameOf(2, 2, (x) => (x === 0 ? [100, 100, 100, 255] : [0, 0, 0, 0]));
		const decoded = frameOf(2, 2, (x) => (x === 0 ? [103, 100, 97, 255] : [50, 50, 50, 2]));

		const drift = measureRenderedFrameDrift(decoded, source);

		// Opaque pixels: (|3| + 0 + |3|) × 2 pixels over 2 pixels × 3 channels = 12 / 6.
		expect(drift.rgbMeanAbsoluteError).toBeCloseTo(2, 10);
		// Alpha: two pixels at 0 vs 2, two exact = 4 / 4.
		expect(drift.alphaMeanAbsoluteError).toBeCloseTo(1, 10);
	});

	it('reports no colour drift when the source has no opaque pixel to compare', () => {
		const source = frameOf(2, 2, () => [0, 0, 0, 0]);
		const decoded = frameOf(2, 2, () => [9, 9, 9, 0]);

		expect(measureRenderedFrameDrift(decoded, source)).toEqual({
			rgbMeanAbsoluteError: 0,
			alphaMeanAbsoluteError: 0
		});
	});

	it('refuses frames of different sizes rather than comparing misaligned pixels', () => {
		expect(() =>
			measureRenderedFrameDrift(frameOf(2, 2, () => [0, 0, 0, 0]), frameOf(3, 2, () => [0, 0, 0, 0]))
		).toThrow(/2x2 and 3x2/);
	});
});
