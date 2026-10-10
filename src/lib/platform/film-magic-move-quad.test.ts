import { describe, expect, it } from 'vitest';

import { resolveFilmMagicMoveQuad } from './film-magic-move-quad';
import { evaluateNamedEase, NAMED_EASE_CURVES } from '../utils/ease-curves';
import { interpolateOrientedRectPx, type OrientedRectPx } from '../utils/oriented-rect';
import { crossFadePremultipliedChannel } from '../utils/premultiplied-cross-fade';

const FROM: OrientedRectPx = {
	centerX: 400,
	centerY: 1800,
	width: 600,
	height: 200,
	rotationDegrees: 350
};
const TO: OrientedRectPx = {
	centerX: 3000,
	centerY: 400,
	width: 1200,
	height: 400,
	rotationDegrees: 10
};

describe('the quad of one magic-move pair on one window frame', () => {
	it('carries the outgoing box to the incoming box by the eased window progress', () => {
		const quad = resolveFilmMagicMoveQuad(FROM, TO, 'smooth', 0.5);
		const eased = 1 - (1 - 0.5) ** 3;

		expect(eased).toBe(0.875);
		expect(quad.rect).toEqual(interpolateOrientedRectPx(FROM, TO, eased));
		expect(quad.rect.centerX).toBe(400 + 2600 * 0.875);
		// 350° to 10° is 20° the short way.
		expect(quad.rect.rotationDegrees).toBe(350 + 20 * 0.875);
		expect(quad.mix).toBe(0.875);
		expect(quad.from).toEqual(FROM);
		expect(quad.to).toEqual(TO);
	});

	it.each(NAMED_EASE_CURVES)('drives the box and the cross-fade from one %s value', (ease) => {
		for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
			const eased = evaluateNamedEase(ease, progress);
			const quad = resolveFilmMagicMoveQuad(FROM, TO, ease, progress);

			expect(quad.rect).toEqual(interpolateOrientedRectPx(FROM, TO, eased));
			expect(quad.mix).toBe(Math.min(1, Math.max(0, eased)));
		}
	});

	it('lets an ease that overshoots carry the box past its place, and holds the cross-fade at 1', () => {
		const progress = 0.6;
		const eased = evaluateNamedEase('settled', progress);
		expect(eased).toBeGreaterThan(1);

		const quad = resolveFilmMagicMoveQuad(FROM, TO, 'settled', progress);

		expect(quad.rect.centerX).toBeGreaterThan(TO.centerX);
		expect(quad.rect.width).toBeGreaterThan(TO.width);
		expect(quad.mix).toBe(1);
	});

	it('is the outgoing box alone at progress 0 and the incoming box alone at 1', () => {
		for (const ease of NAMED_EASE_CURVES) {
			expect(resolveFilmMagicMoveQuad(FROM, TO, ease, 0)).toMatchObject({ rect: FROM, mix: 0 });
			expect(resolveFilmMagicMoveQuad(FROM, TO, ease, 1)).toMatchObject({ rect: TO, mix: 1 });
		}
	});

	it('gives the same quad for the same inputs', () => {
		expect(resolveFilmMagicMoveQuad(FROM, TO, 'bouncy', 0.37)).toEqual(
			resolveFilmMagicMoveQuad({ ...FROM }, { ...TO }, 'bouncy', 0.37)
		);
	});

	it('shows the two captures cross-faded by `mix`, as the premultiplied cross-fade', () => {
		// The quad pass mixes the two premultiplied captures with this formula.
		const { mix } = resolveFilmMagicMoveQuad(FROM, TO, 'smooth', 0.2);
		const outgoing = [0.8, 0.4, 0.2, 0.8];
		const incoming = [0, 0, 0, 0];

		const shown = outgoing.map((channel, index) =>
			crossFadePremultipliedChannel(channel, incoming[index], mix)
		);

		// An element the incoming Scene does not show yet fades towards nothing.
		expect(shown).toEqual(outgoing.map((channel) => channel * (1 - mix)));
		expect(crossFadePremultipliedChannel(0.8, 0.6, 0)).toBe(0.8);
		expect(crossFadePremultipliedChannel(0.8, 0.6, 1)).toBe(0.6);
	});
});
