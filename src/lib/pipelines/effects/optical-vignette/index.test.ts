import { describe, expect, it } from 'vite-plus/test';

import { opticalVignetteEffectRenderer } from './index';

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

function parseParams(params: unknown): boolean {
	return opticalVignetteEffectRenderer.schema.safeParse({
		type: 'optical-vignette',
		id: 'lens',
		params
	}).success;
}

describe('optical-vignette Effect', () => {
	it('ships schema-valid defaults and fills absent params with them', () => {
		const defaults = opticalVignetteEffectRenderer.defaults();
		const parsed = opticalVignetteEffectRenderer.schema.safeParse({
			type: 'optical-vignette',
			id: 'lens',
			params: {}
		});

		expect(parseParams(defaults.params)).toBe(true);
		expect(parsed.success && parsed.data.params).toEqual(defaults.params);
	});

	it.each([
		['negative exposure loss', { exposureLoss: -0.1 }],
		['more than three stops', { exposureLoss: 3.5 }],
		['an onset past the shoulder bound', { onset: 0.9 }],
		['a feather hard enough to ring', { feather: 0.05 }],
		['roundness above one', { roundness: 1.2 }],
		['a centre outside the frame', { center: { x: 1.2, y: 0.5 } }],
		[
			'an incomplete orientation centre',
			{ orientationOverrides: { vertical: { center: { x: 0.5 } } } }
		],
		['an unknown orientation param', { orientationOverrides: { vertical: { onset: 0.2 } } }]
	])('rejects %s', (_label, params) => {
		expect(parseParams(params)).toBe(false);
	});

	it('accepts a complete per-orientation optical centre', () => {
		expect(
			parseParams({ orientationOverrides: { vertical: { center: { x: 0.5, y: 0.4 } } } })
		).toBe(true);
	});

	it('packs native frame geometry and an exact zero field gain at zero loss', () => {
		const packed = opticalVignetteEffectRenderer.pass.pack(
			{ ...opticalVignetteEffectRenderer.defaults().params, exposureLoss: 0 },
			FRAME_CONTEXT
		);
		const resolution = packed.resolution as PackedVector2;
		const centerPx = packed.centerPx as PackedVector2;

		expect([resolution.e0, resolution.e1]).toEqual([3840, 2160]);
		expect([centerPx.e0, centerPx.e1]).toEqual([1920, 1080]);
		expect(packed.fieldGain).toBe(0);
	});

	it('packs the same lens for every frame time', () => {
		const params = opticalVignetteEffectRenderer.defaults().params;
		const early = opticalVignetteEffectRenderer.pass.pack(params, {
			...FRAME_CONTEXT,
			progress: 0,
			timestamp: 0
		});
		const late = opticalVignetteEffectRenderer.pass.pack(params, {
			...FRAME_CONTEXT,
			progress: 1,
			timestamp: 4
		});

		expect(late).toEqual(early);
	});

	it('loads exact texels, scales colour in linear light, and passes alpha through', () => {
		const wgsl = opticalVignetteEffectRenderer.pass.fragmentBody;

		expect(wgsl).toMatch(
			/let source = textureLoad\(layout\.\$\.inputTexture, vec2i\(pixelCoord\), 0\)/
		);
		expect(wgsl).toMatch(/if \(exposure >= 1\.0 \|\| source\.a <= 0\.0\) \{\s*return source;/);
		expect(wgsl).toMatch(/pow\(\(encoded \+ vec3f\(0\.055\)\) \/ 1\.055, vec3f\(2\.4\)\)/);
		expect(wgsl).toMatch(/\* source\.a, source\.a\);/);
		expect(wgsl).not.toMatch(/textureSample|timestamp|progress|hash|noise/);
	});
});
