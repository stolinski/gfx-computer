import { d } from 'typegpu';

import type { EffectRenderer } from '$lib/platform/pipelines/types';
import { normalizedPassRegion } from '$lib/platform/pipelines/pass-execution';
import { hexToRgbaFloat } from '$lib/utils/color';
import {
	DEFAULT_FROSTED_GLASS_REGION,
	packAspectPreservingOpticalRegion
} from '$lib/utils/optical-geometry';

import Editor from './Editor.svelte';
import {
	frostedGlassEffectDefinition,
	type FrostedGlassParams as FrostedGlassParamsDefinition
} from './definition';

export type FrostedGlassParams = FrostedGlassParamsDefinition;

const FrostedGlassUniforms = d.struct({
	region: d.vec4f,
	tint: d.vec4f,
	melt: d.vec4f,
	// x: how far the melt has opened (0..1); z: 1 when the composition declares a melt.
	meltState: d.vec4f,
	resolution: d.vec2f,
	progress: d.f32,
	timestamp: d.f32,
	coverage: d.f32,
	contrast: d.f32,
	roughness: d.f32,
	haze: d.f32,
	refraction: d.f32,
	detailScale: d.f32,
	tintStrength: d.f32,
	highlight: d.f32,
	seed: d.f32,
	growth: d.f32
});

// Deterministic pane frost built from three independently-scaled value fields,
// gaussian transmission blur, derivative relief, and sparse surface highlights. The
// frost front and the optional melt read the `growth` and `melt.progress` params,
// which the animation manifest drives (ADR-0063 §8); output alpha always remains
// the local input alpha.
const fragmentBody = /* wgsl */ `
	let region = layout.$.uniforms.region;
	let resolution = layout.$.uniforms.resolution;
	let localUv = (in.uv - region.xy) / max(region.zw, vec2f(0.0001));
	let regionPixels = max(region.zw * resolution, vec2f(1.0));
	let edgePixels = min(
		min(localUv.x, 1.0 - localUv.x) * regionPixels.x,
		min(localUv.y, 1.0 - localUv.y) * regionPixels.y
	);
	let paneAa = max(fwidth(edgePixels), 0.75);
	let paneMask = smoothstep(-paneAa, paneAa, edgePixels);

	let detailScale = layout.$.uniforms.detailScale;
	let seed = layout.$.uniforms.seed;
	let noiseUvA = localUv * (9.0 * detailScale) + vec2f(seed * 0.013, seed * 0.021);
	let noiseUvB = localUv * (23.0 * detailScale) + vec2f(seed * 0.037, seed * 0.011);
	let noiseUvC = localUv * (57.0 * detailScale) + vec2f(seed * 0.007, seed * 0.043);

	let cellA = floor(noiseUvA);
	let fracA = fract(noiseUvA);
	let smoothA = fracA * fracA * (3.0 - 2.0 * fracA);
	let hashA00 = fract(sin(dot(cellA, vec2f(127.1, 311.7))) * 43758.5453);
	let hashA10 = fract(sin(dot(cellA + vec2f(1.0, 0.0), vec2f(127.1, 311.7))) * 43758.5453);
	let hashA01 = fract(sin(dot(cellA + vec2f(0.0, 1.0), vec2f(127.1, 311.7))) * 43758.5453);
	let hashA11 = fract(sin(dot(cellA + vec2f(1.0), vec2f(127.1, 311.7))) * 43758.5453);
	let noiseA = mix(mix(hashA00, hashA10, smoothA.x), mix(hashA01, hashA11, smoothA.x), smoothA.y);

	let cellB = floor(noiseUvB);
	let fracB = fract(noiseUvB);
	let smoothB = fracB * fracB * (3.0 - 2.0 * fracB);
	let hashB00 = fract(sin(dot(cellB, vec2f(269.5, 183.3))) * 43758.5453);
	let hashB10 = fract(sin(dot(cellB + vec2f(1.0, 0.0), vec2f(269.5, 183.3))) * 43758.5453);
	let hashB01 = fract(sin(dot(cellB + vec2f(0.0, 1.0), vec2f(269.5, 183.3))) * 43758.5453);
	let hashB11 = fract(sin(dot(cellB + vec2f(1.0), vec2f(269.5, 183.3))) * 43758.5453);
	let noiseB = mix(mix(hashB00, hashB10, smoothB.x), mix(hashB01, hashB11, smoothB.x), smoothB.y);

	let cellC = floor(noiseUvC);
	let fracC = fract(noiseUvC);
	let smoothC = fracC * fracC * (3.0 - 2.0 * fracC);
	let hashC00 = fract(sin(dot(cellC, vec2f(419.2, 371.9))) * 43758.5453);
	let hashC10 = fract(sin(dot(cellC + vec2f(1.0, 0.0), vec2f(419.2, 371.9))) * 43758.5453);
	let hashC01 = fract(sin(dot(cellC + vec2f(0.0, 1.0), vec2f(419.2, 371.9))) * 43758.5453);
	let hashC11 = fract(sin(dot(cellC + vec2f(1.0), vec2f(419.2, 371.9))) * 43758.5453);
	let noiseC = mix(mix(hashC00, hashC10, smoothC.x), mix(hashC01, hashC11, smoothC.x), smoothC.y);

	let frostField = noiseA * 0.56 + noiseB * 0.3 + noiseC * 0.14;
	let threshold = 1.0 - layout.$.uniforms.coverage;
	let contrastWidth = mix(0.28, 0.025, layout.$.uniforms.contrast);
	var frostMask = smoothstep(threshold - contrastWidth, threshold + contrastWidth, frostField);

	let growth = layout.$.uniforms.growth;
	let growthFront = 1.0 - smoothstep(growth - 0.08, growth + 0.015, localUv.x);
	frostMask = frostMask * growthFront;

	let melt = layout.$.uniforms.melt;
	let meltState = layout.$.uniforms.meltState;
	let meltProgress = meltState.x * meltState.z;
	let meltDistance = length((localUv - melt.xy) * vec2f(regionPixels.x / regionPixels.y, 1.0));
	let meltHole = 1.0 - smoothstep(melt.z - melt.w, melt.z + melt.w, meltDistance);
	frostMask = frostMask * (1.0 - meltHole * meltProgress) * paneMask;

	let relief = normalize(vec2f(dpdx(frostField), dpdy(frostField)) + vec2f(0.00001));
	if (paneMask <= 0.0) {
		return inputSample;
	}

	let refractedUv = in.uv + relief / resolution
		* layout.$.uniforms.refraction * frostMask * 22.0;
	let blurPixels = 1.0 + layout.$.uniforms.roughness * 13.0 + layout.$.uniforms.haze * 8.0;
	let blurStep = vec2f(blurPixels / 6.0) / resolution;
	let gaussianWeights = array<f32, 13>(
		1.0, 12.0, 66.0, 220.0, 495.0, 792.0, 924.0,
		792.0, 495.0, 220.0, 66.0, 12.0, 1.0
	);
	var transmission = vec4f(0.0);
	for (var blurY = 0; blurY < 13; blurY = blurY + 1) {
		for (var blurX = 0; blurX < 13; blurX = blurX + 1) {
			let sampleOffset = vec2f(f32(blurX - 6), f32(blurY - 6)) * blurStep;
			let sampleWeight = gaussianWeights[blurX] * gaussianWeights[blurY];
			transmission = transmission
				+ textureSampleLevel(layout.$.inputTexture, layout.$.samp, refractedUv + sampleOffset, 0.0)
					* sampleWeight;
		}
	}
	transmission = transmission / 16777216.0;

	let localAlpha = inputSample.a;
	var straightRgb = select(vec3f(0.0), transmission.rgb / max(transmission.a, 0.0001), transmission.a > 0.0001);
	let tint = layout.$.uniforms.tint;
	let thickness = clamp(frostMask * (0.58 + 0.42 * noiseA), 0.0, 1.0);
	let tintMix = layout.$.uniforms.tintStrength * mix(0.35, 1.0, thickness) * tint.a;
	straightRgb = mix(straightRgb, tint.rgb, tintMix);
	let sparseHighlight = pow(noiseC, 14.0) * layout.$.uniforms.highlight * frostMask;
	let rimHighlight = exp(-pow(max(edgePixels, 0.0) / max(2.0 + 8.0 * layout.$.uniforms.roughness, 0.001), 2.0))
		* layout.$.uniforms.highlight * paneMask;
	straightRgb = clamp(straightRgb + vec3f(sparseHighlight + rimHighlight), vec3f(0.0), vec3f(1.0));

	let frosted = vec4f(straightRgb * localAlpha, localAlpha);
	return mix(inputSample, frosted, frostMask);
`;

