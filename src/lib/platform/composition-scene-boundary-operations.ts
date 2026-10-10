/**
 * The `motion` family's Scene boundary operation: what happens between two
 * neighbouring Scenes of the open Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4, §8).
 *
 * A boundary is a cut, a fade, or a registered transition effect. Setting one
 * is a Film-level edit through `runFilmEditTransaction`: one Composition
 * revision, one shared undo entry, and a receipt in Film pointers
 * (`/boundaries/<index>/...`). The `composition` family adds and removes
 * boundaries with their Scenes (`./composition-scene-operations.ts`); this
 * family owns what each one is.
 */
import { compositionEditHistory } from './composition-edit-history';
import {
	runFilmEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { describeCompositionSchemaFindings } from './composition-validation-findings';
import { showOpenFilmBoundaryFrameAtRest } from './film-scene-selection';
import {
	FILM_SCENE_BOUNDARY_KINDS,
	FilmSceneBoundarySchema,
	isFilmTransitionEffectBoundary,
	type FilmSceneBoundary
} from './film-schema';
import { filmState } from './film-state.svelte';
import { pipelineRendererRuntime } from './pipelines/runtime-context.svelte';
import { isRecord } from '../utils/object';

import type { WebmcpOperationRow } from './webmcp-operation-inventory';

export interface SetCompositionSceneBoundaryRequest {
	expectedRevision: number;
	/** The Scene the boundary follows: the outgoing Scene. Any Scene but the Film's last. */
	outgoingSceneId: string;
	/** `cut`, `fade`, or the type of a registered transition effect. */
	kind: string;
	/**
	 * How long the boundary lasts. Not for a cut. Absent keeps the duration the
	 * boundary has; a cut has none to keep, so making one a fade or an effect
	 * needs it.
	 */
	durationMs?: number;
	/**
	 * The effect's parameters, for a transition effect only. Each one given is
	 * set. One left out keeps its value when the boundary already is this effect,
	 * and takes the effect's own default otherwise.
	 */
	params?: unknown;
}

function refuseBoundaryArgument(
	row: WebmcpOperationRow,
	message: string,
	rejected: string,
	alternatives: readonly string[] = []
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		message,
		{ rejected, alternatives }
	);
}

/**
 * The boundary a request asks for, as the candidate value the Film schema then
 * checks, or the refusal for a request that does not add up.
 */
function readRequestedSceneBoundary(
	row: WebmcpOperationRow,
	request: SetCompositionSceneBoundaryRequest,
	current: FilmSceneBoundary
): { candidate: Record<string, unknown> } | { refusal: CompositionOperationFailure } {
	const { kind } = request;
	if (!FILM_SCENE_BOUNDARY_KINDS.some((candidateKind) => candidateKind === kind)) {
		return {
			refusal: refuseBoundaryArgument(
				row,
				`"${kind}" is not a Scene boundary kind.`,
				kind,
				FILM_SCENE_BOUNDARY_KINDS
			)
		};
	}
	if (kind === 'cut') {
		if (request.durationMs !== undefined || request.params !== undefined) {
			return {
				refusal: refuseBoundaryArgument(
					row,
					'A cut shares no frames, so it takes no durationMs and no params.',
					request.durationMs !== undefined ? 'durationMs' : 'params'
				)
			};
		}
		return { candidate: { kind } };
	}

	const durationMs =
		request.durationMs ?? (current.kind === 'cut' ? undefined : current.durationMs);
	if (durationMs === undefined) {
		return {
			refusal: refuseBoundaryArgument(
				row,
				`This boundary is a cut, which has no duration to keep. State durationMs to make it a ${kind}.`,
				'durationMs'
			)
		};
	}
	// A boundary that keeps a duration keeps what it carries: the magic move is
	// set by `motion.set-scene-boundary-magic-move`, never here. A cut above has
	// no window, so making a boundary a cut drops it.
	const keptMagicMove =
		current.kind !== 'cut' && current.magicMove !== undefined
			? { magicMove: current.magicMove }
			: {};
	if (kind === 'fade') {
		if (request.params !== undefined) {
			return {
				refusal: refuseBoundaryArgument(row, 'A fade has no params to set.', 'params')
			};
		}
		return { candidate: { kind, durationMs, ...keptMagicMove } };
	}

	if (request.params !== undefined && !isRecord(request.params)) {
		return {
			refusal: refuseBoundaryArgument(
				row,
				`The params of a ${kind} are an object of that effect's parameters.`,
				'params'
			)
		};
	}
	const keptParams =
		isFilmTransitionEffectBoundary(current) && current.kind === kind ? current.params : {};
	return {
		candidate: {
			kind,
			durationMs,
			params: { ...keptParams, ...(request.params ?? {}) },
			...keptMagicMove
		}
	};
}

