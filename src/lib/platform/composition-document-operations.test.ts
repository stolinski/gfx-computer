import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import {
	COMPOSITION_INSPECTION_BOUNDARY_CHARACTER_ALLOWANCE,
	COMPOSITION_INSPECTION_SCENE_LIMIT,
	runExportCompositionJsonOperation,
	runInspectCompositionOperation,
	runSetCompositionIdentityOperation,
	type CompositionInspectionOutcome,
	type CompositionInspectionReceipt,
	type CompositionJsonExportOutcome,
	type CompositionJsonExportReceipt
} from './composition-document-operations';
import { engineState } from './engine-state.svelte';
import { filmState } from './film-state.svelte';
import { filmFromPreset, parseFilmIngress } from './film-ingress';
import { insertFilmScene } from './film-scene-membership';
import { FilmSceneBoundarySchema } from './film-schema';
import { resolveLegacyTransitionEndpointFromCatalog } from './legacy-transition-endpoint-catalog';
import { applyFilm, applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { presetBase } from './preset-base.svelte';
import { WEBMCP_RESULT_CHARACTER_BUDGET } from './webmcp-operation-inventory';

import type { CompositionOperationFailure } from './composition-operation-preflight';
import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { Film, FilmSceneBoundary } from './film-schema';

function expectInspected(outcome: CompositionInspectionOutcome): CompositionInspectionReceipt {
	if (outcome.status !== 'inspected') {
		throw new Error(`Expected an inspection but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectExported(outcome: CompositionJsonExportOutcome): CompositionJsonExportReceipt {
	if (outcome.status !== 'exported') {
		throw new Error(`Expected an export but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome;
}

function expectFailed(
	outcome: CompositionInspectionOutcome | CompositionJsonExportOutcome | CompositionOperationOutcome
): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the operation succeeded.');
	}
	return outcome;
}

beforeEach(() => {
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	compositionMeta.persistenceError = null;
});

describe('composition inspection', () => {
	it('reports the revision, identity, transport, Pack, and output class', () => {
		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.revision).toBe(0);
		expect(receipt.slug).toBe('untitled');
		expect(receipt.name).toBe('Blank');
		expect(receipt.pack).toBe('syntax');
		expect(receipt.transport).toEqual({
			orientation: 'horizontal',
			durationSeconds: 6,
			fps: 30,
			format: 'webm'
		});
		expect(receipt.outputClass).toBe('transparent-overlay');
		expect(receipt.backgroundFill).toBeNull();
	});

	it('names the Layer tree as ids, kinds, and order rather than the document body', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Inspected' });
		engineState.overlays.push({
			type: 'lower-third',
			id: 'headline',
			content: { title: 'Headline' },
			position: { anchor: 'bottom-left', offset: { x: 0.06, y: 0.08 } }
		});

		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.name).toBe('Inspected');
		expect(receipt.layers.entries).toEqual([
			{ kind: 'surface', id: 'surface', type: 'plain' },
			{ kind: 'overlay', id: 'headline', type: 'lower-third' }
		]);
		expect(receipt.layers.total).toBe(2);
		expect(receipt.layers.truncated).toBe(false);
		expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(WEBMCP_RESULT_CHARACTER_BUDGET);
	});

	it('classifies a declared background fill as a full-frame piece', () => {
		engineState.backgroundFill = '#101014';

		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.outputClass).toBe('full-frame');
		expect(receipt.backgroundFill).toBe('#101014');
	});

	it('lists each boundary by the Scene it follows, with its kind, duration, and params', () => {
		const film = filmFromPreset(parsePresetIngress(transitionWipeDemoPresetJson), null, {
			resolveLegacyTransitionEndpoint: resolveLegacyTransitionEndpointFromCatalog
		});
		insertFilmScene(film, { ...film.scenes[0], id: 'scene-3' }, 2);
		insertFilmScene(film, { ...film.scenes[0], id: 'scene-4' }, 3);
		film.boundaries[1] = { kind: 'fade', durationMs: 500 };
		applyFilm(film, { kind: 'deliverable' });

		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.boundaries).toEqual({
			entries: [
				{ outgoingSceneId: 'scene-1', ...film.boundaries[0] },
				{ outgoingSceneId: 'scene-2', kind: 'fade', durationMs: 500 },
				{ outgoingSceneId: 'scene-3', kind: 'cut' }
			],
			total: 3,
			truncated: false
		});
		expect(receipt.boundaries.entries[0].kind).toBe('mask-wipe');
		expect(receipt.boundaries.entries[0].params).toHaveProperty('direction');
	});

	it('reports no boundary for a one-Scene Film', () => {
		const receipt = expectInspected(runInspectCompositionOperation());

		expect(receipt.boundaries).toEqual({ entries: [], total: 0, truncated: false });
	});

	it('names the boundaries that fit its character allowance and stays inside the receipt budget', () => {
		function filmOfSceneLimit(): Film {
			const film = filmFromPreset(parsePresetIngress(transitionWipeDemoPresetJson), null, {
				resolveLegacyTransitionEndpoint: resolveLegacyTransitionEndpointFromCatalog
			});
			for (
				let sceneNumber = 3;
				sceneNumber <= COMPOSITION_INSPECTION_SCENE_LIMIT;
				sceneNumber += 1
			) {
				insertFilmScene(
					film,
					{ ...film.scenes[0], id: `scene-${sceneNumber}` },
					film.scenes.length
				);
			}
			return film;
		}
		// The widest boundary the registry holds, on every junction of a Film that
		// also fills the Scene list.
		const widestBoundary = FilmSceneBoundarySchema.parse({
			kind: 'seeded-shatter',
			durationMs: 1234.5,
			params: { seed: 1337, columns: 14, scatter: 0.13, rotation: 0.55, depth: 0.6, shadow: 0.35 }
		});
		const effectFilm = filmOfSceneLimit();
		effectFilm.boundaries = effectFilm.boundaries.map(() => widestBoundary);
		applyFilm(effectFilm, { kind: 'deliverable' });

		const effects = expectInspected(runInspectCompositionOperation());

		expect(effects.boundaries.total).toBe(COMPOSITION_INSPECTION_SCENE_LIMIT - 1);
		expect(effects.boundaries.truncated).toBe(true);
		expect(effects.boundaries.entries.length).toBeGreaterThanOrEqual(4);
		// In Film order from the first, none skipped.
		expect(effects.boundaries.entries.map((entry) => entry.outgoingSceneId)).toEqual(
			effectFilm.scenes.slice(0, effects.boundaries.entries.length).map((scene) => scene.id)
		);
		expect(JSON.stringify(effects.boundaries.entries).length).toBeLessThanOrEqual(
			COMPOSITION_INSPECTION_BOUNDARY_CHARACTER_ALLOWANCE + effects.boundaries.entries.length + 1
		);
		expect(JSON.stringify(effects).length).toBeLessThanOrEqual(WEBMCP_RESULT_CHARACTER_BUDGET);

		// Cuts are short, so many more of them are named.
		const cutFilm = filmOfSceneLimit();
		cutFilm.boundaries = cutFilm.boundaries.map((): FilmSceneBoundary => ({ kind: 'cut' }));
		applyFilm(cutFilm, { kind: 'deliverable' });

		const cuts = expectInspected(runInspectCompositionOperation());

		expect(cuts.boundaries.entries.length).toBeGreaterThanOrEqual(16);
		expect(JSON.stringify(cuts).length).toBeLessThanOrEqual(WEBMCP_RESULT_CHARACTER_BUDGET);
	});

	it('refuses to inspect when no composition is open', () => {
		compositionMeta.userCompositionSlug = null;

		const failure = expectFailed(runInspectCompositionOperation());

		expect(failure.code).toBe('no_composition_open');
	});
});

