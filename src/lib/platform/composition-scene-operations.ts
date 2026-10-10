/**
 * The `composition` family's Scene operations: which Scenes the open Film
 * holds, in what order, and which one is open for editing
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §8).
 *
 * Adding, removing, and reordering are Film-level edits. Each runs through
 * `runFilmEditTransaction`: one Composition revision, one shared undo entry,
 * and a receipt in Film pointers (`/scenes`, `/boundaries`). The boundary
 * bookkeeping is `./film-scene-membership.ts`.
 *
 * Selecting a Scene is not an edit. It goes through `selectOpenFilmScene`,
 * which advances the Composition revision and records no undo entry, so its
 * row is a `view` like a playhead seek and it returns its own receipt.
 *
 * Adding the open Starter to a stored Film replaces the open document, so it
 * is a lifecycle operation and lives in `./composition-lifecycle-operations.ts`.
 */
import { compositionEditHistory } from './composition-edit-history';
import {
	runFilmEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	findStarterTemplate,
	listStarterTemplateSlugs,
	refuseUnloadableFilmRenderers,
	userCompositionDocumentFromPreset
} from './composition-lifecycle-operations';
import { compositionMeta } from './composition-meta.svelte';
import { packState } from './engine-state.svelte';
import {
	readOpenCompositionSlug,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { filmSceneFrameCount } from './film-playhead';
import {
	insertFilmScene,
	mintFilmSceneId,
	moveFilmScene,
	removeFilmScene
} from './film-scene-membership';
import { selectOpenFilmScene, showOpenFilmBoundaryFrameAtRest } from './film-scene-selection';
import { filmState, readOpenFilm } from './film-state.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { cloneJsonValue } from '../utils/json-clone';

import type { WebmcpOperationFocusTarget, WebmcpOperationRow } from './webmcp-operation-inventory';

export interface AddCompositionSceneFromStarterRequest {
	expectedRevision: number;
	starterSlug: string;
	/** Where the Scene goes, from 0 (first). Absent adds it last. */
	sceneIndex?: number;
}

export interface RemoveCompositionSceneRequest {
	expectedRevision: number;
	sceneId: string;
}

export interface ReorderCompositionSceneRequest {
	expectedRevision: number;
	sceneId: string;
	/** The index the Scene has once it has moved, from 0 (first). */
	toSceneIndex: number;
}

export interface SelectCompositionSceneRequest {
	sceneId: string;
	/**
	 * The frame of the Scene to park its playhead on, from 0. Absent is frame 0
	 * for a Scene that was not open, and leaves the playhead where it is for the
	 * Scene that already is.
	 */
	sceneFrame?: number;
}

/** What selecting a Scene returns: which Scene is now open and where its playhead sits. */
export interface CompositionSceneSelectionReceipt {
	status: 'selected';
	operationId: string;
	/** The Composition revision now. It advanced by one when another Scene became the open one. */
	revision: number;
	sceneId: string;
	/** Where the Scene sits in the Film, from 0. */
	sceneIndex: number;
	sceneFrame: number;
	sceneFrameCount: number;
	focus: WebmcpOperationFocusTarget;
}

export type CompositionSceneSelectionOutcome =
	CompositionSceneSelectionReceipt | CompositionOperationFailure;

/**
 * The refusal for a Scene edit on an unsaved Starter. Its page never saves
 * (ADR-0068 §3), and the Scene strip is not shown there, so the Film it would
 * grow into does not exist yet.
 */
function refuseUnlessStoredFilmOpen(row: WebmcpOperationRow): CompositionOperationFailure | null {
	if (compositionMeta.isUserComposition) return null;
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		'The open composition is an unsaved Starter, not a Film. Store it as a new Film, or add it to a Film this session holds, before adding Scenes.',
		{ rejected: readOpenCompositionSlug() ?? '' }
	);
}

function refuseUnknownScene(row: WebmcpOperationRow, sceneId: string): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`The open Film has no Scene with id "${sceneId}".`,
		{ rejected: sceneId, alternatives: filmState.scenes.map((scene) => scene.id) }
	);
}

/**
 * Add a Scene to the open Film as an owned copy of a Starter template, with a
 * `cut` beside it. The Scene takes the Starter's name, records the Starter as
 * its origin, and plays under the Film's Pack and transport. The Scene that is
 * open stays open.
 */
