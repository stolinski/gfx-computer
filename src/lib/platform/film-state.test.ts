import { describe, expect, it } from 'vite-plus/test';

import { compositionEditHistory } from './composition-edit-history';
import { engineState, packState } from './engine-state.svelte';
import {
	FILM_FIRST_SCENE_ID,
	filmFromCorpusPreset,
	filmToWireFormat,
	parseFilmIngress
} from './film-ingress';
import {
	filmState,
	isOpenFilmShowingPosterScene,
	readOpenFilm,
	readOpenFilmAsSavedPreset,
	readOpenFilmAsUserCompositionDocument,
	readOpenFilmDocumentSelectingScene
} from './film-state.svelte';
import { legacyPresetEnvelopeFromPreset } from './open-film-document';
import { posterKeyForPreset } from './posters';
import { applyFilm, applyOpenFilmDocument, applyPreset } from './preset';
import { presetBase } from './preset-base.svelte';
import { getPresetBySlug } from './preset-catalog';
import { presetToWireFormat, serializeCompositionState } from './preset-pure';
import {
	readStoredUserCompositionRecord,
	storedUserCompositionRecordFromDocument
} from './user-composition-record';
import { cloneJsonValue } from '../utils/json-clone';

import type { Preset } from './engine-schema';

/** One Preset of each kind the legacy envelope and the Film transport have to carry. */
const ROUND_TRIP_PRESETS = [
	{ label: 'a transparent Preset', slug: 'lower-third' },
	{ label: 'a backgroundFill Preset', slug: 'chapter-card-descent' },
	{ label: 'a kind: fixture Preset', slug: 'captions-pack-style-demo' }
] as const;

function requireCataloguedPreset(slug: string): Preset {
	const preset = getPresetBySlug(slug);
	if (!preset) throw new Error(`The corpus holds no Preset "${slug}".`);
	return preset;
}

/** The Preset every writer saved before the open document was a Film. */
function serializeLiveStateAsPreset(): Preset {
	return serializeCompositionState(presetBase, engineState, packState.slug);
}

function wireJson(preset: Preset): string {
	return JSON.stringify(presetToWireFormat(preset));
}

describe('the fixtures this file opens are the kinds it names', () => {
	it('holds a transparent, a filled, a fixture, and a legacy transition Preset', () => {
		const transparent = requireCataloguedPreset('lower-third');
		expect(transparent.state.backgroundFill).toBeUndefined();
		expect(transparent.kind).toBe('deliverable');
		expect(requireCataloguedPreset('chapter-card-descent').state.backgroundFill).toBeDefined();
		expect(requireCataloguedPreset('captions-pack-style-demo').kind).toBe('fixture');
		expect(requireCataloguedPreset('transition-wipe-demo').transition).toBeDefined();
	});
});

