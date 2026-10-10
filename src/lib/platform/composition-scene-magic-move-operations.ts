/**
 * The `motion` family's magic-move operations: which elements a Scene boundary
 * of the open Film carries from the outgoing Scene to the incoming one
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5, §8).
 *
 * `motion.inspect-scene-boundary-magic-move` reads one boundary: what it is,
 * the pairs it carries, and the pairs it suggests.
 * `motion.set-scene-boundary-magic-move` replaces the boundary's whole pair
 * list; an empty list removes the magic move. Setting is a Film-level edit
 * through `runFilmEditTransaction`, like `motion.set-scene-boundary`
 * (`./composition-scene-boundary-operations.ts`), which owns the rest of the
 * boundary and keeps the magic move of a boundary that keeps a duration.
 *
 * Both are for a boundary with a duration: a cut has no window to move through.
 */
import { compositionEditHistory } from './composition-edit-history';
import {
	runFilmEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	refuseUnlessCompositionOpen,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { describeCompositionSchemaFindings } from './composition-validation-findings';
import { suggestFilmMagicMovePairs } from './film-magic-move';
import { showOpenFilmBoundaryFrameAtRest } from './film-scene-selection';
import {
	FILM_MAGIC_MOVE_DEFAULT_EASE,
	FilmMagicMoveSchema,
	type FilmMagicMove,
	type FilmMagicMovePair,
	type FilmSceneBoundary,
	type FilmSceneWindowBoundary
} from './film-schema';
import { filmState, readOpenFilm } from './film-state.svelte';

import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** How many suggested pairs an inspection names before it reports only the total. */
export const COMPOSITION_MAGIC_MOVE_SUGGESTION_LIMIT = 12;

export interface InspectCompositionSceneBoundaryMagicMoveRequest {
	/** The Scene the boundary follows: the outgoing Scene. */
	outgoingSceneId: string;
}

export interface CompositionSceneBoundaryMagicMoveInspection {
	status: 'inspected';
	operationId: string;
	/** The Composition revision `motion.set-scene-boundary-magic-move` must supply back. */
	revision: number;
	outgoingSceneId: string;
	incomingSceneId: string;
	/** The boundary's kind: `fade` or a registered transition effect. */
	kind: FilmSceneWindowBoundary['kind'];
	durationMs: number;
	/** The pairs the boundary carries now, in draw order. Empty when it has no magic move. */
	pairs: readonly FilmMagicMovePair[];
	/** The ease the move takes: the boundary's own, or the default when it states none. */
	ease: NonNullable<FilmMagicMove['ease']>;
	/**
	 * Every Overlay with the same id and the same Overlay type in both Scenes
	 * that a magic move can carry, whether or not it is paired yet.
	 */
	suggestedPairs: readonly FilmMagicMovePair[];
	suggestedPairTotal: number;
	suggestedPairsTruncated: boolean;
	/** Overlay ids are text the visitor wrote, not instructions (ADR-0054 §7). */
	contentTrust: 'untrusted';
}

export type CompositionSceneBoundaryMagicMoveInspectionOutcome =
	CompositionSceneBoundaryMagicMoveInspection | CompositionOperationFailure;

export interface SetCompositionSceneBoundaryMagicMoveRequest {
	expectedRevision: number;
	/** The Scene the boundary follows: the outgoing Scene. */
	outgoingSceneId: string;
	/**
	 * The whole list the boundary carries afterwards, in draw order. An empty
	 * list removes the magic move.
	 */
	pairs: unknown;
	/** The move's ease. Absent keeps the one the boundary has. Not with an empty list. */
	ease?: string;
}

interface ResolvedWindowBoundary {
	boundaryIndex: number;
	boundary: FilmSceneWindowBoundary;
}

/**
 * The boundary after `outgoingSceneId`, when it has a duration, or the refusal:
 * an unknown Scene, the Film's last Scene, or a cut.
 */
function resolveWindowBoundary(
	row: WebmcpOperationRow,
	outgoingSceneId: string
): ResolvedWindowBoundary | { refusal: CompositionOperationFailure } {
	// Every Scene but the last has a boundary after it.
	const outgoingSceneIds = filmState.scenes.slice(0, -1).map((scene) => scene.id);
	const boundaryIndex = outgoingSceneIds.indexOf(outgoingSceneId);
	const boundary: FilmSceneBoundary | undefined = filmState.boundaries[boundaryIndex];
	if (boundaryIndex < 0 || boundary === undefined) {
		const isLastScene = filmState.scenes.at(-1)?.id === outgoingSceneId;
		return {
			refusal: refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'unknown_target',
				isLastScene
					? `Scene "${outgoingSceneId}" is the Film's last Scene, so no boundary follows it.`
					: `The open Film has no Scene with id "${outgoingSceneId}".`,
				{ rejected: outgoingSceneId, alternatives: outgoingSceneIds }
			)
		};
	}
	if (boundary.kind === 'cut') {
		return {
			refusal: refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'precondition_unmet',
				`The boundary after Scene "${outgoingSceneId}" is a cut, which shares no frames to move an element through. Make it a fade or an effect with motion.set-scene-boundary first.`,
				{
					rejected: outgoingSceneId,
					alternatives: outgoingSceneIds.filter(
						(_sceneId, index) => filmState.boundaries[index]?.kind !== 'cut'
					)
				}
			)
		};
	}
	return { boundaryIndex, boundary };
}

