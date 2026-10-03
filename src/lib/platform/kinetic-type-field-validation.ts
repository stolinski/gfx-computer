import {
	KINETIC_TYPE_CRITICAL_MOMENT_LIMIT,
	listKineticTypeCriticalMoments
} from '$lib/utils/kinetic-type-critical-moments';
import {
	listKineticWordKeyframeTracks,
	type KineticTypeField,
	type KineticWord,
	type MotionBeat,
	type SurfaceState
} from './engine-schema';
import { evaluateKeyframeTrackAtMs } from './keyframe-track-evaluation';

/** Semantic finding inside `surface.typeField`. Structural ceilings live in Zod. */
export interface KineticTypeFieldSemanticIssue {
	path: (string | number)[];
	message: string;
}

export const KINETIC_TYPE_FIELD_SURFACE_TYPE = 'plain' as const;

/** At its beat, a phrase word reads only when it is this opaque and this settled. */
export const KINETIC_PHRASE_READABLE_OPACITY = 0.98;
export const KINETIC_PHRASE_READABLE_REVEAL = 0.02;

/**
 * Whether a Kinetic Word reads at `atMs`: fully shown and settled in its own
 * mask. A word rising into or leaving its mask is in motion, not on screen to
 * be read; verification neither expects it nor faults its moving geometry.
 */
export function isKineticWordReadableAt(word: KineticWord, atMs: number): boolean {
	const channels = word.animation?.channels;
	return (
		evaluateKeyframeTrackAtMs(channels?.opacity, atMs, 1) >= KINETIC_PHRASE_READABLE_OPACITY &&
		Math.abs(evaluateKeyframeTrackAtMs(channels?.reveal, atMs, 0)) <= KINETIC_PHRASE_READABLE_REVEAL
	);
}

/**
 * Field-wide resource ceilings (ADR-0064). Per-word and per-channel ceilings
 * live in the schema; these bound what one field costs to play and to verify:
 * keyframes across every word and track, and glyph spans (a word with a
 * `reveal` track renders one span per grapheme).
 */
export const KINETIC_TYPE_FIELD_KEYFRAME_LIMIT = 320;
export const KINETIC_TYPE_FIELD_GLYPH_SPAN_LIMIT = 192;

/**
 * Validate meaning the structural schema cannot see: Surface and Stage support,
 * the one shared Block-id namespace, and focal hierarchy. Phrase reference
 * integrity, uniqueness, token shape, and ceilings are structural schema concerns.
 */
export function validateKineticTypeFieldSemantics(
	field: KineticTypeField | undefined,
	surface: SurfaceState,
	stagePresent = false,
	motionBeats: readonly MotionBeat[] = []
): readonly KineticTypeFieldSemanticIssue[] {
	if (!field) return [];
	const issues: KineticTypeFieldSemanticIssue[] = [];

	if (surface.type !== KINETIC_TYPE_FIELD_SURFACE_TYPE) {
		issues.push({
			path: [],
			message: `A Type Field is supported only on the ${KINETIC_TYPE_FIELD_SURFACE_TYPE} Surface, not ${surface.type}.`
		});
	}
	if (stagePresent) {
		issues.push({
			path: [],
			message: 'A Type Field does not support the Dimensional Stage in v1.'
		});
	}

	const occupiedBlockIds = new Set([
		...(surface.diagram ?? []).map((block) => block.id),
		...(surface.chart?.items ?? []).map((block) => block.id)
	]);
	for (const [wordIndex, word] of field.words.entries()) {
		if (!occupiedBlockIds.has(word.id)) continue;
		issues.push({
			path: ['words', wordIndex, 'id'],
			message: `Kinetic Word id "${word.id}" duplicates another Block id on this Surface.`
		});
	}

	const wordsById = new Map(field.words.map((word) => [word.id, word]));
	for (const [phraseIndex, phrase] of field.phrases.entries()) {
		const focalWord = wordsById.get(phrase.focalWordId);
		if (focalWord && focalWord.hierarchy !== 'display') {
			issues.push({
				path: ['phrases', phraseIndex, 'focalWordId'],
				message: `Phrase "${phrase.id}" focal Kinetic Word "${phrase.focalWordId}" must use display hierarchy.`
			});
		}
	}

	let keyframeCount = 0;
	let glyphSpanCount = 0;
	for (const word of field.words) {
		for (const { frames } of listKineticWordKeyframeTracks(word)) keyframeCount += frames.length;
		if (word.animation?.channels?.reveal) {
			glyphSpanCount += [
				...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.text)
			].length;
		}
	}
	if (keyframeCount > KINETIC_TYPE_FIELD_KEYFRAME_LIMIT) {
		issues.push({
			path: ['words'],
			message: `The Type Field holds ${keyframeCount} keyframes across its words; one field plays at most ${KINETIC_TYPE_FIELD_KEYFRAME_LIMIT}. Clear channels that hold still or remove redundant keys.`
		});
	}
	if (glyphSpanCount > KINETIC_TYPE_FIELD_GLYPH_SPAN_LIMIT) {
		issues.push({
			path: ['words'],
			message: `Masked words split into ${glyphSpanCount} glyph spans; one field renders at most ${KINETIC_TYPE_FIELD_GLYPH_SPAN_LIMIT}. Clear the reveal track on words that do not need a masked entrance.`
		});
	}
	const momentCount = listKineticTypeCriticalMoments(field, motionBeats).length;
	if (momentCount > KINETIC_TYPE_CRITICAL_MOMENT_LIMIT) {
		issues.push({
			path: ['words'],
			message: `The Type Field asks verification to sample ${momentCount} critical moments (Motion Beats plus each word's keyframe envelopes); at most ${KINETIC_TYPE_CRITICAL_MOMENT_LIMIT} are checked. Merge word moves onto shared beats or remove envelopes that change nothing visible.`
		});
	}

	// One readable phrase per beat (ADR-0064): every word of a beat-bound phrase
	// is fully shown and settled in its mask at the beat. Words outside the
	// phrase are free; persistence and turnover are the author's.
	const beatsById = new Map(motionBeats.map((beat) => [beat.id, beat]));
	for (const [phraseIndex, phrase] of field.phrases.entries()) {
		const beat = phrase.beatId ? beatsById.get(phrase.beatId) : undefined;
		if (!beat) continue;
		const unreadable: string[] = [];
		for (const wordId of phrase.wordIds) {
			const channels = wordsById.get(wordId)?.animation?.channels;
			const opacity = evaluateKeyframeTrackAtMs(channels?.opacity, beat.atMs, 1);
			const reveal = evaluateKeyframeTrackAtMs(channels?.reveal, beat.atMs, 0);
			if (opacity < KINETIC_PHRASE_READABLE_OPACITY) {
				unreadable.push(`"${wordId}" is at opacity ${opacity.toFixed(2)}`);
			} else if (Math.abs(reveal) > KINETIC_PHRASE_READABLE_REVEAL) {
				unreadable.push(`"${wordId}" is ${reveal < 0 ? 'still rising into' : 'leaving'} its mask`);
			}
		}
		if (unreadable.length > 0) {
			issues.push({
				path: ['phrases', phraseIndex, 'beatId'],
				message: `Phrase "${phrase.id}" must read at Motion Beat "${beat.id}" (${beat.atMs} ms), but ${unreadable.join(' and ')}.`
			});
		}
	}

	return issues;
}