describe('opening a Preset as a one-Scene Film', () => {
	it.each(ROUND_TRIP_PRESETS)('saves $label exactly as before', ({ slug }) => {
		const preset = requireCataloguedPreset(slug);

		applyPreset(preset, { slug, contentKey: posterKeyForPreset(preset) });

		const saved = readOpenFilmAsSavedPreset();
		const savedBefore = serializeLiveStateAsPreset();
		expect(saved).toEqual(savedBefore);
		expect(wireJson(saved)).toBe(wireJson(savedBefore));
		// The serializer has always written `description` after `state`, so the
		// catalogue document is compared by content key, not by key order.
		expect(posterKeyForPreset(saved)).toBe(posterKeyForPreset(preset));
		expect(saved.kind).toBe(preset.kind);
	});

	it.each(ROUND_TRIP_PRESETS)('holds $label as a Film of one selected Scene', ({ slug }) => {
		const preset = requireCataloguedPreset(slug);
		const origin = { slug, contentKey: posterKeyForPreset(preset) };

		applyPreset(preset, origin);

		const film = readOpenFilm();
		expect(filmState.selectedSceneId).toBe(FILM_FIRST_SCENE_ID);
		expect(film.scenes.map((scene) => scene.id)).toEqual([FILM_FIRST_SCENE_ID]);
		expect(film.scenes[0].origin).toEqual(origin);
		expect(film.boundaries).toEqual([]);
		expect(film.name).toBe(preset.name);
		expect(film.pack).toBe(preset.pack);
		expect(film.orientation).toBe(preset.state.transport.orientation);
		expect(film.fps).toBe(preset.state.transport.fps);
		expect(film.format).toBe(preset.state.transport.format);
		// A Film carries no `kind`; it travels beside it.
		expect(film).not.toHaveProperty('kind');
		expect(film).not.toHaveProperty('transition');
		expect(() => parseFilmIngress(cloneJsonValue(filmToWireFormat(film)))).not.toThrow();
	});

	it('opens a legacy transition Preset as a two-Scene Film on its first Scene', () => {
		const transitionPreset = requireCataloguedPreset('transition-wipe-demo');
		const transition = transitionPreset.transition;
		if (!transition) throw new Error('transition-wipe-demo states no transition.');

		applyPreset(transitionPreset);

		const film = readOpenFilm();
		expect(film.name).toBe(transitionPreset.name);
		expect(film.scenes.map((scene) => scene.origin?.slug)).toEqual([
			transition.from,
			transition.to
		]);
		expect(film.boundaries).toHaveLength(1);
		expect(film.boundaries[0].kind).toBe(transition.effect);
		expect(filmState.selectedSceneId).toBe(film.scenes[0].id);
		// The first Scene is live: the `from` Preset's own Surface, not the
		// transition Preset's.
		expect(engineState.surface.type).toBe(
			requireCataloguedPreset(transition.from).state.surface.type
		);

		applyPreset(requireCataloguedPreset('lower-third'));

		expect(readOpenFilm().scenes).toHaveLength(1);
		expect(readOpenFilm().boundaries).toEqual([]);
	});

	it('restarts the Composition revision, because a revision belongs to one open Film', () => {
		applyPreset(requireCataloguedPreset('lower-third'));
		compositionEditHistory.recordApplied({ label: 'Edit', undo: () => {}, redo: () => {} });
		expect(compositionEditHistory.revision).toBe(1);

		applyPreset(requireCataloguedPreset('chapter-card-descent'));

		expect(compositionEditHistory.revision).toBe(0);
		expect(compositionEditHistory.canUndo).toBe(false);
	});
});

