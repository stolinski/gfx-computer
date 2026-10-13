import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { refractiveLensEffectRenderer } from './index';

const FRAME_CONTEXT = {
	progress: 0.5,
	timestamp: 2,
	canvasWidth: 3840,
	canvasHeight: 2160,
	stageContentScale: 1
};

interface PackedVector4 {
	e0: number;
	e1: number;
	e2: number;
	e3: number;
}

describe('refractive lens Effect', () => {
	it('ships schema-valid defaults', () => {
		const defaults = refractiveLensEffectRenderer.defaults();
		const result = refractiveLensEffectRenderer.schema.safeParse({
			type: 'refractive-lens',
			id: 'lens',
			params: defaults.params
		});

		assert.equal(result.success, true);
	});

	it('rejects lens regions that leave the normalized frame', () => {
		const defaults = refractiveLensEffectRenderer.defaults();
		const result = refractiveLensEffectRenderer.schema.safeParse({
			type: 'refractive-lens',
			id: 'lens',
			params: {
				...defaults.params,
				region: { x: 0.75, y: 0.25, width: 0.5, height: 0.5 }
			}
		});

		assert.equal(result.success, false);
	});

	it('packs normalized geometry and deterministic frame progress', () => {
		const defaults = refractiveLensEffectRenderer.defaults();
		const packed = refractiveLensEffectRenderer.pass.pack(defaults.params, FRAME_CONTEXT);
		const region = packed.region as PackedVector4;

		assert.deepEqual([region.e0, region.e1, region.e2, region.e3], [0.25, 0.25, 0.5, 0.5]);
		assert.equal(packed.progress, 0.5);
		assert.equal(packed.timestamp, 2);
		assert.equal(packed.shape, 1);
		assert.equal(packed.magnification, 1.24);
	});

	it('keeps optical reconstruction sharp and confines lighting to the bevel', () => {
		const wgsl = refractiveLensEffectRenderer.pass.fragmentBody;

		assert.match(wgsl, /textureLoad\(layout\.\$\.inputTexture/);
		assert.match(wgsl, /let edge = smoothstep\(-bevelPixels, -aa, lensDistance\)/);
		assert.doesNotMatch(wgsl, /let edge = 1\.0 - smoothstep/);
	});

	it('limits expensive lens fragments to padded native pixel bounds', () => {
		const defaults = refractiveLensEffectRenderer.defaults();
		assert.deepEqual(refractiveLensEffectRenderer.pass.execution?.(defaults.params, FRAME_CONTEXT), {
			region: { x: 956, y: 536, width: 1928, height: 1088 }
		});
	});
});
