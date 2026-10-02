import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	canonicalOpticalRegionFromFrameRegion,
	DEFAULT_FROSTED_GLASS_REGION,
	DEFAULT_REFRACTIVE_LENS_REGION,
	NormalizedOpticalRegionSchema,
	getOpticalShapeCode,
	packAspectPreservingOpticalRegion
} from './optical-geometry';

describe('optical geometry', () => {
	it('rejects normalized regions that extend beyond the frame', () => {
		assert.equal(
			NormalizedOpticalRegionSchema.safeParse({ x: 0.8, y: 0, width: 0.4, height: 1 }).success,
			false
		);
	});

	it('keeps canonical regions unchanged on horizontal targets', () => {
		assert.deepEqual(
			packAspectPreservingOpticalRegion({ x: 0.1, width: 0.7 }, DEFAULT_REFRACTIVE_LENS_REGION, {
				width: 3840,
				height: 2160
			}),
			[0.1, 0.25, 0.7, 0.5]
		);
	});

	it('preserves local optical pixel aspect on vertical targets', () => {
		const horizontal = { x: 0.62, y: 0.14, width: 0.08, height: 0.24 };
		const vertical = packAspectPreservingOpticalRegion(horizontal, DEFAULT_REFRACTIVE_LENS_REGION, {
			width: 2160,
			height: 3840
		});
		const horizontalPixelAspect = (horizontal.width * 3840) / (horizontal.height * 2160);
		const verticalPixelAspect = (vertical[2] * 2160) / (vertical[3] * 3840);

		assert.ok(Math.abs(verticalPixelAspect - horizontalPixelAspect) < 1e-12);
		assert.ok(Math.abs(vertical[2] * 2160 - horizontal.width * 3840) < 1e-12);
		assert.ok(Math.abs(vertical[3] * 3840 - horizontal.height * 2160) < 1e-12);
		assert.ok(Math.abs(vertical[0] + vertical[2] / 2 - 0.66) < 1e-12);
		assert.ok(Math.abs(vertical[1] + vertical[3] / 2 - 0.26) < 1e-12);
	});

	it('leaves explicitly full-frame optical regions target-filling', () => {
		assert.deepEqual(
			packAspectPreservingOpticalRegion(undefined, DEFAULT_FROSTED_GLASS_REGION, {
				width: 2160,
				height: 3840
			}),
			[0, 0, 1, 1]
		);
	});

	it('uses stable shader codes for optical shapes', () => {
		assert.equal(getOpticalShapeCode('circle'), 0);
		assert.equal(getOpticalShapeCode('rounded-rect'), 1);
	});
});

describe('canonicalOpticalRegionFromFrameRegion', () => {
	it('round-trips a frame-native region through the renderer conversion', () => {
		const frame = { width: 2160, height: 3840 };
		const authored = { x: 0.2, y: 0.5, width: 0.6, height: 0.3 };
		const packed = packAspectPreservingOpticalRegion(
			canonicalOpticalRegionFromFrameRegion(authored, frame),
			DEFAULT_REFRACTIVE_LENS_REGION,
			frame
		);
		[authored.x, authored.y, authored.width, authored.height].forEach((value, index) =>
			assert.ok(Math.abs(packed[index] - value) < 1e-9)
		);
		const full = { x: 0, y: 0, width: 1, height: 1 };
		assert.equal(canonicalOpticalRegionFromFrameRegion(full, frame), full);
		assert.equal(
			canonicalOpticalRegionFromFrameRegion(authored, { width: 3840, height: 2160 }),
			authored
		);
	});
});
