/**
 * The optical-vignette exposure model, shared by the renderer's uniform packing
 * and the tests that pin its shape. The WGSL in `index.ts` evaluates
 * `sampleOpticalVignetteExposure` per pixel from the uniforms
 * `resolveOpticalVignetteFalloff` returns.
 *
 * The response is the cos⁴ law of natural illumination falloff,
 * E = cos⁴ θ = 1 / (1 + tan² θ)², where the field angle θ grows with distance
 * from the optical centre. `exposureLoss` sets the field angle at the farthest
 * frame corner so that corner loses exactly that many stops:
 * tan² θ_corner = 2^(stops / 2) − 1. `onset` and `feather` reshape how the
 * field angle grows toward that corner — the plateau a lens barrel holds before
 * its edge falloff takes hold — through a softplus ramp on the squared radius.
 * The ramp has zero slope at the centre and grows smoothly and monotonically,
 * so the field has no cusp, no ring, and no hard edge at any setting.
 *
 * Distance is measured in native pixels, so the lens image stays round in both
 * orientations; `roundness` below 1 deliberately stretches it toward the
 * frame's own ellipse.
 *
 * Exposure is light, so it scales linear light: `applyOpticalVignetteExposure`
 * decodes the sRGB-encoded frame, scales it, and encodes it again. Scaling the
 * encoded values directly would darken about twice as many stops as authored.
 */
import { linearChannelToSrgb, srgbChannelToLinear } from '$lib/utils/color';

/** The params the model reads, with schema defaults already filled in. */
export interface OpticalVignetteShape {
	exposureLoss: number;
	onset: number;
	feather: number;
	roundness: number;
	center: { x: number; y: number };
}

/** Native frame size in pixels. */
export interface OpticalVignetteFrameSize {
	width: number;
	height: number;
}

/** Per-frame constants of the exposure field, in the units the shader reads. */
export interface OpticalVignetteFalloff {
	/** Optical centre in native pixels. */
	centerPx: { x: number; y: number };
	/** Pixel offset → normalised radius, where the farthest corner sits at 1. */
	axisScale: { x: number; y: number };
	/** tan² of the corner field angle: 2^(stops / 2) − 1. Exactly 0 at zero loss. */
	fieldGain: number;
	onsetSquared: number;
	feather: number;
	/** The ramp's value at the centre, subtracted so the centre keeps full exposure. */
	rampOffset: number;
	/** 1 / the ramp's span from centre to the farthest corner. */
	rampScale: number;
}

function featheredSoftplus(value: number, feather: number): number {
	return Math.max(value, 0) + feather * Math.log1p(Math.exp(-Math.abs(value) / feather));
}

/** Resolve the exposure field's constants for one frame. */
export function resolveOpticalVignetteFalloff(
	shape: OpticalVignetteShape,
	frame: OpticalVignetteFrameSize
): OpticalVignetteFalloff {
	const width = Math.max(frame.width, 1);
	const height = Math.max(frame.height, 1);
	const centerPx = { x: shape.center.x * width, y: shape.center.y * height };

	// A round lens measures every direction in the same pixels; roundness 0
	// measures each axis in its own frame extent instead.
	const roundAxis = Math.sqrt(width * height);
	const axisX = width + (roundAxis - width) * shape.roundness;
	const axisY = height + (roundAxis - height) * shape.roundness;

	// The metric is convex, so the farthest pixel is one of the four corners.
	const farthestCornerRadius = Math.max(
		...[0, width].flatMap((cornerX) =>
			[0, height].map((cornerY) =>
				Math.hypot((cornerX - centerPx.x) / axisX, (cornerY - centerPx.y) / axisY)
			)
		)
	);
	const referenceRadius = Math.max(farthestCornerRadius, Number.EPSILON);

	const feather = shape.feather;
	const onsetSquared = shape.onset * shape.onset;
	const rampOffset = featheredSoftplus(-onsetSquared, feather);
	const rampSpan = featheredSoftplus(1 - onsetSquared, feather) - rampOffset;

	return {
		centerPx,
		axisScale: { x: 1 / (axisX * referenceRadius), y: 1 / (axisY * referenceRadius) },
		fieldGain: 2 ** (shape.exposureLoss / 2) - 1,
		onsetSquared,
		feather,
		rampOffset,
		rampScale: 1 / rampSpan
	};
}

/**
 * Relative exposure (0..1] at one native pixel centre. The renderer multiplies
 * premultiplied RGB by this value and leaves alpha alone.
 */
export function sampleOpticalVignetteExposure(
	falloff: OpticalVignetteFalloff,
	pixelX: number,
	pixelY: number
): number {
	const offsetX = (pixelX - falloff.centerPx.x) * falloff.axisScale.x;
	const offsetY = (pixelY - falloff.centerPx.y) * falloff.axisScale.y;
	const radiusSquared = offsetX * offsetX + offsetY * offsetY;
	const ramp =
		Math.max(
			featheredSoftplus(radiusSquared - falloff.onsetSquared, falloff.feather) - falloff.rampOffset,
			0
		) * falloff.rampScale;
	const cosineSquared = 1 / (1 + falloff.fieldGain * ramp);
	return cosineSquared * cosineSquared;
}

/** One premultiplied, sRGB-encoded RGBA texel. */
export type OpticalVignetteTexel = readonly [number, number, number, number];

/**
 * Scale one premultiplied, sRGB-encoded texel by `exposure` in linear light.
 * Alpha is returned unchanged; a texel at full exposure or with no coverage is
 * returned exactly as it came in.
 */
export function applyOpticalVignetteExposure(
	texel: OpticalVignetteTexel,
	exposure: number
): OpticalVignetteTexel {
	const alpha = texel[3];
	if (exposure >= 1 || alpha <= 0) return texel;
	const scale = (premultiplied: number): number =>
		linearChannelToSrgb(srgbChannelToLinear(premultiplied / alpha) * exposure) * alpha;
	return [scale(texel[0]), scale(texel[1]), scale(texel[2]), alpha];
}
