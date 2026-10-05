import { d } from 'typegpu';

import { STAGE_BODY_MAX_REGIONS } from './depth-stage-geometry';

// The Stage's material model (ADR-0059): a body is lit in LINEAR light with
// one physically based reflectance — Lambert diffuse under a GGX specular
// lobe with a height-correlated Smith visibility term and a Schlick Fresnel —
// by the Pack key as a small area light and by an analytic studio
// environment: the Pack field bouncing up from the floor under a dim neutral
// ceiling. The result is tone-compressed and sRGB-encoded at the end of the
// body pass, so a body's albedo displays as the colour its registry declares
// under unit light and composes with the display-space captures around it.
// The captured planes stay in display space; only computed bodies pay for
// the linear round trip, because only they have a reflectance to compute.

/** The key's radiance at unit Pack intensity, in linear light (π × 2.4: a
 *  matte body facing the house key renders at its albedo). */
const KEY_RADIANCE = 7.54;
/** The key as a softbox rather than a point: the angular radius that widens
 *  the specular lobe, with the lobe renormalised so its energy holds. */
const KEY_ANGULAR_RADIUS = 0.1;
/** The dim neutral ceiling of the room, linear. */
const CEILING_RADIANCE = 0.16;
/** How much of the Pack field bounces back up as the floor of the environment. */
const FLOOR_BOUNCE = 0.5;
/** Roughness below which GGX sparkles at 4K under 4× multisampling. */
const ROUGHNESS_FLOOR = 0.045;
/** Linear luminance above which body colour compresses toward white. */
const TONE_KNEE = 0.8;

/**
 * `materialColor[k]` = (linear rgb albedo, roughness) and `materialParams[k]`
 * = (metallic, 0, 0, 0) per region; `environment` = (linear Pack field rgb, 0),
 * the floor of the room the body reflects.
 */
export const STAGE_MATERIAL_UNIFORM_FIELDS = {
	materialColor: d.arrayOf(d.vec4f, STAGE_BODY_MAX_REGIONS),
	materialParams: d.arrayOf(d.vec4f, STAGE_BODY_MAX_REGIONS),
	environment: d.vec4f
} as const;

/** WGSL: an sRGB-encoded vec3f expression as linear light. */
export function srgbToLinearWgsl(encoded: string): string {
	return /* wgsl */ `select(pow((${encoded} + vec3f(0.055)) / 1.055, vec3f(2.4)), ${encoded} / 12.92, ${encoded} <= vec3f(0.04045))`;
}

/** WGSL: a non-negative linear-light vec3f expression, sRGB-encoded. The inverse of `srgbToLinearWgsl`. */
export function linearToSrgbWgsl(linear: string): string {
	return /* wgsl */ `select(1.055 * pow(${linear}, vec3f(1.0 / 2.4)) - vec3f(0.055), ${linear} * 12.92, ${linear} <= vec3f(0.0031308))`;
}

/**
 * WGSL: shade one body fragment. Expects unit `N`, `V` (to the eye), `L` (to
 * the key), a linear `albedo`, `roughness`, `metallic`, the key's `keyIntensity`
 * and its `lit` fraction (1 = unshadowed), and `${uniforms}.environment`;
 * declares `var color` (linear) and `diffuseColor` for the emitters that follow.
 */
export function stageMaterialShadingWgsl(uniforms: string): string {
	return /* wgsl */ `
	let alpha = max(roughness * roughness, ${ROUGHNESS_FLOOR * ROUGHNESS_FLOOR});
	let NdotV = max(dot(N, V), 1e-4);
	let NdotL = max(dot(N, L), 0.0);
	let H = normalize(L + V);
	let NdotH = max(dot(N, H), 0.0);
	let VdotH = max(dot(V, H), 0.0);
	let F0 = mix(vec3f(0.04), albedo, metallic);
	let diffuseColor = albedo * (1.0 - metallic);
	// The key as a softbox: widen the lobe by its angular size, renormalise.
	let alphaKey = min(alpha + ${KEY_ANGULAR_RADIUS}, 1.0);
	let keyNormalisation = (alpha / alphaKey) * (alpha / alphaKey);
	let a2 = alphaKey * alphaKey;
	let ggxDenominator = NdotH * NdotH * (a2 - 1.0) + 1.0;
	let distribution = a2 / (3.14159265 * ggxDenominator * ggxDenominator);
	let visibilityV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
	let visibilityL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
	let visibility = 0.5 / max(visibilityV + visibilityL, 1e-4);
	let fresnel = F0 + (vec3f(1.0) - F0) * pow(1.0 - VdotH, 5.0);
	let specular = distribution * visibility * fresnel * keyNormalisation;
	let diffuse = diffuseColor / 3.14159265;
	var color = (diffuse + specular) * (keyIntensity * ${KEY_RADIANCE}) * NdotL * lit;
	// The room: the Pack field bouncing up under a dim ceiling, as diffuse
	// irradiance by the normal and as a roughness-blurred reflection.
	let ceiling = vec3f(${CEILING_RADIANCE});
	let floorBounce = ${uniforms}.environment.rgb * ${FLOOR_BOUNCE};
	let irradiance = mix(floorBounce, ceiling, N.y * 0.5 + 0.5);
	color = color + diffuseColor * irradiance;
	let R = reflect(-V, N);
	let reflectedUp = mix(R.y * 0.5 + 0.5, 0.5, roughness);
	let environmentSpecular = mix(floorBounce, ceiling, reflectedUp);
	// The BRDF's response to that environment (Karis' analytic split sum).
	let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
	let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
	let r = roughness * c0 + c1;
	let a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
	let environmentScale = vec2f(-1.04, 1.04) * a004 + r.zw;
	color = color + environmentSpecular * (F0 * environmentScale.x + environmentScale.y);`;
}

/**
 * WGSL: compress `color` above the knee and encode it for the display-space
 * scene target. Below the knee the encode is exact, so a body's albedo under
 * unit light displays as its registered colour.
 */
export function stageToneEncodeWgsl(): string {
	return /* wgsl */ `
	let over = max(color - vec3f(${TONE_KNEE}), vec3f(0.0));
	color = min(color, vec3f(${TONE_KNEE})) + over / (vec3f(1.0) + over) * ${1 - TONE_KNEE};
	let encodedLow = color * 12.92;
	let encodedHigh = 1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
	color = select(encodedHigh, encodedLow, color <= vec3f(0.0031308));`;
}
