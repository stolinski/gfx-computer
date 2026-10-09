import { describe, expect, it } from 'vitest';

import { compositionEditHistory } from './composition-edit-history';
import { engineState, packState, transitionState } from './engine-state.svelte';
import {
	FILM_FIRST_SCENE_ID,
	filmFromCorpusPreset,
	filmToWireFormat,
	parseFilmIngress
} from './film-ingress';
import {
	filmState,
	readOpenFilm,
	readOpenFilmAsSavedPreset,
	readOpenFilmAsUserCompositionDocument,
	readOpenFilmDocumentSelectingScene
} from './film-state.svelte';
import { legacyPresetEnvelopeFromPreset } from './open-film-document';
import { posterKeyForPreset } from './posters';
import { applyFilm, applyPreset } from './preset';
import { presetBase } from './preset-base.svelte';
import { getPresetBySlug } from './preset-catalog';
import { presetToWireFormat, serializeCompositionState } from './preset-pure';
import { readStoredUserCompositionRecord } from './user-composition-record';
import { cloneJsonValue } from '../utils/json-clone';

import type { Preset } from './engine-schema';

/** One Preset of each kind the legacy envelope and the Film transport have to carry. */
const ROUND_TRIP_PRESETS = [
	{ label: 'a transparent Preset', slug: 'lower-third' },
	{ label: 'a backgroundFill Preset', slug: 'chapter-card-descent' },
	{ label: 'a kind: fixture Preset', slug: 'captions-pack-style-demo' },
	{ label: 'a legacy transition Preset', slug: 'transition-wipe-demo' }
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
	it('holds a transparent, a filled, a fixture, and a transition Preset', () => {
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
		expect(saved.transition).toEqual(preset.transition);
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
		// A Film carries neither legacy field; both travel beside it.
		expect(film).not.toHaveProperty('kind');
		expect(film).not.toHaveProperty('transition');
		expect(() => parseFilmIngress(cloneJsonValue(filmToWireFormat(film)))).not.toThrow();
	});

	it('resolves a legacy transition recipe for the Workspace, as a Preset load always did', () => {
		applyPreset(requireCataloguedPreset('transition-wipe-demo'));

		expect(transitionState.active?.effect).toBe(
			requireCataloguedPreset('transition-wipe-demo').transition?.effect
		);

		applyPreset(requireCataloguedPreset('lower-third'));

		expect(transitionState.active).toBeNull();
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
