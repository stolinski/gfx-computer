/**
 * The open document as one detached value: the Film, which of its Scenes is
 * open for editing, and the two Preset fields a Film does not carry yet
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §1, §3, §8).
 *
 * The edit transaction core captures, applies, and keeps in undo history values
 * of this shape, so one Composition revision and one history cover the whole
 * Film. Every function here is pure and treats a document as immutable: it
 * returns a new document and may share unchanged Scenes with the one it was
 * given. The reactive side — what is live in engine state and what is held
 * beside it — is `./film-state.svelte.ts`.
 */
import { FILM_SCHEMA_ID, type Film } from './film-schema';
import { presetFromSingleSceneFilm, sceneStateForPlayback } from './film-ingress';
import { serializeCompositionState } from './preset-pure';
import { cloneJsonValue } from '../utils/json-clone';
import { hashObject } from '../utils/object';

import type { CompositionTransition, Preset } from './engine-schema';

/**
 * The two fields of the Preset envelope that `filmFromPreset` drops and that
 * the Workspace still needs (ADR-0068 §3). They travel beside the Film, never
 * inside it, so `gfx-film@1` does not grow a field it does not own.
 */
export interface LegacyPresetEnvelope {
	/**
	 * The catalogue classification (`deliverable` or `fixture`). A stored Film
	 * has no `kind` and opens as a `deliverable`. The field stays because the
	 * open document is also how a corpus Preset is shown: the Workspace topbar
	 * chip and the RootInspector read it from `presetBase`, `composition.inspect`
	 * reports it, `composition.set-identity` writes `/kind`, and the Preset-shaped
	 * Scene view every operation drafts (`selectedScenePresetOfOpenFilm`) is a
	 * `Preset`, which requires one. It is saved only inside the legacy record
	 * shape `userCompositionWriteShape` keeps for a transition.
	 */
	kind: Preset['kind'];
	/**
	 * The top-level two-endpoint transition recipe (ADR-0026) that
	 * `transitionState` renders. ADR-0068 §3: a Film cannot hold it until the
	 * live Scene boundaries change reads a transition Preset as a two-Scene Film
	 * with one boundary, and this field retires with that change. Until then a
	 * document that carries one is stored in the legacy record shape.
	 */
	transition?: CompositionTransition;
}

/** The open document: one Film, its selected Scene, and the legacy Preset envelope. */
export interface OpenFilmDocument {
	film: Film;
	/** The Scene whose state is live in engine state. Always a Scene of `film`. */
	selectedSceneId: string;
	legacyPresetEnvelope: LegacyPresetEnvelope;
}

function cloneCompositionTransition(transition: CompositionTransition): CompositionTransition {
	return { ...transition, params: cloneJsonValue(transition.params) };
}

/** The legacy envelope a Preset carries, detached from the Preset. */
export function legacyPresetEnvelopeFromPreset(preset: Preset): LegacyPresetEnvelope {
	const envelope: LegacyPresetEnvelope = { kind: preset.kind };
	if (preset.transition !== undefined) {
		envelope.transition = cloneCompositionTransition(preset.transition);
	}
	return envelope;
}

/**
 * The document a Film opens as: its first Scene selected. Throws a
 * `RangeError` for a Film with no Scene, which `FilmSchema` never produces.
 */
export function openFilmDocumentFromFilm(
	film: Film,
	legacyPresetEnvelope: LegacyPresetEnvelope
): OpenFilmDocument {
	const [firstScene] = film.scenes;
	if (firstScene === undefined) {
		throw new RangeError(`The Film "${film.name}" has no Scene to open.`);
	}
	return { film, selectedSceneId: firstScene.id, legacyPresetEnvelope };
}

/**
 * The selected Scene as the Preset-shaped document every Scene-scoped operation
 * drafts (ADR-0068 §8): the Film's name, description, and Pack around the
 * Scene's state under the Film's transport, plus the legacy envelope. Its
 * `/state/...` pointers are the Scene's own, which is why existing operations
 * and their receipts did not change when the open document became a Film.
 *
 * The state is shared with the document, not copied; a caller that mutates
 * parses a draft from it first.
 */
