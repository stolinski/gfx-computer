import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { createBicubicSampleWgsl } from './bicubic-sampling-wgsl';

describe('createBicubicSampleWgsl', () => {
	it('emits a namespaced 16-tap cubic reconstruction', () => {
		const wgsl = createBicubicSampleWgsl({
			prefix: 'lens',
			result: 'lensSample',
			sampler: 'layout.$.samp',
			texture: 'layout.$.inputTexture',
			uv: 'sourceUv'
		});

		assert.match(wgsl, /let lensSample = vec4f\(lensRgb/);
		assert.match(wgsl, /textureLoad\(layout\.\$\.inputTexture/);
		assert.match(wgsl, /textureSampleLevel\(layout\.\$\.inputTexture, layout\.\$\.samp/);
		assert.match(wgsl, /lensWeightsX\[lensX\] \* lensWeightsY\[lensY\]/);
		assert.match(wgsl, /\(sourceUv\) \* vec2f\(lensSize\)/);
	});

	it('groups compound UV expressions before converting them to texel space', () => {
		const wgsl = createBicubicSampleWgsl({
			prefix: 'shifted',
			result: 'shiftedSample',
			sampler: 'sourceSampler',
			texture: 'sourceTexture',
			uv: 'sourceUv + dispersionOffset'
		});

		assert.match(wgsl, /\(sourceUv \+ dispersionOffset\) \* vec2f\(shiftedSize\)/);
	});
});
