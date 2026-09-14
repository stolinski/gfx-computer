import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { pixelationEffectRenderer } from './index';

const FRAME_CONTEXT = {
	progress: 0.5,
	timestamp: 2,
	canvasWidth: 3840,
	canvasHeight: 2160,
	stageContentScale: 1
};

interface PackedVector2 {
	e0: number;
	e1: number;
}

describe('pixelation Effect', () => {
	it('ships schema-valid defaults and rejects fractional cell sizes', () => {
		const defaults = pixelationEffectRenderer.defaults();
		const valid = pixelationEffectRenderer.schema.safeParse({
			type: 'pixelation',
			id: 'pixels',
			params: defaults.params
		});
		const fractional = pixelationEffectRenderer.schema.safeParse({
			type: 'pixelation',
			id: 'pixels',
			params: { pixelSize: 12.5 }
		});

		assert.equal(valid.success, true);
		assert.equal(fractional.success, false);
	});

	it('packs native composition dimensions and pixel size', () => {
		const packed = pixelationEffectRenderer.pass.pack({ pixelSize: 64 }, FRAME_CONTEXT);
		const resolution = packed.resolution as PackedVector2;

		assert.deepEqual([resolution.e0, resolution.e1], [3840, 2160]);
		assert.equal(packed.pixelSize, 64);
	});

	it('loads one exact source texel per stable square cell without color processing', () => {
		const wgsl = pixelationEffectRenderer.pass.fragmentBody;

		assert.match(wgsl, /let cellOrigin = floor\(pixelCoord \/ pixelSize\) \* pixelSize/);
		assert.match(wgsl, /return textureLoad\(layout\.\$\.inputTexture, sampleCoord, 0\)/);
		assert.doesNotMatch(wgsl, /textureSample|lum|quant|dither/);
	});
});