export function selectedScenePresetOfOpenFilm(document: OpenFilmDocument): Preset {
	return serializeCompositionState(
		{
			name: document.film.name,
			description: document.film.description,
			kind: document.legacyPresetEnvelope.kind,
			transition: document.legacyPresetEnvelope.transition
		},
		sceneStateForPlayback(document.film, document.selectedSceneId),
		document.film.pack
	);
}

/**
 * `document` with its selected Scene replaced by `scenePreset`, the inverse of
 * `selectedScenePresetOfOpenFilm`.
 *
 * A Film has one name, one description, one Pack, and one transport
 * (ADR-0068 §1), so those fields of the Scene's Preset-shaped view are the
 * Film's own: a Scene-scoped edit to `name`, `description`, `pack`, or
 * `state.transport.orientation` / `fps` / `format` is written through to the
 * Film. `kind` and `transition` are written through to the legacy envelope.
 * Every other Scene and every boundary is carried unchanged.
 */
export function openFilmWithSelectedScenePreset(
	document: OpenFilmDocument,
	scenePreset: Preset
): OpenFilmDocument {
	const film: Film = {
		schema: FILM_SCHEMA_ID,
		name: scenePreset.name,
		...(scenePreset.description !== undefined ? { description: scenePreset.description } : {}),
		pack: scenePreset.pack,
		orientation: scenePreset.state.transport.orientation,
		fps: scenePreset.state.transport.fps,
		format: scenePreset.state.transport.format,
		scenes: document.film.scenes.map((scene) =>
			scene.id === document.selectedSceneId ? { ...scene, state: scenePreset.state } : scene
		),
		boundaries: document.film.boundaries
	};
	return {
		film,
		selectedSceneId: document.selectedSceneId,
		legacyPresetEnvelope: legacyPresetEnvelopeFromPreset(scenePreset)
	};
}

/**
 * The open Film as the one Preset it is, with the legacy envelope's live `kind`
 * and transition put back, in the key order `serializeCompositionState` has
 * always written. `composition.inspect` and the Interchange verification pass
 * read this. What is stored and exported is the Film
 * (`./user-composition-record.ts`).
 *
 * Throws `FilmSceneCountUnsupportedError` for a Film that is not one Scene
 * long, which is all the Workspace plays.
 */
export function savedPresetFromOpenFilm(document: OpenFilmDocument): Preset {
	const scenePreset = presetFromSingleSceneFilm(document.film);
	return serializeCompositionState(
		{
			name: scenePreset.name,
			description: scenePreset.description,
			kind: document.legacyPresetEnvelope.kind,
			transition: document.legacyPresetEnvelope.transition
		},
		scenePreset.state,
		scenePreset.pack
	);
}

/**
 * Whether everything that differs between two documents lies inside the
 * selected Scene's Preset-shaped view: the same Scene is selected, the Film
 * holds the same Scenes in the same order, and no other Scene and no boundary
 * moved. A change that passes is reported in the Scene's own pointers with its
 * `sceneId`; any other change is reported in Film pointers.
 */
export function isSelectedSceneScopedFilmChange(
	previous: OpenFilmDocument,
	next: OpenFilmDocument
): boolean {
	if (previous.selectedSceneId !== next.selectedSceneId) return false;
	if (previous.film.scenes.length !== next.film.scenes.length) return false;
	if (
		previous.film.boundaries !== next.film.boundaries &&
		hashObject(previous.film.boundaries) !== hashObject(next.film.boundaries)
	) {
		return false;
	}
	return previous.film.scenes.every((previousScene, sceneIndex) => {
		const nextScene = next.film.scenes[sceneIndex];
		if (nextScene === undefined || nextScene.id !== previousScene.id) return false;
		if (hashObject(previousScene.origin) !== hashObject(nextScene.origin)) return false;
		if (previousScene.id === previous.selectedSceneId) return true;
		return (
			previousScene.state === nextScene.state ||
			hashObject(previousScene.state) === hashObject(nextScene.state)
		);
	});
}
