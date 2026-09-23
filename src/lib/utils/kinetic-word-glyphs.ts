import { evaluateKeyframeTrackAtMs } from '$lib/platform/keyframe-track-evaluation';
import type { KineticWordGlyphStagger, Keyframe } from '$lib/platform/engine-schema';

/**
 * One rendered glyph of a staggered Kinetic Word: the grapheme it draws and its
 * own `reveal` offset inside the word's line-box mask.
 */
export interface KineticWordGlyphFrame {
	text: string;
	reveal: number;
}

const graphemeSegmenter =
	typeof Intl !== 'undefined' && 'Segmenter' in Intl
		? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
		: null;

/** Split one word token into the grapheme clusters a glyph stagger delays. */
export function splitKineticWordGraphemes(text: string): string[] {
	if (graphemeSegmenter) {
		return [...graphemeSegmenter.segment(text)].map((segment) => segment.segment);
	}
	return [...text];
}

/**
 * The stagger rank of each glyph: how many `offsetMs` delays it waits behind
 * the first glyph to play. `center` plays outward from the middle so a word
 * blooms rather than types.
 */
export function kineticWordGlyphStaggerRanks(
	glyphCount: number,
	order: KineticWordGlyphStagger['order']
): number[] {
	const ranks: number[] = [];
	const last = glyphCount - 1;
	for (let index = 0; index < glyphCount; index += 1) {
		if (order === 'forward') ranks.push(index);
		else if (order === 'reverse') ranks.push(last - index);
		else ranks.push(Math.abs(index - last / 2));
	}
	return ranks;
}

/**
 * Evaluate the word's shared `reveal` track once per glyph at this exact
 * composition millisecond, each glyph delayed by its stagger rank. Without a
 * stagger every glyph shares the word-level value, so an unstaggered word
 * renders exactly as one text run.
 */
export function evaluateKineticWordGlyphFrames(
	text: string,
	revealTrack: readonly Keyframe[] | undefined,
	stagger: KineticWordGlyphStagger | undefined,
	atMs: number
): KineticWordGlyphFrame[] {
	const graphemes = splitKineticWordGraphemes(text);
	if (!stagger || stagger.offsetMs === 0) {
		const reveal = evaluateKeyframeTrackAtMs(revealTrack, atMs, 0);
		return graphemes.map((glyph) => ({ text: glyph, reveal }));
	}
	const ranks = kineticWordGlyphStaggerRanks(graphemes.length, stagger.order);
	return graphemes.map((glyph, index) => ({
		text: glyph,
		reveal: evaluateKeyframeTrackAtMs(revealTrack, atMs - ranks[index] * stagger.offsetMs, 0)
	}));
}