/**
 * Set the boundary after one Scene of the open Film: its kind, its duration,
 * and, for a transition effect, the effect's parameters.
 *
 * The Film is checked whole before anything applies, so a duration shorter
 * than one frame, longer than the shorter of the two Scenes, or meeting the
 * boundary on the other side of a Scene is refused as `semantic_invalid` with
 * its finding at `/boundaries/<index>/durationMs`, and a parameter the effect
 * does not accept as `schema_invalid` at `/boundaries/<index>/params/...`.
 *
 * A boundary that keeps a duration keeps its magic move (ADR-0068 §5); making
 * it a cut removes the magic move with the window.
 *
 * When the playhead rests inside the boundary's window, the canvas shows the
 * exact frame again once the edit has applied (ADR-0068 §4).
 */
export async function runSetCompositionSceneBoundaryOperation(
	request: SetCompositionSceneBoundaryRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('motion.set-scene-boundary');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	// Every Scene but the last has a boundary after it.
	const outgoingSceneIds = filmState.scenes.slice(0, -1).map((scene) => scene.id);
	const boundaryIndex = outgoingSceneIds.indexOf(request.outgoingSceneId);
	const current = filmState.boundaries[boundaryIndex];
	if (boundaryIndex < 0 || current === undefined) {
		const isLastScene = filmState.scenes.at(-1)?.id === request.outgoingSceneId;
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			isLastScene
				? `Scene "${request.outgoingSceneId}" is the Film's last Scene, so no boundary follows it.`
				: `The open Film has no Scene with id "${request.outgoingSceneId}".`,
			{ rejected: request.outgoingSceneId, alternatives: outgoingSceneIds }
		);
	}

	const requested = readRequestedSceneBoundary(row, request, current);
	if ('refusal' in requested) return requested.refusal;
	const parsed = FilmSceneBoundarySchema.safeParse(requested.candidate);
	if (!parsed.success) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'schema_invalid',
			`That is not a ${request.kind} boundary the Film format accepts, so nothing was applied.`,
			{
				findings: describeCompositionSchemaFindings(parsed.error).map((finding) => ({
					...finding,
					path: `/boundaries/${boundaryIndex}${finding.path}`
				}))
			}
		);
	}
	const boundary = parsed.data;

	// A transition effect composites its window with its own renderer, which is
	// loaded before the boundary can name it.
	if (isFilmTransitionEffectBoundary(boundary)) {
		try {
			await pipelineRendererRuntime.ensureTransition(boundary.kind);
		} catch (cause) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'render_failed',
				`This browser could not load the ${boundary.kind} effect: ${
					cause instanceof Error ? cause.message : 'its renderer module failed to load'
				}.`,
				{ rejected: boundary.kind }
			);
		}
	}

	const outcome = await runFilmEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Set the boundary after Scene "${request.outgoingSceneId}" to ${boundary.kind}`,
		focus: { target: 'scene-boundary', boundaryIndex },
		mutate: (draft) => {
			draft.boundaries[boundaryIndex] = boundary;
		}
	});
	// A paused playhead inside a window is exact: the edit dropped the frame the
	// canvas held, so both Scenes are rendered again under the boundary as it is
	// now. Nothing happens while the Film plays or outside a window.
	if (outcome.status !== 'failed') await showOpenFilmBoundaryFrameAtRest();
	return outcome;
}
