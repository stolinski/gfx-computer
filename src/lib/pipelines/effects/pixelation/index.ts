import { d } from 'typegpu';

import type { EffectRenderer } from '$lib/platform/pipelines/types';

import Editor from './Editor.svelte';
import {
	pixelationEffectDefinition,
	type PixelationParams as PixelationParamsDefinition
} from './definition';

export type PixelationParams = PixelationParamsDefinition;
const PixelationUniforms = d.struct({
	resolution: d.vec2f,
	pixelSize: d.f32
});

// Replaces every native pixel in a square cell with the exact premultiplied
// source texel at that cell's centre. The top-left-anchored grid is stable
// across frames, and partial edge cells sample their own centre rather than a
// clamped texel from outside their bounds. There is no filtering, averaging,
// posterization, palette remapping, or dither: only clean sample-and-hold
// pixelation. A pixelSize of 1 is an exact identity pass.
//
// Returning the sampled premultiplied texel unchanged preserves transparent
// regions and never paints a background the composition did not declare.
const fragmentBody = /* wgsl */ `
	let resolution = max(layout.$.uniforms.resolution, vec2f(1.0));
	let pixelSize = max(floor(layout.$.uniforms.pixelSize + 0.5), 1.0);
	let pixelCoord = clamp(
		floor(in.uv * resolution),
		vec2f(0.0),
		resolution - vec2f(1.0)
	);
	let cellOrigin = floor(pixelCoord / pixelSize) * pixelSize;
	let cellSize = min(vec2f(pixelSize), resolution - cellOrigin);
	let sampleCoord = vec2i(cellOrigin + floor(cellSize * 0.5));

	return textureLoad(layout.$.inputTexture, sampleCoord, 0);
`;

export const pixelationEffectRenderer: EffectRenderer<PixelationParams> = {
	...pixelationEffectDefinition,
	pass: {
		paramsStruct: PixelationUniforms,
		fragmentBody,
		pack: (params, ctx) => ({
			resolution: d.vec2f(ctx.canvasWidth, ctx.canvasHeight),
			pixelSize: params.pixelSize ?? 48
		})
	},
	Editor
};
