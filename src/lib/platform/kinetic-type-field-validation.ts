import type { KineticTypeField, MotionBeat, SurfaceState } from './engine-schema';
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
