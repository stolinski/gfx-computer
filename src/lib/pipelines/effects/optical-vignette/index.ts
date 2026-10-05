import { d } from 'typegpu';

import { linearToSrgbWgsl, srgbToLinearWgsl } from '$lib/platform/pipelines/depth-stage-material';
import type { EffectRenderer } from '$lib/platform/pipelines/types';

import Editor from './Editor.svelte';
import {
	opticalVignetteEffectDefinition,
	type OpticalVignetteParams as OpticalVignetteParamsDefinition
} from './definition';
import {
	resolveOpticalVignetteFalloff,
	type OpticalVignetteShape
} from './optical-vignette-falloff';

export type OpticalVignetteParams = OpticalVignetteParamsDefinition;

const OpticalVignetteUniforms = d.struct({
	resolution: d.vec2f,
	centerPx: d.vec2f,
	axisScale: d.vec2f,
	fieldGain: d.f32,
	onsetSquared: d.f32,
	feather: d.f32,
	rampOffset: d.f32,
	rampScale: d.f32
});

// A live entry can reach the chain before its params were parsed, so every
// field falls back to the Pipeline default rather than to NaN uniforms.
function readOpticalVignetteShape(params: OpticalVignetteParams): OpticalVignetteShape {
	const defaults = opticalVignetteEffectDefinition.defaults().params;
	return {
		exposureLoss: params.exposureLoss ?? defaults.exposureLoss,
		onset: params.onset ?? defaults.onset,
		feather: params.feather ?? defaults.feather,
		roundness: params.roundness ?? defaults.roundness,
		center: {
			x: params.center?.x ?? defaults.center.x,
			y: params.center?.y ?? defaults.center.y
		}
	};
}

// The cos⁴ exposure field from `optical-vignette-falloff.ts`, evaluated at each
// native pixel centre and applied in linear light as
// `applyOpticalVignetteExposure` does: un-premultiply, decode sRGB, scale,
// encode, re-premultiply. The source texel is loaded exactly rather than
// filtered, and a texel at full exposure (everywhere at zero loss, and at the
// optical centre) or with no coverage is returned bit for bit. Alpha passes
// through untouched, so transparent pixels stay transparent and no background
// is painted. There is no hue shift, grain, blur, or time input — the field is
// a pure function of the params and the frame size.
const fragmentBody = /* wgsl */ `
	let resolution = max(layout.$.uniforms.resolution, vec2f(1.0));
	let pixelCoord = clamp(floor(in.uv * resolution), vec2f(0.0), resolution - vec2f(1.0));
	let source = textureLoad(layout.$.inputTexture, vec2i(pixelCoord), 0);

	let offset = (pixelCoord + vec2f(0.5) - layout.$.uniforms.centerPx) * layout.$.uniforms.axisScale;
	let feather = layout.$.uniforms.feather;
	let shifted = dot(offset, offset) - layout.$.uniforms.onsetSquared;
	let softplus = max(shifted, 0.0) + feather * log(1.0 + exp(-abs(shifted) / feather));
	let ramp = max(softplus - layout.$.uniforms.rampOffset, 0.0) * layout.$.uniforms.rampScale;
	let cosineSquared = 1.0 / (1.0 + layout.$.uniforms.fieldGain * ramp);
	let exposure = cosineSquared * cosineSquared;

	if (exposure >= 1.0 || source.a <= 0.0) {
		return source;
	}
	let encoded = max(source.rgb / source.a, vec3f(0.0));
	let linear = ${srgbToLinearWgsl('encoded')} * exposure;
	return vec4f(${linearToSrgbWgsl('linear')} * source.a, source.a);
`;

export const opticalVignetteEffectRenderer: EffectRenderer<OpticalVignetteParams> = {
	...opticalVignetteEffectDefinition,
	pass: {
		paramsStruct: OpticalVignetteUniforms,
		fragmentBody,
		pack: (params, ctx) => {
			const falloff = resolveOpticalVignetteFalloff(readOpticalVignetteShape(params), {
				width: ctx.canvasWidth,
				height: ctx.canvasHeight
			});
			return {
				resolution: d.vec2f(ctx.canvasWidth, ctx.canvasHeight),
				centerPx: d.vec2f(falloff.centerPx.x, falloff.centerPx.y),
				axisScale: d.vec2f(falloff.axisScale.x, falloff.axisScale.y),
				fieldGain: falloff.fieldGain,
				onsetSquared: falloff.onsetSquared,
				feather: falloff.feather,
				rampOffset: falloff.rampOffset,
				rampScale: falloff.rampScale
			};
		}
	},
	Editor
};
