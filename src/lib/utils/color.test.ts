import { describe, expect, it } from 'vitest';

import {
	linearChannelToSrgb,
	relativeLuminance,
	srgbChannelToLinear,
	wcagContrastRatio,
	wcagRelativeLuminance
} from './color.ts';

describe('wcagRelativeLuminance', () => {
	it('anchors black and white at the WCAG endpoints', () => {
		expect(wcagRelativeLuminance('#000000')).toBe(0);
		expect(wcagRelativeLuminance('#ffffff')).toBeCloseTo(1, 6);
	});

	it('linearizes before weighting, unlike the rendering luminance', () => {
		// Mid grey is ~0.5 gamma-encoded but ~0.216 linear; conflating the two
		// would inflate every contrast ratio.
		expect(relativeLuminance('#808080')).toBeCloseTo(0.502, 3);
		expect(wcagRelativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
	});

	it('rejects a non-hex colour', () => {
		expect(() => wcagRelativeLuminance('rebeccapurple')).toThrow(TypeError);
	});
});

describe('wcagContrastRatio', () => {
	it('reports the 21:1 maximum and the 1:1 floor', () => {
		expect(wcagContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
		expect(wcagContrastRatio('#131315', '#131315')).toBeCloseTo(1, 6);
	});

	it('is order independent', () => {
		expect(wcagContrastRatio('#8a8a90', '#0c0c0e')).toBeCloseTo(
			wcagContrastRatio('#0c0c0e', '#8a8a90'),
			10
		);
	});

	it('clears AA for the chrome muted text on the recessed well', () => {
		expect(wcagContrastRatio('#8a8a90', '#0c0c0e')).toBeGreaterThanOrEqual(4.5);
	});
});

describe('srgbChannelToLinear', () => {
	it('follows the IEC 61966-2-1 curve at its ends and its knee', () => {
		expect(srgbChannelToLinear(0)).toBe(0);
		expect(srgbChannelToLinear(1)).toBeCloseTo(1, 6);
		expect(srgbChannelToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 6);
		expect(srgbChannelToLinear(0.5)).toBeCloseTo(0.214, 3);
	});
});

describe('linearChannelToSrgb', () => {
	it('inverts srgbChannelToLinear across the curve', () => {
		expect(linearChannelToSrgb(0)).toBe(0);
		for (const encoded of [0.01, 0.04045, 0.2, 0.5, 0.8, 1]) {
			expect(linearChannelToSrgb(srgbChannelToLinear(encoded))).toBeCloseTo(encoded, 6);
		}
	});
});