describe('composition JSON export', () => {
	it('returns one standalone document that parses back through the ingress boundary', () => {
		const receipt = expectExported(runExportCompositionJsonOperation());

		expect(receipt.characterCount).toBe(receipt.json.length);
		// The standalone document is the Film (ADR-0068 §3), and it reads back.
		const film = parseFilmIngress(JSON.parse(receipt.json));
		expect(film.schema).toBe('gfx-film@1');
		expect(film.name).toBe('Blank');
		expect(film.scenes).toHaveLength(1);
		expect(film.scenes[0].state).toEqual(parsePresetIngress(blankPresetJson).state);
	});

	it('exports a legacy transition Preset as the two-Scene Film it opened as', () => {
		applyPreset(parsePresetIngress(transitionWipeDemoPresetJson));
		compositionMeta.userCompositionSlug = 'my-transition';

		const receipt = expectExported(runExportCompositionJsonOperation());

		// ADR-0068 §3: the transition is a boundary between two Scenes.
		const film = parseFilmIngress(JSON.parse(receipt.json));
		expect(film.scenes.map((scene) => scene.origin?.slug)).toEqual([
			transitionWipeDemoPresetJson.transition.from,
			transitionWipeDemoPresetJson.transition.to
		]);
		expect(film.boundaries.map((boundary) => boundary.kind)).toEqual([
			transitionWipeDemoPresetJson.transition.effect
		]);
	});

	it('refuses to export when no composition is open', () => {
		compositionMeta.userCompositionSlug = null;

		expect(expectFailed(runExportCompositionJsonOperation()).code).toBe('no_composition_open');
	});
});

