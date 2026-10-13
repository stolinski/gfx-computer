import { describe, expect, it } from 'vite-plus/test';

import { linearChannelToSrgb, srgbChannelToLinear } from '$lib/utils/color';

import {
	applyOpticalVignetteExposure,
	resolveOpticalVignetteFalloff,
	sampleOpticalVignetteExposure,
	type OpticalVignetteFrameSize,
	type OpticalVignetteShape
} from './optical-vignette-falloff';

const HORIZONTAL: OpticalVignetteFrameSize = { width: 3840, height: 2160 };
const VERTICAL: OpticalVignetteFrameSize = { width: 2160, height: 3840 };

const DEFAULT_SHAPE: OpticalVignetteShape = {
	exposureLoss: 1,
	onset: 0.3,
	feather: 0.45,
	roundness: 1,
	center: { x: 0.5, y: 0.5 }
};

function exposureAt(
	shape: OpticalVignetteShape,
	frame: OpticalVignetteFrameSize,
	x: number,
	y: number
): number {
	return sampleOpticalVignetteExposure(resolveOpticalVignetteFalloff(shape, frame), x, y);
}

// Exposure sampled along the straight line from the optical centre to a corner.
function rayProfile(
	shape: OpticalVignetteShape,
	frame: OpticalVignetteFrameSize,
	corner: { x: number; y: number },
	samples = 512
): number[] {
	const falloff = resolveOpticalVignetteFalloff(shape, frame);
	return Array.from({ length: samples + 1 }, (_, index) => {
		const t = index / samples;
		return sampleOpticalVignetteExposure(
			falloff,
			falloff.centerPx.x + (corner.x - falloff.centerPx.x) * t,
			falloff.centerPx.y + (corner.y - falloff.centerPx.y) * t
		);
	});
}

function corners(frame: OpticalVignetteFrameSize): { x: number; y: number }[] {
	return [
		{ x: 0, y: 0 },
		{ x: frame.width, y: 0 },
		{ x: 0, y: frame.height },
		{ x: frame.width, y: frame.height }
	];
}

const SHAPE_SWEEP: OpticalVignetteShape[] = [
	DEFAULT_SHAPE,
	{ ...DEFAULT_SHAPE, exposureLoss: 3, onset: 0.8, feather: 0.1 },
	{ ...DEFAULT_SHAPE, exposureLoss: 3, onset: 0, feather: 1 },
	{ ...DEFAULT_SHAPE, exposureLoss: 1.5, roundness: 0 },
	{ ...DEFAULT_SHAPE, exposureLoss: 2, center: { x: 0.2, y: 0.85 } }
];

