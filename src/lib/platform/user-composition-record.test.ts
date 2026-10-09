import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import {
	filmFromPreset,
	isFilmSceneCountUnsupportedError,
	presetFromSingleSceneFilm
} from './film-ingress';
import { parsePresetIngress, readCompositionLegacyUpgrades } from './preset-ingress';
import {
	isStoredUserCompositionRecordError,
	isStoredUserCompositionRefusal,
	presetForStoredUserComposition,
	readStoredUserCompositionMeta,
	readStoredUserCompositionRecord
} from './user-composition-record';
import { STORED_USER_COMPOSITION_RECORD_FIXTURES } from './user-composition-record.fixture';

import type { Preset } from './engine-schema';

const META = { forkedFrom: null, savedAt: '2026-10-01T12:00:00.000Z' };

describe('readStoredUserCompositionRecord', () => {
	for (const fixture of STORED_USER_COMPOSITION_RECORD_FIXTURES) {
		const record = { meta: fixture.meta, ...fixture.document };

		if (fixture.outcome === 'composition-refused') {
			it(`refuses the ${fixture.slug} record, naming what is wrong with it`, () => {
				assert.throws(
					() => readStoredUserCompositionRecord(record),
					(cause) => {
						assert.ok(isStoredUserCompositionRecordError(cause));
						assert.equal(cause.code, 'composition_refused');
						assert.match(cause.message, /Invalid GFX film/);
						assert.equal(isStoredUserCompositionRefusal(cause), true);
						return true;
					}
				);
			});
			continue;
		}

		if (fixture.outcome === 'scene-count-refused') {
			it(`reads the ${fixture.slug} record as a Film and refuses to open it as one Preset`, () => {
				const reading = readStoredUserCompositionRecord(record);

				assert.equal(reading.recordShape, 'film');
				assert.equal(reading.film.scenes.length, 2);
				assert.deepEqual(reading.film.scenes[0].origin, fixture.firstSceneOrigin);
				assert.throws(
					() => presetForStoredUserComposition(reading),
					(cause) => {
						assert.ok(isFilmSceneCountUnsupportedError(cause));
						assert.equal(cause.sceneCount, 2);
						assert.match(cause.message, /this build opens one-Scene Films/);
						assert.equal(isStoredUserCompositionRefusal(cause), true);
						return true;
					}
				);
			});
			continue;
		}

		it(`lifts the ${fixture.slug} record to its one-Scene Film and back to its Preset`, () => {
			const preset = parsePresetIngress(fixture.presetDocument);

			const reading = readStoredUserCompositionRecord(record);

			assert.equal(reading.recordShape, 'film' in fixture.document ? 'film' : 'preset');
			assert.deepEqual(reading.meta, fixture.meta);
			assert.deepEqual(reading.film, filmFromPreset(preset, fixture.firstSceneOrigin));
			assert.deepEqual(presetFromSingleSceneFilm(reading.film), preset);
			assert.deepEqual(presetForStoredUserComposition(reading), preset);
		});
	}

	it('holds a fixture that still declares the Legacy Supers schema id', () => {
		const fixture = STORED_USER_COMPOSITION_RECORD_FIXTURES.find(
			(candidate) => candidate.slug === 'legacy-supers-schema'
		);
		assert.ok(fixture && 'preset' in fixture.document);

		assert.deepEqual(readCompositionLegacyUpgrades(fixture.document.preset), ['legacy-schema-id']);
	});

	it('opens a legacy record as the Preset it stored, with the fields a Film cannot carry', () => {
		const fixturePreset = parsePresetIngress(blankPresetJson);
		const transitionPreset = parsePresetIngress(transitionWipeDemoPresetJson);
		assert.equal(fixturePreset.kind, 'fixture');
		assert.notEqual(transitionPreset.transition, undefined);

		for (const [document, preset] of [
			[blankPresetJson, fixturePreset],
			[transitionWipeDemoPresetJson, transitionPreset]
		] as const) {
			const reading = readStoredUserCompositionRecord({ meta: META, preset: document });

			assert.deepEqual(presetForStoredUserComposition(reading), preset);
			// The lifted Film is the same composition without `kind` and `transition`.
			const liftedPreset: Preset = { ...preset, kind: 'deliverable' };
			delete liftedPreset.transition;
			assert.deepEqual(presetFromSingleSceneFilm(reading.film), liftedPreset);
		}
	});

	it('checks either shape under the semantic options its store passes', () => {
		const oneSceneFilm = STORED_USER_COMPOSITION_RECORD_FIXTURES.find(
			(fixture) => fixture.slug === 'film-one-scene'
		);
		assert.ok(oneSceneFilm && 'film' in oneSceneFilm.document);
		// A Pack the registry does not hold: a finding by default, and accepted in
		// the disk store, whose documents may name a User Pack (ADR-0055).
		const records = [
			{ meta: META, preset: { ...blankPresetJson, pack: 'a-user-pack' } },
			{ meta: META, film: { ...(oneSceneFilm.document.film as object), pack: 'a-user-pack' } }
		];

		for (const record of records) {
			assert.throws(
				() => readStoredUserCompositionRecord(record),
				(cause) => isStoredUserCompositionRecordError(cause) && cause.code === 'composition_refused'
			);
			assert.equal(
				readStoredUserCompositionRecord(record, { packScope: 'stored' }).film.pack,
				'a-user-pack'
			);
		}
	});

	it('refuses a value that is not a stored record at all', () => {
		const notRecords: readonly unknown[] = [
			null,
			'text',
			{ preset: blankPresetJson },
			{ meta: { forkedFrom: null, savedAt: 42 }, preset: blankPresetJson },
			{ meta: META },
			{ meta: META, preset: blankPresetJson, film: { schema: 'gfx-film@1' } }
		];

		for (const value of notRecords) {
			assert.throws(
				() => readStoredUserCompositionRecord(value),
				(cause) => {
					assert.ok(isStoredUserCompositionRecordError(cause));
					assert.equal(cause.code, 'not_a_stored_record');
					assert.equal(isStoredUserCompositionRefusal(cause), false);
					return true;
				}
			);
		}
	});
});

describe('readStoredUserCompositionMeta', () => {
	it('reads the metadata of either shape without parsing the composition', () => {
		const meta = { forkedFrom: 'blank', savedAt: '2026-10-01T12:00:00.000Z' };

		assert.deepEqual(readStoredUserCompositionMeta({ meta, preset: { no: 1 } }), meta);
		assert.deepEqual(readStoredUserCompositionMeta({ meta, film: { no: 1 } }), meta);
		assert.equal(readStoredUserCompositionMeta({ meta: { forkedFrom: 7, savedAt: '' } }), null);
		assert.equal(readStoredUserCompositionMeta([]), null);
	});
});
