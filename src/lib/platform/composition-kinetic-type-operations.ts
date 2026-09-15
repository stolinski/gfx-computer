/**
 * Shared static Type Field authoring operations (ADR-0063).
 *
 * Layer membership, word content, semantic phrase content, placement, and
 * appearance remain separate inventory decisions. Every path reaches the same
 * revisioned transaction from GUI and WebMCP callers.
 */
import { createCompositionEntityId } from '$lib/utils/composition-entity-id';
import {
	KINETIC_TYPE_WORD_CODE_POINT_LIMIT,
	KINETIC_TYPE_WORD_LIMIT,
	KINETIC_WORD_HIERARCHIES,
	KINETIC_WORD_INK_ROLES,
	KineticWordGeometrySchema,
	type KineticPhrase,
	type KineticWord,
	type KineticWordGeometry,
	type KineticWordHierarchy,
	type KineticWordInk
} from './engine-schema';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { refuseUnloadableCompositionRenderers } from './composition-renderer-readiness';
import { listSurfaceBlockIds } from './composition-block-layer-operations';
import { listCompositionBlockReferences } from './composition-entity-references';
import { KINETIC_TYPE_FIELD_SURFACE_TYPE } from './kinetic-type-field-validation';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

export interface AddCompositionKineticWordRequest {
	expectedRevision: number;
}

export interface RemoveCompositionKineticWordRequest {
	expectedRevision: number;
	wordId: string;
}

export interface SetCompositionKineticWordTextRequest {
	expectedRevision: number;
	wordId: string;
	text: string;
}

export interface SetCompositionKineticPhrasesRequest {
	expectedRevision: number;
	phrases: readonly KineticPhrase[];
}

export type KineticWordPlacementScope = 'shared' | 'horizontal' | 'vertical';

export interface SetCompositionKineticWordPlacementRequest {
	expectedRevision: number;
	wordId: string;
	scope: KineticWordPlacementScope;
	geometry: KineticWordGeometry;
}

export interface SetCompositionKineticWordAppearanceRequest {
	expectedRevision: number;
	wordId: string;
	hierarchy: KineticWordHierarchy;
	ink: KineticWordInk;
}

function refuseUnknownKineticWord(
	row: WebmcpOperationRow,
	wordId: string,
	known: readonly string[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No Kinetic Word Block in this composition is named "${wordId}".`,
		{ rejected: wordId, alternatives: known }
	);
}

function requireDraftKineticWord(draftWords: KineticWord[], wordId: string): KineticWord {
	const word = draftWords.find((candidate) => candidate.id === wordId);
	if (word) return word;
	throw new CompositionOperationError(
		'unknown_target',
		`Kinetic Word "${wordId}" is no longer in the Type Field.`,
		{ rejected: wordId }
	);
}

function nextKineticWordDefaults(id: string, index: number): KineticWord {
	return {
		type: 'kinetic-word',
		id,
		text: index === 0 ? 'TYPE' : 'WORD',
		hierarchy: index === 0 ? 'display' : 'support',
		ink: index === 0 ? 'accent' : 'ink',
		position: { x: 0.5, y: 0.5 },
		scale: 1,
		rotation: 0
	};
}

/** Add one word; the first word atomically establishes the valid Type Field. */
export async function runAddCompositionKineticWordOperation(
	request: AddCompositionKineticWordRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.add-kinetic-word');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const current = readOpenCompositionDocument();
	const surface = current.state.surface;
	if (current.state.stage !== undefined) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			'Kinetic Word Blocks do not support the Dimensional Stage in v1.',
			{ rejected: current.state.stage.type, alternatives: ['stage disabled'] }
		);
	}
	if (surface.type !== KINETIC_TYPE_FIELD_SURFACE_TYPE) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Kinetic Word Blocks require the ${KINETIC_TYPE_FIELD_SURFACE_TYPE} Surface.`,
			{ rejected: surface.type, alternatives: [KINETIC_TYPE_FIELD_SURFACE_TYPE] }
		);
	}
	const existingWords = surface.typeField?.words ?? [];
	if (existingWords.length >= KINETIC_TYPE_WORD_LIMIT) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'limit_exceeded',
			`A Type Field holds at most ${KINETIC_TYPE_WORD_LIMIT} Kinetic Word Blocks.`,
			{ rejected: 'kinetic-word', alternatives: existingWords.map((word) => word.id) }
		);
	}

	const wordId = createCompositionEntityId('kinetic-word', listSurfaceBlockIds(surface));
	const word = nextKineticWordDefaults(wordId, existingWords.length);
	const typeField = surface.typeField
		? { ...surface.typeField, words: [...surface.typeField.words, word] }
		: {
				words: [word],
				phrases: [{ id: 'phrase-1', wordIds: [wordId], focalWordId: wordId }]
			};
	const rendererRefusal = await refuseUnloadableCompositionRenderers(
		row,
		{
			...current,
			state: { ...current.state, surface: { ...surface, typeField } }
		},
		'the kinetic-word Block'
	);
	if (rendererRefusal) return rendererRefusal;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Add Kinetic Word',
		focus: { target: 'block', blockId: wordId },
		mutate: (draft) => {
			if (listSurfaceBlockIds(draft.state.surface).includes(wordId)) {
				throw new CompositionOperationError(
					'precondition_unmet',
					`The Block id "${wordId}" was just taken.`,
					{ rejected: wordId }
				);
			}
			draft.state.surface.typeField = structuredClone(typeField);
		}
	});
}

