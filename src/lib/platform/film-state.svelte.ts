/**
 * The open Film
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §8).
 *
 * The open document is a Film. Its selected Scene is the one that is live:
 * `engineState` holds that Scene's state, `packState` the Film's Pack, and
 * `presetBase` the Film's name and description. Those modules did not change
 * when the open document became a Film, so nothing that reads them changed
 * either. This module holds the rest of the Film — which Scenes it has, where
 * each came from, the state of every Scene that is not selected, and the
 * boundaries — and which Scene is selected.
 *
 * The open Film is always `filmState` plus the live state written into the
 * selected Scene; `readOpenFilm` is that sum. A Film holds exactly one Scene
 * today, and nothing in the Workspace shows Scenes yet.
 *
 * The legacy Preset envelope (`LegacyPresetEnvelope`: `kind` and `transition`)
 * is live in `presetBase`, where the RootInspector edits it, and travels beside
 * the Film in every `OpenFilmDocument`. `./open-film-document.ts` says what
 * still needs each field.
 */
import { engineState, packState } from './engine-state.svelte';
import { FILM_FIRST_SCENE_ID } from './film-ingress';
import { FILM_SCHEMA_ID } from './film-schema';
import {
	legacyPresetEnvelopeFromPreset,
	savedPresetFromOpenFilm,
	type LegacyPresetEnvelope,
	type OpenFilmDocument
} from './open-film-document';
import { presetBase } from './preset-base.svelte';
import { cloneJsonValue } from '../utils/json-clone';

import type { EngineState, Preset } from './engine-schema';
import type { Film, FilmSceneBoundary, FilmSceneOrigin } from './film-schema';
import type { UserCompositionDocument } from './user-composition-record';

/** One Scene of the open Film as this module holds it. */
export interface OpenFilmScene {
	id: string;
	origin: FilmSceneOrigin | null;
	/**
	 * The Scene's state while it is not selected. `null` for the selected Scene,
	 * whose state is live in `engineState` and nowhere else.
	 */
	parkedState: EngineState | null;
}

/**
 * Raw, not deeply reactive: a parked Scene state is a complete engine state
 * that is only ever replaced whole, so proxying it would cost a proxy tree per
 * Scene and buy nothing.
 */
class OpenFilmState {
	/** The Scene that is live in engine state. Always the id of one entry of `scenes`. */
	selectedSceneId = $state<string>(FILM_FIRST_SCENE_ID);
	scenes = $state.raw<readonly OpenFilmScene[]>([
		{ id: FILM_FIRST_SCENE_ID, origin: null, parkedState: null }
	]);
	boundaries = $state.raw<readonly FilmSceneBoundary[]>([]);
}

export const filmState = new OpenFilmState();

/** The legacy Preset envelope as it stands in `presetBase`, detached. */
export function readOpenFilmLegacyPresetEnvelope(): LegacyPresetEnvelope {
	const envelope: LegacyPresetEnvelope = { kind: presetBase.kind };
	if (presetBase.transition !== undefined) {
		envelope.transition = {
			...presetBase.transition,
			params: cloneJsonValue(presetBase.transition.params)
		};
	}
	return envelope;
}

function requireParkedSceneState(scene: OpenFilmScene): EngineState {
	if (scene.parkedState === null) {
		throw new Error(
			`The open Film holds no state for Scene "${scene.id}", which is not the selected Scene "${filmState.selectedSceneId}".`
		);
	}
	return scene.parkedState;
}

/**
 * The open Film, read live: `filmState` plus the live state written into the
 * selected Scene. The selected Scene's `state` is `engineState` itself, not a
 * copy, so this is a view for reading now. A caller that keeps the Film —
 * the edit transaction, a save — detaches it first.
 */
export function readOpenFilm(): Film {
	return {
		schema: FILM_SCHEMA_ID,
		name: presetBase.name,
		...(presetBase.description !== undefined ? { description: presetBase.description } : {}),
		pack: packState.slug,
		orientation: engineState.transport.orientation,
		fps: engineState.transport.fps,
		format: engineState.transport.format,
		scenes: filmState.scenes.map((scene) => ({
			id: scene.id,
			origin: scene.origin,
			state: scene.id === filmState.selectedSceneId ? engineState : requireParkedSceneState(scene)
		})),
		boundaries: [...filmState.boundaries]
	};
}

/**
 * The open Film as the one Preset it is, detached from live state
 * (`savedPresetFromOpenFilm`).
 */
export function readOpenFilmAsSavedPreset(): Preset {
	return savedPresetFromOpenFilm({
		film: readOpenFilm(),
		selectedSceneId: filmState.selectedSceneId,
		legacyPresetEnvelope: readOpenFilmLegacyPresetEnvelope()
	});
}

/**
 * The open Film as the document both stores accept, detached from live state:
 * the Film and the legacy Preset envelope. Autosave, the Film a first edit
 * creates, standalone JSON export, and the poster content key read the open
 * document here.
 */
export function readOpenFilmAsUserCompositionDocument(): UserCompositionDocument {
	return {
		film: cloneJsonValue(readOpenFilm()),
		legacyPresetEnvelope: readOpenFilmLegacyPresetEnvelope()
	};
}

/**
 * The open Film as a detached document, given the selected Scene already read
 * out of live state as a detached, parsed Preset. The edit transaction core
 * does that read, because it is the one that reports an unreadable Scene as a
 * finding; this puts the rest of the Film around it.
 */
export function openFilmDocumentAroundScenePreset(scenePreset: Preset): OpenFilmDocument {
	const film: Film = {
		schema: FILM_SCHEMA_ID,
		name: scenePreset.name,
		...(scenePreset.description !== undefined ? { description: scenePreset.description } : {}),
		pack: scenePreset.pack,
		orientation: scenePreset.state.transport.orientation,
		fps: scenePreset.state.transport.fps,
		format: scenePreset.state.transport.format,
		scenes: filmState.scenes.map((scene) => ({
			id: scene.id,
			origin: scene.origin === null ? null : { ...scene.origin },
			state:
				scene.id === filmState.selectedSceneId ? scenePreset.state : requireParkedSceneState(scene)
		})),
		boundaries: [...filmState.boundaries]
	};
	return {
		film,
		selectedSceneId: filmState.selectedSceneId,
		legacyPresetEnvelope: legacyPresetEnvelopeFromPreset(scenePreset)
	};
}

/**
 * Hold everything of `document` that is not live state: the Scene list with
 * each origin, the state of every Scene that is not selected, the boundaries,
 * and the selection. Writing the selected Scene into engine state is the
 * caller's half (`applyOpenFilmDocument` in `./preset.ts`), so the two are
 * never out of step for longer than that one call.
 *
 * Throws a `RangeError` when `document` selects a Scene its Film does not hold.
 */
export function holdOpenFilmDocument(document: OpenFilmDocument): void {
	if (!document.film.scenes.some((scene) => scene.id === document.selectedSceneId)) {
		throw new RangeError(
			`The Film "${document.film.name}" has no Scene with id "${document.selectedSceneId}" to select.`
		);
	}
	filmState.scenes = document.film.scenes.map((scene) => ({
		id: scene.id,
		origin: scene.origin === null ? null : { ...scene.origin },
		parkedState: scene.id === document.selectedSceneId ? null : scene.state
	}));
	filmState.boundaries = [...document.film.boundaries];
	filmState.selectedSceneId = document.selectedSceneId;
}