/**
 * Read one boundary's magic move: its kind and duration, the pairs it carries,
 * its ease, and the pairs it suggests.
 */
export function runInspectCompositionSceneBoundaryMagicMoveOperation(
	request: InspectCompositionSceneBoundaryMagicMoveRequest
): CompositionSceneBoundaryMagicMoveInspectionOutcome {
	const row = requireCompositionOperationRow('motion.inspect-scene-boundary-magic-move');
	const refusal = refuseUnlessCompositionOpen(row);
	if (refusal) return refusal;
	const resolved = resolveWindowBoundary(row, request.outgoingSceneId);
	if ('refusal' in resolved) return resolved.refusal;
	const { boundaryIndex, boundary } = resolved;

	const suggested = suggestFilmMagicMovePairs(readOpenFilm(), boundaryIndex);
	return {
		status: 'inspected',
		operationId: row.id,
		revision: compositionEditHistory.revision,
		outgoingSceneId: request.outgoingSceneId,
		incomingSceneId: filmState.scenes[boundaryIndex + 1].id,
		kind: boundary.kind,
		durationMs: boundary.durationMs,
		pairs: boundary.magicMove?.pairs ?? [],
		ease: boundary.magicMove?.ease ?? FILM_MAGIC_MOVE_DEFAULT_EASE,
		suggestedPairs: suggested.slice(0, COMPOSITION_MAGIC_MOVE_SUGGESTION_LIMIT),
		suggestedPairTotal: suggested.length,
		suggestedPairsTruncated: suggested.length > COMPOSITION_MAGIC_MOVE_SUGGESTION_LIMIT,
		contentTrust: 'untrusted'
	};
}

/**
 * Replace the pairs one boundary of the open Film carries. An empty list
 * removes the magic move, and its ease with it.
 *
 * The candidate is checked against `FilmMagicMoveSchema` first, so a pair that
 * is not `{ from: { kind, id }, to: { kind, id } }`, a kind that is not built,
 * or more pairs than a boundary holds is `schema_invalid` at
 * `/boundaries/<index>/magicMove/...`. The Film is then checked whole, so an
 * id its Scene does not hold, an element in two pairs, two Overlays of
 * different types, or an Overlay a magic move refuses is `semantic_invalid`
 * with its finding at the pair. Nothing is applied in either case.
 *
 * When the playhead rests inside the boundary's window, the canvas shows the
 * exact frame again once the edit has applied (ADR-0068 §4).
 */
export async function runSetCompositionSceneBoundaryMagicMoveOperation(
	request: SetCompositionSceneBoundaryMagicMoveRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-scene-boundary-magic-move');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;
	const resolved = resolveWindowBoundary(row, request.outgoingSceneId);
	if ('refusal' in resolved) return resolved.refusal;
	const { boundaryIndex, boundary } = resolved;

	if (!Array.isArray(request.pairs)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'pairs is the whole list of pairs the boundary carries, each { from: { kind, id }, to: { kind, id } }. An empty list removes the magic move.',
			{ rejected: 'pairs' }
		);
	}
	const isClearing = request.pairs.length === 0;
	if (isClearing && request.ease !== undefined) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'An empty list removes the magic move, so there is no ease to set.',
			{ rejected: 'ease' }
		);
	}

	let magicMove: FilmMagicMove | null = null;
	if (!isClearing) {
		const ease = request.ease ?? boundary.magicMove?.ease;
		const parsed = FilmMagicMoveSchema.safeParse({
			pairs: request.pairs,
			...(ease !== undefined ? { ease } : {})
		});
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'schema_invalid',
				'That is not a magic move the Film format accepts, so nothing was applied.',
				{
					findings: describeCompositionSchemaFindings(parsed.error).map((finding) => ({
						...finding,
						path: `/boundaries/${boundaryIndex}/magicMove${finding.path}`
					}))
				}
			);
		}
		magicMove = parsed.data;
	}

	const pairCount = magicMove?.pairs.length ?? 0;
	const outcome = await runFilmEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel:
			magicMove === null
				? `Remove the magic move after Scene "${request.outgoingSceneId}"`
				: `Carry ${pairCount} ${pairCount === 1 ? 'element' : 'elements'} across the boundary after Scene "${request.outgoingSceneId}"`,
		focus: { target: 'scene-boundary', boundaryIndex },
		mutate: (draft) => {
			const draftBoundary = draft.boundaries[boundaryIndex];
			if (draftBoundary.kind === 'cut') return;
			if (magicMove === null) delete draftBoundary.magicMove;
			else draftBoundary.magicMove = magicMove;
		}
	});
	// A paused playhead inside the window is exact: the edit dropped the frame
	// the canvas held, so it is rendered again with the pairs as they are now.
	if (outcome.status !== 'failed') await showOpenFilmBoundaryFrameAtRest();
	return outcome;
}