/** Remove one word; removing the only word removes the whole parent field. */
export async function runRemoveCompositionKineticWordOperation(
	request: RemoveCompositionKineticWordRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('layer.remove-kinetic-word');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const field = readOpenCompositionDocument().state.surface.typeField;
	const words = field?.words ?? [];
	if (!words.some((word) => word.id === request.wordId)) {
		return refuseUnknownKineticWord(
			row,
			request.wordId,
			words.map((word) => word.id)
		);
	}
	const references = [
		...listCompositionBlockReferences(readOpenCompositionDocument().state, request.wordId).map(
			(reference) => reference.pointer
		),
		...(words.length === 1
			? []
			: (field?.phrases ?? []).flatMap((phrase, phraseIndex) =>
					phrase.wordIds.includes(request.wordId)
						? [`/state/surface/typeField/phrases/${phraseIndex}/wordIds`]
						: []
				))
	];
	if (references.length > 0) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Kinetic Word "${request.wordId}" is still referenced. Remove the listed phrase or Cascade references first.`,
			{ rejected: request.wordId, alternatives: references }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: words.length === 1 ? 'Remove Type Field' : 'Remove Kinetic Word',
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			const draftField = draft.state.surface.typeField;
			if (!draftField) {
				throw new CompositionOperationError(
					'unknown_target',
					'The Type Field is no longer present.'
				);
			}
			if (draftField.words.length === 1 && draftField.words[0]?.id === request.wordId) {
				draft.state.surface.typeField = undefined;
				return;
			}
			const index = draftField.words.findIndex((word) => word.id === request.wordId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Kinetic Word "${request.wordId}" is no longer in the Type Field.`,
					{ rejected: request.wordId }
				);
			}
			draftField.words.splice(index, 1);
		}
	});
}

/** Set one word token without crossing into appearance or placement. */
export async function runSetCompositionKineticWordTextOperation(
	request: SetCompositionKineticWordTextRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-kinetic-word-text');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const words = readOpenCompositionDocument().state.surface.typeField?.words ?? [];
	if (!words.some((word) => word.id === request.wordId)) {
		return refuseUnknownKineticWord(
			row,
			request.wordId,
			words.map((word) => word.id)
		);
	}
	if (
		request.text.length === 0 ||
		request.text !== request.text.trim() ||
		!/^\S+$/u.test(request.text) ||
		[...request.text].length > KINETIC_TYPE_WORD_CODE_POINT_LIMIT
	) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`Kinetic Word text must be one trimmed token of at most ${KINETIC_TYPE_WORD_CODE_POINT_LIMIT} Unicode code points.`,
			{ rejected: request.text }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Kinetic Word text',
		focus: { target: 'block', blockId: request.wordId },
		mutate: (draft) => {
			const draftWords = draft.state.surface.typeField?.words;
			if (!draftWords)
				throw new CompositionOperationError('unknown_target', 'The Type Field is gone.');
			requireDraftKineticWord(draftWords, request.wordId).text = request.text;
		}
	});
}