export const frostedGlassEffectRenderer: EffectRenderer<FrostedGlassParams> = {
	...frostedGlassEffectDefinition,
	pass: {
		paramsStruct: FrostedGlassUniforms,
		fragmentBody,
		execution: (params, ctx) => {
			const region = packAspectPreservingOpticalRegion(
				params.region,
				DEFAULT_FROSTED_GLASS_REGION,
				{ width: ctx.canvasWidth, height: ctx.canvasHeight }
			);
			return region[0] === 0 && region[1] === 0 && region[2] === 1 && region[3] === 1
				? {}
				: { region: normalizedPassRegion(region, ctx.canvasWidth, ctx.canvasHeight, 48) };
		},
		pack: (params, ctx) => {
			const melt = params.melt;
			return {
				region: d.vec4f(
					...packAspectPreservingOpticalRegion(params.region, DEFAULT_FROSTED_GLASS_REGION, {
						width: ctx.canvasWidth,
						height: ctx.canvasHeight
					})
				),
				tint: d.vec4f(...hexToRgbaFloat(params.tint ?? '#e8f1f5')),
				melt: d.vec4f(
					melt?.center.x ?? 0.5,
					melt?.center.y ?? 0.5,
					melt?.radius ?? 0.28,
					melt?.softness ?? 0.08
				),
				meltState: d.vec4f(melt?.progress ?? 0, 0, melt ? 1 : 0, 0),
				resolution: d.vec2f(ctx.canvasWidth, ctx.canvasHeight),
				progress: ctx.progress,
				timestamp: ctx.timestamp,
				coverage: params.coverage ?? 0.72,
				contrast: params.contrast ?? 0.42,
				roughness: params.roughness ?? 0.62,
				haze: params.haze ?? 0.68,
				refraction: params.refraction ?? 0.26,
				detailScale: params.detailScale ?? 1.15,
				tintStrength: params.tintStrength ?? 0.18,
				highlight: params.highlight ?? 0.22,
				seed: params.seed ?? 4107,
				growth: params.growth ?? 1
			};
		}
	},
	Editor
};
