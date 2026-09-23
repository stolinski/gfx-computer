import type { KineticTypeField, SurfaceState } from './engine-schema';

/** Semantic finding inside `surface.typeField`. Structural ceilings live in Zod. */
export interface KineticTypeFieldSemanticIssue {
	path: (string | number)[];
	message: string;
}

export const KINETIC_TYPE_FIELD_SURFACE_TYPE = 'plain' as const;

/**
 * Validate meaning the structural schema cannot see: Surface and Stage support,
 * the one shared Block-id namespace, and focal hierarchy. Phrase reference
 * integrity, uniqueness, token shape, and ceilings are structural schema concerns.
 */
export function validateKineticTypeFieldSemantics(
	field: KineticTypeField | undefined,
	surface: SurfaceState,
	stagePresent = false
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

	return issues;
}