export async function runAddCompositionSceneFromStarterOperation(
	request: AddCompositionSceneFromStarterRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('composition.add-scene-from-starter');
	const refusal = refuseUnlessCompositionEditable(row) ?? refuseUnlessStoredFilmOpen(row);
	if (refusal) return refusal;

	const starter = findStarterTemplate(request.starterSlug);
	if (!starter) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`"${request.starterSlug}" is not a Starter template this engine ships.`,
			{ rejected: request.starterSlug, alternatives: listStarterTemplateSlugs() }
		);
	}

	const sceneCount = filmState.scenes.length;
	const sceneIndex = request.sceneIndex ?? sceneCount;
	if (!Number.isSafeInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > sceneCount) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`This Film holds ${sceneCount} Scene${sceneCount === 1 ? '' : 's'}, so a Scene is added at index 0 through ${sceneCount}.`,
			{ rejected: String(request.sceneIndex), alternatives: ['0', String(sceneCount)] }
		);
	}

	// The Starter's renderers are readied before anything commits, so selecting
	// the new Scene never waits on a module load (ADR-0068 §4).
	// They are read under the Film's Pack, which is the Pack the Scene will wear.
	const starterDocument = userCompositionDocumentFromPreset(starter, request.starterSlug);
	const rendererRefusal = await refuseUnloadableFilmRenderers(row, {
		...starterDocument,
		film: { ...starterDocument.film, pack: packState.slug }
	});
	if (rendererRefusal) return rendererRefusal;
	const [starterScene] = starterDocument.film.scenes;

	return runFilmEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Add Scene "${starter.name}"`,
		focus: { target: 'composition-root' },
		mutate: (draft) => {
			insertFilmScene(
				draft,
				{
					id: mintFilmSceneId(draft),
					name: starter.name,
					origin: starterScene.origin,
					state: cloneJsonValue(starterScene.state)
				},
				sceneIndex
			);
		}
	});
}

/**
 * Remove one Scene from the open Film, with the boundary on its leading side.
 * A Film's only Scene cannot be removed. Removing the Scene that is open opens
 * its neighbour: the Scene after it, or the one before it when it was last.
 */
export async function runRemoveCompositionSceneOperation(
	request: RemoveCompositionSceneRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('composition.remove-scene');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const sceneIndex = filmState.scenes.findIndex((scene) => scene.id === request.sceneId);
	if (sceneIndex < 0) return refuseUnknownScene(row, request.sceneId);
	if (filmState.scenes.length === 1) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Scene "${request.sceneId}" is the Film's only Scene, and a Film has at least one.`,
			{ rejected: request.sceneId }
		);
	}

	return runFilmEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Remove Scene "${request.sceneId}"`,
		focus: { target: 'composition-root' },
		mutate: (draft, context) => {
			const removedSceneIndex = removeFilmScene(draft, request.sceneId);
			if (context.selectedSceneId === request.sceneId) {
				context.selectedSceneId =
					draft.scenes[Math.min(removedSceneIndex, draft.scenes.length - 1)].id;
			}
		}
	});
}

/**
 * Move one Scene of the open Film to another place in its order. Boundaries
 * keep their kinds by position. Moving a Scene to where it already is applies
 * nothing and records nothing.
 */
export async function runReorderCompositionSceneOperation(
	request: ReorderCompositionSceneRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('composition.reorder-scene');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	if (!filmState.scenes.some((scene) => scene.id === request.sceneId)) {
		return refuseUnknownScene(row, request.sceneId);
	}
	const lastSceneIndex = filmState.scenes.length - 1;
	if (
		!Number.isSafeInteger(request.toSceneIndex) ||
		request.toSceneIndex < 0 ||
		request.toSceneIndex > lastSceneIndex
	) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`This Film holds ${filmState.scenes.length} Scenes, so a Scene moves to index 0 through ${lastSceneIndex}.`,
			{ rejected: String(request.toSceneIndex), alternatives: ['0', String(lastSceneIndex)] }
		);
	}

	return runFilmEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Move Scene "${request.sceneId}"`,
		focus: { target: 'composition-root' },
		mutate: (draft) => moveFilmScene(draft, request.sceneId, request.toSceneIndex)
	});
}

/**
 * Open one Scene of the Film for editing, with its playhead on `sceneFrame`.
 * The Scene that was open is parked exactly as it stood. When `sceneFrame` is
 * stated and lands inside a boundary window, the canvas shows both Scenes
 * composited there. The Composition
 * revision advances by one when another Scene becomes the open one, and no undo
 * entry is recorded (`selectOpenFilmScene`), which is why this takes no
 * observed revision: it discards nothing, and the receipt hands back the
 * revision the caller's next edit needs.
 */
export async function runSelectCompositionSceneOperation(
	request: SelectCompositionSceneRequest
): Promise<CompositionSceneSelectionOutcome> {
	const row = requireCompositionOperationRow('composition.select-scene');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const film = readOpenFilm();
	const sceneIndex = film.scenes.findIndex((scene) => scene.id === request.sceneId);
	if (sceneIndex < 0) return refuseUnknownScene(row, request.sceneId);

	const rate = resolveFrameRate(film.fps);
	const sceneFrameCount = filmSceneFrameCount(film.scenes[sceneIndex], rate);
	const isSelectedScene = filmState.selectedSceneId === request.sceneId;
	const sceneFrame =
		request.sceneFrame ??
		(isSelectedScene
			? Math.min(secondsToFrames(timelineHandle.current?.time ?? 0, rate), sceneFrameCount - 1)
			: 0);
	if (!Number.isSafeInteger(sceneFrame) || sceneFrame < 0 || sceneFrame >= sceneFrameCount) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`Scene "${request.sceneId}" runs ${sceneFrameCount} frames, so its playhead parks on frame 0 through ${sceneFrameCount - 1}.`,
			{ rejected: String(request.sceneFrame), alternatives: ['0', String(sceneFrameCount - 1)] }
		);
	}

	if (!isSelectedScene || request.sceneFrame !== undefined) {
		await selectOpenFilmScene(request.sceneId, sceneFrame);
	}
	// A playhead parked on a stated frame inside a boundary window is shown the
	// exact frame of the Film there, as a Film-time seek is (ADR-0068 §4). A
	// Scene opened without a frame shows the Scene alone.
	if (request.sceneFrame !== undefined) await showOpenFilmBoundaryFrameAtRest();

	return {
		status: 'selected',
		operationId: row.id,
		revision: compositionEditHistory.revision,
		sceneId: request.sceneId,
		sceneIndex,
		sceneFrame,
		sceneFrameCount,
		focus: 'timeline-playhead'
	};
}
