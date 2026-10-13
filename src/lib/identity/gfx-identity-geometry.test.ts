import { describe, expect, it } from 'vite-plus/test';

import {
	GFX_IDENTITY,
	GFX_IDENTITY_PALETTE,
	GFX_IDENTITY_TILE_UNITS,
	measureGfxIdentityFeaturePixels,
	renderGfxIdentityLogotypeSvg,
	renderGfxIdentityMarkSvg,
	renderGfxIdentityTitleCardSvg
} from './gfx-identity-geometry.ts';

/** Smallest feature that still resolves on a standard-density display. */
const MINIMUM_FEATURE_PIXELS = 1.5;

/** The favicon size a browser tab actually paints most often. */
const FAVICON_PIXELS = 16;

function extractFills(svg: string): string[] {
	return [...svg.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
}

describe('the ratified identity', () => {
	it('stays traceable to the direction Scott approved', () => {
		expect(GFX_IDENTITY.ratifiedCandidateId).toBe('slate');
	});

	it('orders the decay ramp by falling luminance, face first', () => {
		// The palette is a decay, not a triad: yellow, then red, then blue —
		// each echo one frame older and dimmer than the last.
		expect(GFX_IDENTITY_PALETTE.decay).toEqual(['#FFC940', '#F23B3F', '#3D5AF5']);
	});
});

describe('small-size legibility', () => {
	it('keeps the tightest feature above the resolvable width at 16px', () => {
		expect(measureGfxIdentityFeaturePixels(FAVICON_PIXELS)).toBeGreaterThanOrEqual(
			MINIMUM_FEATURE_PIXELS
		);
	});

	it('scales the feature width linearly with the rendered size', () => {
		expect(measureGfxIdentityFeaturePixels(64)).toBeCloseTo(
			measureGfxIdentityFeaturePixels(32) * 2,
			6
		);
	});

	it('refuses a non-positive rendered size', () => {
		expect(() => measureGfxIdentityFeaturePixels(0)).toThrow(TypeError);
	});
});

describe('mark emission', () => {
	it('draws inside the 64-unit tile', () => {
		const svg = renderGfxIdentityMarkSvg();
		expect(svg).toContain(`viewBox="0 0 ${GFX_IDENTITY_TILE_UNITS} ${GFX_IDENTITY_TILE_UNITS}"`);
		expect(svg).toContain('<path d="M');
	});

	it('emits no typeset text, so a favicon rasterizes with no font available', () => {
		for (const svg of [
			renderGfxIdentityMarkSvg(),
			renderGfxIdentityLogotypeSvg(),
			renderGfxIdentityTitleCardSvg({ lit: false })
		]) {
			expect(svg).not.toContain('<text');
			expect(svg).not.toContain('font-family');
		}
	});

	it('stacks exactly the decay ramp behind the card and the face on it', () => {
		const fills = new Set(extractFills(renderGfxIdentityMarkSvg()));
		expect(fills).toEqual(
			new Set([
				...GFX_IDENTITY_PALETTE.decay,
				GFX_IDENTITY_PALETTE.card,
				GFX_IDENTITY_PALETTE.face
			])
		);
	});

	it('keeps the flat fan at mark scale, so the small cut has no concentric roll', () => {
		const radius = `rx="${GFX_IDENTITY.markCardRadiusUnits}"`;
		const svg = renderGfxIdentityMarkSvg();
		expect([...svg.matchAll(/rx="([\d.]+)"/g)].map((match) => match[1])).toEqual(
			Array.from({ length: 4 }, () => String(GFX_IDENTITY.markCardRadiusUnits))
		);
		expect(svg).toContain(radius);
	});

	it('carries GFX as its accessible name, so the mark alone still names the product', () => {
		expect(renderGfxIdentityMarkSvg()).toContain('aria-label="GFX mark"');
	});
});

describe('title-card emission', () => {
	it('grows a deeper card radius by exactly its offset, so the bands stay concentric', () => {
		const svg = renderGfxIdentityTitleCardSvg({ lit: false });
		const radii = [...svg.matchAll(/rx="([\d.]+)"/g)].map((match) => Number(match[1]));
		const { titleCardRadiusUnits, titleCardFanStepUnits } = GFX_IDENTITY;
		expect(radii).toEqual([
			titleCardRadiusUnits + titleCardFanStepUnits * 3,
			titleCardRadiusUnits + titleCardFanStepUnits * 2,
			titleCardRadiusUnits + titleCardFanStepUnits * 1,
			titleCardRadiusUnits
		]);
	});

	it('lifts the card one surface step instead of carrying a keyline', () => {
		const svg = renderGfxIdentityTitleCardSvg({ lit: false });
		expect(svg).toContain(`fill="${GFX_IDENTITY_PALETTE.cardLifted}"`);
		expect(svg).not.toContain('stroke=');
	});

	it('blooms only the lit cut — the core cut carries no filter', () => {
		expect(renderGfxIdentityTitleCardSvg({ lit: true })).toContain('feGaussianBlur');
		expect(renderGfxIdentityTitleCardSvg({ lit: false })).not.toContain('feGaussianBlur');
	});

	it('sets the lit face white-hot and the core face in chrome ink', () => {
		expect(renderGfxIdentityTitleCardSvg({ lit: true })).toContain(
			`fill="${GFX_IDENTITY_PALETTE.faceLit}"`
		);
		expect(renderGfxIdentityTitleCardSvg({ lit: false })).toContain(
			`fill="${GFX_IDENTITY_PALETTE.face}"`
		);
	});
});

describe('logotype emission', () => {
	it('sets G, F and X on one baseline as three single-outline paths', () => {
		const svg = renderGfxIdentityLogotypeSvg();
		expect([...svg.matchAll(/<path /g)]).toHaveLength(3);
		// Three glyphs advance across the line, so the tight box is always wider
		// than it is tall.
		const viewBox = /viewBox="-2 -2 ([\d.]+) ([\d.]+)"/.exec(svg);
		expect(Number(viewBox?.[1])).toBeGreaterThan(Number(viewBox?.[2]));
	});

	it('sets the flat logotype in the chrome ink and nothing else', () => {
		expect(new Set(extractFills(renderGfxIdentityLogotypeSvg()))).toEqual(
			new Set([GFX_IDENTITY_PALETTE.face])
		);
	});
});