/** Replace every semantic phrase atomically so references can never half-land. */
export async function runSetCompositionKineticPhrasesOperation(
	request: SetCompositionKineticPhrasesRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('content.set-kinetic-phrases');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const field = readOpenCompositionDocument().state.surface.typeField;
	if (!field) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			'This composition has no Type Field phrases to replace.',
			{ rejected: 'phrases', alternatives: ['add a Kinetic Word first'] }
		);
	}
	const focusWordId = request.phrases[0]?.focalWordId ?? field.words[0].id;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Kinetic Type phrases',
		focus: { target: 'block', blockId: focusWordId },
		mutate: (draft) => {
			const draftField = draft.state.surface.typeField;
			if (!draftField)
				throw new CompositionOperationError('unknown_target', 'The Type Field is gone.');
			draftField.phrases = structuredClone([...request.phrases]);
		}
	});
}

/** Set one complete shared or orientation-specific placement snapshot. */
export async function runSetCompositionKineticWordPlacementOperation(
	request: SetCompositionKineticWordPlacementRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-kinetic-word-placement');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const words = readOpenCompositionDocument().state.surface.typeField?.words ?? [];
	if (!words.some((word) => word.id === request.wordId)) {
		return refuseUnknownKineticWord(
			row,
			request.wordId,
			words.map((word) => word.id)
		);
	}
	const parsed = KineticWordGeometrySchema.safeParse(request.geometry);
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'Kinetic Word placement requires a complete normalized position, scale from 0.25 to 4, and rotation from -180° to 180°.',
			{ rejected: JSON.stringify(request.geometry) }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Kinetic Word placement',
		focus: { target: 'block', blockId: request.wordId },
		mutate: (draft) => {
			const draftWords = draft.state.surface.typeField?.words;
			if (!draftWords)
				throw new CompositionOperationError('unknown_target', 'The Type Field is gone.');
			const word = requireDraftKineticWord(draftWords, request.wordId);
			const geometry = structuredClone(parsed.data);
			if (request.scope === 'shared') {
				word.position = geometry.position;
				word.scale = geometry.scale;
				word.rotation = geometry.rotation;
				return;
			}
			word.orientationOverrides ??= {};
			word.orientationOverrides[request.scope] = geometry;
		}
	});
}

/** Set semantic hierarchy and Pack ink-role selection as one appearance edit. */
export async function runSetCompositionKineticWordAppearanceOperation(
	request: SetCompositionKineticWordAppearanceRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('appearance.set-kinetic-word-appearance');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const words = readOpenCompositionDocument().state.surface.typeField?.words ?? [];
	if (!words.some((word) => word.id === request.wordId)) {
		return refuseUnknownKineticWord(
			row,
			request.wordId,
			words.map((word) => word.id)
		);
	}
	if (!KINETIC_WORD_HIERARCHIES.includes(request.hierarchy)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.hierarchy}" is not a Kinetic Word hierarchy.`,
			{ rejected: request.hierarchy, alternatives: KINETIC_WORD_HIERARCHIES }
		);
	}
	if (!KINETIC_WORD_INK_ROLES.includes(request.ink)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unsupported_variant',
			`"${request.ink}" is not a Kinetic Word ink role.`,
			{ rejected: request.ink, alternatives: KINETIC_WORD_INK_ROLES }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Kinetic Word appearance',
		focus: { target: 'block', blockId: request.wordId },
		mutate: (draft) => {
			const draftWords = draft.state.surface.typeField?.words;
			if (!draftWords)
				throw new CompositionOperationError('unknown_target', 'The Type Field is gone.');
			const word = requireDraftKineticWord(draftWords, request.wordId);
			word.hierarchy = request.hierarchy;
			word.ink = request.ink;
		}
	});
}
