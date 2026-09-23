import { describe, expect, it } from 'vitest';

import {
	evaluateKineticWordGlyphFrames,
	kineticWordGlyphStaggerRanks,
	splitKineticWordGraphemes
} from './kinetic-word-glyphs';
import type { Keyframe } from '$lib/platform/engine-schema';

const rise: Keyframe[] = [
	{ atMs: 0, value: -1 },
	{ atMs: 400, value: 0, ease: 'sharp' }
];

describe('kinetic word glyphs', () => {
	it('splits grapheme clusters, not code units', () => {
		expect(splitKineticWordGraphemes('TYPE')).toEqual(['T', 'Y', 'P', 'E']);
		expect(splitKineticWordGraphemes('É👍🏽!')).toEqual(['É', '👍🏽', '!']);
	});

	it('ranks glyphs forward, reverse, or blooming from the centre', () => {
		expect(kineticWordGlyphStaggerRanks(4, 'forward')).toEqual([0, 1, 2, 3]);
		expect(kineticWordGlyphStaggerRanks(4, 'reverse')).toEqual([3, 2, 1, 0]);
		expect(kineticWordGlyphStaggerRanks(5, 'center')).toEqual([2, 1, 0, 1, 2]);
		expect(kineticWordGlyphStaggerRanks(4, 'center')).toEqual([1.5, 0.5, 0.5, 1.5]);
	});

	it('renders an unstaggered word as one uniform run of the word-level reveal', () => {
		const frames = evaluateKineticWordGlyphFrames('MOVE', rise, undefined, 400);
		expect(frames.map((frame) => frame.text).join('')).toBe('MOVE');
		expect(frames.every((frame) => frame.reveal === 0)).toBe(true);
	});

	it('delays each glyph by its rank so later glyphs are still rising when the first has landed', () => {
		const frames = evaluateKineticWordGlyphFrames(
			'MOVE',
			rise,
			{ offsetMs: 40, order: 'forward' },
			400
		);
		expect(frames[0].reveal).toBe(0);
		expect(frames[1].reveal).toBeLessThan(0);
		expect(frames[2].reveal).toBeLessThan(frames[1].reveal);
		expect(frames[3].reveal).toBeLessThan(frames[2].reveal);
		// Before the track starts every glyph holds the first key: fully masked.
		const parked = evaluateKineticWordGlyphFrames(
			'MOVE',
			rise,
			{ offsetMs: 40, order: 'forward' },
			0
		);
		expect(parked.every((frame) => frame.reveal === -1)).toBe(true);
	});
});