describe('opening a stored record as its Film', () => {
	it.each(ROUND_TRIP_PRESETS)('saves $label from a legacy record exactly as before', ({ slug }) => {
		const preset = requireCataloguedPreset(slug);
		const reading = readStoredUserCompositionRecord({
			meta: { forkedFrom: slug, savedAt: '2026-10-08T00:00:00.000Z' },
			preset: cloneJsonValue(presetToWireFormat(preset))
		});
		if (reading.recordShape !== 'preset') throw new Error('Expected a legacy record reading.');

		applyFilm(reading.film, legacyPresetEnvelopeFromPreset(reading.preset));

		expect(readOpenFilm().scenes[0].origin).toEqual({ slug, contentKey: null });
		const saved = readOpenFilmAsSavedPreset();
		expect(wireJson(saved)).toBe(wireJson(serializeLiveStateAsPreset()));
		expect(posterKeyForPreset(saved)).toBe(posterKeyForPreset(preset));
	});

	it('opens a stored legacy transition record as a two-Scene Film, and saves it as a Film', () => {
		const transitionPreset = requireCataloguedPreset('transition-wipe-demo');
		const transition = transitionPreset.transition;
		if (!transition) throw new Error('transition-wipe-demo states no transition.');
		const meta = { forkedFrom: null, savedAt: '2026-10-08T00:00:00.000Z' };
		const reading = readStoredUserCompositionRecord(
			{ meta, preset: cloneJsonValue(presetToWireFormat(transitionPreset)) },
			{ resolvePreset: getPresetBySlug }
		);
		if (reading.recordShape !== 'preset') throw new Error('Expected a legacy record reading.');

		applyFilm(reading.film, legacyPresetEnvelopeFromPreset(reading.preset));

		expect(readOpenFilm().scenes.map((scene) => scene.origin)).toEqual([
			{ slug: transition.from, contentKey: null },
			{ slug: transition.to, contentKey: null }
		]);
		expect(readOpenFilm().boundaries.map((boundary) => boundary.kind)).toEqual([transition.effect]);
		// The next save writes the Film, not the legacy Preset.
		const saved = JSON.parse(
			JSON.stringify(
				storedUserCompositionRecordFromDocument(meta, readOpenFilmAsUserCompositionDocument())
			)
		) as Record<string, unknown>;
		expect(Object.keys(saved)).toEqual(['meta', 'film']);
		const reopened = readStoredUserCompositionRecord(saved);
		expect(reopened.recordShape).toBe('film');
		expect(reopened.film).toEqual(reading.film);
	});

	it('holds each Scene name through selection, and leaves an unnamed Scene unnamed', () => {
		const preset = requireCataloguedPreset('lower-third');
		const film = filmFromCorpusPreset(preset, {
			slug: 'lower-third',
			contentKey: posterKeyForPreset(preset)
		});
		const [namedScene] = film.scenes;

		applyFilm(
			{
				...film,
				scenes: [namedScene, { id: 'scene-2', origin: null, state: cloneJsonValue(preset.state) }],
				boundaries: [{ kind: 'cut' }]
			},
			{ kind: 'deliverable' }
		);

		expect(readOpenFilm().scenes.map((scene) => scene.name)).toEqual([preset.name, undefined]);
		expect(readOpenFilm().scenes[1]).not.toHaveProperty('name');

		const selectingSecond = readOpenFilmDocumentSelectingScene('scene-2');
		expect(selectingSecond.film.scenes.map((scene) => scene.name)).toEqual([
			preset.name,
			undefined
		]);
		expect(readOpenFilmAsUserCompositionDocument().film.scenes[0].name).toBe(preset.name);
	});

	it('gives a lifted legacy record no Scene name, so reading one never rewrites it', () => {
		const preset = requireCataloguedPreset('lower-third');
		const reading = readStoredUserCompositionRecord({
			meta: { forkedFrom: 'lower-third', savedAt: '2026-10-08T00:00:00.000Z' },
			preset: cloneJsonValue(presetToWireFormat(preset))
		});

		expect(reading.film.scenes[0]).not.toHaveProperty('name');
	});

	it('opens a stored Film record as the deliverable its one Scene is', () => {
		const preset = requireCataloguedPreset('lower-third');
		applyPreset(preset, { slug: 'lower-third', contentKey: posterKeyForPreset(preset) });
		const reading = readStoredUserCompositionRecord({
			meta: { forkedFrom: 'lower-third', savedAt: '2026-10-08T00:00:00.000Z' },
			film: cloneJsonValue(filmToWireFormat(readOpenFilm()))
		});

		applyFilm(reading.film, { kind: 'deliverable' });

		expect(readOpenFilm().scenes[0].origin).toEqual({
			slug: 'lower-third',
			contentKey: posterKeyForPreset(preset)
		});
		expect(posterKeyForPreset(readOpenFilmAsSavedPreset())).toBe(posterKeyForPreset(preset));
	});
});

// ADR-0061: a Film's poster is its first Scene, keyed by that Scene. The
// Workspace photographs the canvas only while this is true.
describe('whether the open Film shows the Scene its poster is', () => {
	function openTwoSceneFilm(): void {
		const preset = requireCataloguedPreset('lower-third');
		const film = filmFromCorpusPreset(preset, {
			slug: 'lower-third',
			contentKey: posterKeyForPreset(preset)
		});
		applyFilm(
			{
				...film,
				scenes: [
					film.scenes[0],
					{
						id: 'scene-2',
						origin: null,
						state: cloneJsonValue(requireCataloguedPreset('chapter-card-descent').state)
					}
				],
				boundaries: [{ kind: 'cut' }]
			},
			{ kind: 'deliverable' }
		);
	}

	it('is true for a one-Scene Film and for a Film open on its first Scene', () => {
		applyPreset(requireCataloguedPreset('lower-third'));
		expect(isOpenFilmShowingPosterScene()).toBe(true);

		openTwoSceneFilm();
		expect(isOpenFilmShowingPosterScene()).toBe(true);
	});

	it('is false while another Scene is open, and true again on the first', () => {
		openTwoSceneFilm();

		applyOpenFilmDocument(readOpenFilmDocumentSelectingScene('scene-2'));
		expect(filmState.selectedSceneId).toBe('scene-2');
		expect(isOpenFilmShowingPosterScene()).toBe(false);

		applyOpenFilmDocument(readOpenFilmDocumentSelectingScene(FILM_FIRST_SCENE_ID));
		expect(isOpenFilmShowingPosterScene()).toBe(true);
	});

	it('is false while a Scene swap has engine state in transit', () => {
		openTwoSceneFilm();

		filmState.isSwappingScene = true;
		expect(isOpenFilmShowingPosterScene()).toBe(false);
		filmState.isSwappingScene = false;

		expect(isOpenFilmShowingPosterScene()).toBe(true);
	});
});