describe('composition identity', () => {
	it('sets the name, description, and kind as one edit', async () => {
		const outcome = await runSetCompositionIdentityOperation({
			expectedRevision: 0,
			name: 'Renamed',
			description: 'A described composition',
			kind: 'deliverable'
		});

		expect(outcome.status).toBe('applied');
		expect(presetBase.name).toBe('Renamed');
		expect(presetBase.description).toBe('A described composition');
		expect(presetBase.kind).toBe('deliverable');
		expect(compositionEditHistory.revision).toBe(1);
		expect(compositionEditHistory.undoLabel).toBe('Set composition identity');
	});

	it('clears the optional description rather than storing an empty string', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, description: 'Temporary' });
		await runSetCompositionIdentityOperation({ expectedRevision: 1, description: '' });

		expect(presetBase.description).toBeUndefined();
	});

	it('refuses an identity edit that names nothing to change', async () => {
		const failure = expectFailed(await runSetCompositionIdentityOperation({ expectedRevision: 0 }));

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['name', 'description', 'kind']);
	});

	it('refuses a blank name and a kind the catalog does not classify', async () => {
		const blankName = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: '   ' })
		);
		expect(blankName.code).toBe('invalid_argument');
		expect(blankName.rejected).toBe('   ');

		const unknownKind = expectFailed(
			await runSetCompositionIdentityOperation({
				expectedRevision: 0,
				kind: 'draft' as 'deliverable'
			})
		);
		expect(unknownKind.code).toBe('unsupported_variant');
		expect(unknownKind.alternatives).toEqual(['deliverable', 'fixture']);
		expect(presetBase.name).toBe('Blank');
	});

	it('refuses a stale revision and applies nothing', async () => {
		await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'First' });

		const failure = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Second' })
		);

		expect(failure.code).toBe('stale_revision');
		expect(failure.movedSince).toEqual(['Set composition identity']);
		expect(presetBase.name).toBe('First');
	});

	it('refuses to edit while a Scene swap has engine state in transit', async () => {
		filmState.isSwappingScene = true;

		const failure = expectFailed(
			await runSetCompositionIdentityOperation({ expectedRevision: 0, name: 'Renamed' })
		);
		filmState.isSwappingScene = false;

		expect(failure.code).toBe('precondition_unmet');
		expect(presetBase.name).toBe('Blank');
	});
});