describe('optical vignette exposure field', () => {
	it('is an exact identity at zero exposure loss', () => {
		for (const frame of [HORIZONTAL, VERTICAL]) {
			for (const shape of SHAPE_SWEEP) {
				const falloff = resolveOpticalVignetteFalloff({ ...shape, exposureLoss: 0 }, frame);
				expect(falloff.fieldGain).toBe(0);
				for (const corner of corners(frame)) {
					expect(sampleOpticalVignetteExposure(falloff, corner.x, corner.y)).toBe(1);
				}
				expect(sampleOpticalVignetteExposure(falloff, frame.width / 3, frame.height / 7)).toBe(1);
			}
		}
	});

	it('keeps full exposure at the optical centre and loses exactly the authored stops at the farthest corner', () => {
		for (const frame of [HORIZONTAL, VERTICAL]) {
			for (const shape of SHAPE_SWEEP) {
				const falloff = resolveOpticalVignetteFalloff(shape, frame);
				expect(sampleOpticalVignetteExposure(falloff, falloff.centerPx.x, falloff.centerPx.y)).toBe(
					1
				);
				const cornerExposures = corners(frame).map((corner) =>
					sampleOpticalVignetteExposure(falloff, corner.x, corner.y)
				);
				expect(Math.log2(Math.min(...cornerExposures))).toBeCloseTo(-shape.exposureLoss, 9);
			}
		}
	});

	it('falls off smoothly and monotonically from the centre to every corner', () => {
		for (const frame of [HORIZONTAL, VERTICAL]) {
			for (const shape of SHAPE_SWEEP) {
				for (const corner of corners(frame)) {
					const profile = rayProfile(shape, frame, corner);
					for (let index = 1; index < profile.length; index += 1) {
						expect(profile[index]).toBeLessThanOrEqual(profile[index - 1]);
					}
					// No ring or kink: the curve's bend per step stays a small fraction of
					// its total drop, so the slope never jumps between neighbouring samples.
					const drop = profile[0] - profile[profile.length - 1];
					for (let index = 1; index < profile.length - 1; index += 1) {
						const bend = Math.abs(profile[index + 1] - 2 * profile[index] + profile[index - 1]);
						expect(bend).toBeLessThan(drop * 0.002);
					}
				}
			}
		}
	});

	it('starts flat at the centre, with no cusp', () => {
		const falloff = resolveOpticalVignetteFalloff(
			{ ...DEFAULT_SHAPE, exposureLoss: 3, onset: 0, feather: 1 },
			HORIZONTAL
		);
		const step = 4;
		const near = sampleOpticalVignetteExposure(
			falloff,
			falloff.centerPx.x + step,
			falloff.centerPx.y
		);
		const farther = sampleOpticalVignetteExposure(
			falloff,
			falloff.centerPx.x + step * 2,
			falloff.centerPx.y
		);
		// A quadratic start loses four times as much at twice the distance; a cusp
		// would lose only twice as much.
		expect((1 - farther) / (1 - near)).toBeCloseTo(4, 2);
	});

	it('draws a round lens image in native pixels in both orientations', () => {
		const shape = { ...DEFAULT_SHAPE, exposureLoss: 2 };
		for (const frame of [HORIZONTAL, VERTICAL]) {
			const cx = frame.width / 2;
			const cy = frame.height / 2;
			for (const radius of [200, 600, 1000]) {
				const alongX = exposureAt(shape, frame, cx + radius, cy);
				const alongY = exposureAt(shape, frame, cx, cy + radius);
				const diagonal = exposureAt(
					shape,
					frame,
					cx + radius / Math.SQRT2,
					cy - radius / Math.SQRT2
				);
				expect(alongY).toBeCloseTo(alongX, 12);
				expect(diagonal).toBeCloseTo(alongX, 12);
			}
		}
		// The two orientations share a half-diagonal, so one pixel radius carries
		// the same exposure in each: the lens is not stretched by the reflow.
		for (const radius of [300, 900, 1500]) {
			expect(exposureAt(shape, VERTICAL, 1080, 1920 + radius)).toBeCloseTo(
				exposureAt(shape, HORIZONTAL, 1920 + radius, 1080),
				12
			);
		}
	});

	it('follows the frame ellipse when roundness is zero', () => {
		const shape = { ...DEFAULT_SHAPE, exposureLoss: 2, roundness: 0 };
		const atEdgeX = exposureAt(shape, HORIZONTAL, HORIZONTAL.width, HORIZONTAL.height / 2);
		const atEdgeY = exposureAt(shape, HORIZONTAL, HORIZONTAL.width / 2, HORIZONTAL.height);
		expect(atEdgeY).toBeCloseTo(atEdgeX, 12);
	});

	it('keeps the deepest loss bounded when the optical centre moves', () => {
		const shape = { ...DEFAULT_SHAPE, exposureLoss: 1, center: { x: 0, y: 0 } };
		const falloff = resolveOpticalVignetteFalloff(shape, HORIZONTAL);
		let darkest = 1;
		for (let y = 0; y <= HORIZONTAL.height; y += 120) {
			for (let x = 0; x <= HORIZONTAL.width; x += 120) {
				darkest = Math.min(darkest, sampleOpticalVignetteExposure(falloff, x, y));
			}
		}
		expect(Math.log2(darkest)).toBeGreaterThanOrEqual(-1 - 1e-9);
		expect(sampleOpticalVignetteExposure(falloff, 0, 0)).toBe(1);
	});

	it('keeps the default restrained across the picture', () => {
		const falloff = resolveOpticalVignetteFalloff(DEFAULT_SHAPE, HORIZONTAL);
		// The middle third of the frame keeps within a tenth of a stop.
		expect(Math.log2(sampleOpticalVignetteExposure(falloff, 1280, 720))).toBeGreaterThan(-0.1);
		// The side edges' midpoints darken, but by less than the corners.
		const edgeLoss = -Math.log2(sampleOpticalVignetteExposure(falloff, 0, 1080));
		expect(edgeLoss).toBeGreaterThan(DEFAULT_SHAPE.exposureLoss * 0.2);
		expect(edgeLoss).toBeLessThan(DEFAULT_SHAPE.exposureLoss * 0.8);
	});
});

describe('optical vignette colour application', () => {
	it('returns full-exposure and uncovered texels exactly', () => {
		const texel = [0.31, 0.62, 0.17, 0.8] as const;
		expect(applyOpticalVignetteExposure(texel, 1)).toBe(texel);
		const transparent = [0, 0, 0, 0] as const;
		expect(applyOpticalVignetteExposure(transparent, 0.25)).toBe(transparent);
	});

	it('loses the authored stops of linear light and keeps alpha', () => {
		const [red, green, blue, alpha] = applyOpticalVignetteExposure([1, 1, 1, 1], 0.5);
		expect(alpha).toBe(1);
		expect(srgbChannelToLinear(red)).toBeCloseTo(0.5, 12);
		expect(green).toBe(red);
		expect(blue).toBe(red);
		expect(red).toBeCloseTo(linearChannelToSrgb(0.5), 12);
	});

	it('scales every channel of a translucent texel by the same linear factor', () => {
		const alpha = 0.6;
		const straight = [0.9, 0.45, 0.2];
		const texel = [straight[0] * alpha, straight[1] * alpha, straight[2] * alpha, alpha] as const;
		const result = applyOpticalVignetteExposure(texel, 0.7);
		expect(result[3]).toBe(alpha);
		for (let channel = 0; channel < 3; channel += 1) {
			const before = srgbChannelToLinear(straight[channel]);
			const after = srgbChannelToLinear(result[channel] / alpha);
			expect(after / before).toBeCloseTo(0.7, 12);
		}
	});
});
