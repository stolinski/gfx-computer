import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import {
	filmFromPreset,
	filmToWireFormat,
	presetFromFilmScene,
	presetFromSingleSceneFilm
} from './film-ingress';
import { posterKeyForPreset } from './posters';
import { parsePresetIngress, readCompositionLegacyUpgrades } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import {
	filmDurationSeconds,
	isStoredUserCompositionRecordError,
	isStoredUserCompositionRefusal,
	readStoredUserCompositionMeta,
	readStoredUserCompositionRecord,
	readUserCompositionDocumentWireBody,
	standaloneUserCompositionDocument,
	storedPresetViewOfUserComposition,
	storedScenePresetViewsOfUserComposition,
	storedUserCompositionRecordFromDocument,
	userCompositionDocumentFromReading,
	userCompositionWriteShape
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

		if (fixture.outcome === 'opens-several-scenes') {
			it(`reads the ${fixture.slug} record as a Film of several Scenes and opens it whole`, () => {
				const firstScenePreset: Preset = {
					...parsePresetIngress(fixture.presetDocument),
					kind: 'deliverable'
				};

				const reading = readStoredUserCompositionRecord(record);

				assert.equal(reading.recordShape, 'film');
				assert.ok(reading.film.scenes.length > 1);
				assert.equal(reading.film.boundaries.length, reading.film.scenes.length - 1);
				assert.deepEqual(reading.film.scenes[0].origin, fixture.firstSceneOrigin);
				const document = userCompositionDocumentFromReading(reading);
				assert.equal(document.film, reading.film);
				assert.deepEqual(document.legacyPresetEnvelope, { kind: 'deliverable' });
				// The card stands for the Scene the Film opens on.
				assert.deepEqual(storedPresetViewOfUserComposition(document), firstScenePreset);
				assert.deepEqual(
					storedScenePresetViewsOfUserComposition(document),
					reading.film.scenes.map((scene) => presetFromFilmScene(reading.film, scene.id))
				);
			});

			it(`stores the ${fixture.slug} Film with every Scene and reads the same Film back`, () => {
				const reading = readStoredUserCompositionRecord(record);
				const document = userCompositionDocumentFromReading(reading);

				const written = JSON.parse(
					JSON.stringify(storedUserCompositionRecordFromDocument(fixture.meta, document))
				) as { film: { scenes: unknown[] } };
				const readBack = readStoredUserCompositionRecord(written);

				assert.equal('preset' in written, false);
				assert.equal(written.film.scenes.length, reading.film.scenes.length);
				assert.deepEqual(readBack.film, reading.film);
				assert.deepEqual(readBack.meta, fixture.meta);
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
			const document = userCompositionDocumentFromReading(reading);
			assert.deepEqual(document.film, reading.film);
			assert.deepEqual(document.legacyPresetEnvelope, { kind: preset.kind });
			assert.deepEqual(storedPresetViewOfUserComposition(document), preset);
		});
	}

	it('holds a fixture that still declares the Legacy Supers schema id', () => {
		const fixture = STORED_USER_COMPOSITION_RECORD_FIXTURES.find(
			(candidate) => candidate.slug === 'legacy-supers-schema'
		);
		assert.ok(fixture && 'preset' in fixture.document);

		assert.deepEqual(readCompositionLegacyUpgrades(fixture.document.preset), ['legacy-schema-id']);
	});

	it('opens a legacy record with the two fields a Film cannot carry in the envelope', () => {
		const fixturePreset = parsePresetIngress(blankPresetJson);
		const transitionPreset = parsePresetIngress(transitionWipeDemoPresetJson);
		assert.equal(fixturePreset.kind, 'fixture');
		assert.notEqual(transitionPreset.transition, undefined);

		for (const [document, preset] of [
			[blankPresetJson, fixturePreset],
			[transitionWipeDemoPresetJson, transitionPreset]
		] as const) {
			const reading = readStoredUserCompositionRecord({ meta: META, preset: document });
			const opened = userCompositionDocumentFromReading(reading);

			assert.equal(opened.legacyPresetEnvelope.kind, preset.kind);
			assert.deepEqual(opened.legacyPresetEnvelope.transition, preset.transition);
			// The lifted Film is the same composition without `kind` and `transition`.
			const liftedPreset: Preset = { ...preset, kind: 'deliverable' };
			delete liftedPreset.transition;
			assert.deepEqual(presetFromSingleSceneFilm(opened.film), liftedPreset);
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
			{ meta: { forkedFrom: 7, savedAt: META.savedAt }, preset: blankPresetJson },
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
		// A Film record states each Scene's origin itself, so it writes no `forkedFrom`.
		assert.deepEqual(readStoredUserCompositionMeta({ meta: { savedAt: meta.savedAt } }), {
			savedAt: meta.savedAt
		});
		assert.equal(readStoredUserCompositionMeta([]), null);
	});
});

describe('userCompositionWriteShape', () => {
	const savedAt = '2026-10-02T08:00:00.000Z';

	it('writes a legacy Preset record as a Film record the first time it is saved', () => {
		const legacyMeta = { forkedFrom: 'lower-third', savedAt: META.savedAt };
		const legacyPreset = parsePresetIngress({ ...blankPresetJson, kind: 'deliverable' });
		const opened = userCompositionDocumentFromReading(
			readStoredUserCompositionRecord({
				meta: legacyMeta,
				preset: presetToWireFormat(legacyPreset)
			})
		);

		const saved = storedUserCompositionRecordFromDocument({ ...legacyMeta, savedAt }, opened);

		assert.deepEqual(Object.keys(saved), ['meta', 'film']);
		assert.deepEqual(saved, {
			meta: { forkedFrom: 'lower-third', savedAt },
			film: filmToWireFormat(
				filmFromPreset(legacyPreset, { slug: 'lower-third', contentKey: null })
			)
		});
		// The Film record reads back as the same document, with its real origin.
		const reopened = userCompositionDocumentFromReading(readStoredUserCompositionRecord(saved));
		assert.deepEqual(reopened.film, opened.film);
		assert.deepEqual(reopened.film.scenes[0].origin, { slug: 'lower-third', contentKey: null });
	});

	it('keeps the legacy Preset shape while the envelope carries a transition (ADR-0068 §3)', () => {
		const transitionPreset = parsePresetIngress(transitionWipeDemoPresetJson);
		const opened = userCompositionDocumentFromReading(
			readStoredUserCompositionRecord({ meta: META, preset: transitionWipeDemoPresetJson })
		);

		assert.equal(userCompositionWriteShape(opened).recordShape, 'preset');
		const saved = storedUserCompositionRecordFromDocument({ ...META, savedAt }, opened);

		assert.deepEqual(Object.keys(saved), ['meta', 'preset']);
		assert.ok('preset' in saved);
		assert.deepEqual(parsePresetIngress(saved.preset), transitionPreset);
		assert.deepEqual(standaloneUserCompositionDocument(opened), saved.preset);

		// Removing the transition is what lets the next save write a Film.
		const withoutTransition = {
			film: opened.film,
			legacyPresetEnvelope: { kind: opened.legacyPresetEnvelope.kind }
		};
		assert.equal(userCompositionWriteShape(withoutTransition).recordShape, 'film');
		assert.deepEqual(
			standaloneUserCompositionDocument(withoutTransition),
			filmToWireFormat(opened.film)
		);
	});

	it('does not save `kind` for a Film, and keeps the poster key of a deliverable Preset', () => {
		const deliverable = parsePresetIngress({ ...blankPresetJson, kind: 'deliverable' });
		const fixture = parsePresetIngress(blankPresetJson);
		const fromDeliverable = userCompositionDocumentFromReading(
			readStoredUserCompositionRecord({ meta: META, preset: presetToWireFormat(deliverable) })
		);
		const fromFixture = userCompositionDocumentFromReading(
			readStoredUserCompositionRecord({ meta: META, preset: presetToWireFormat(fixture) })
		);

		assert.equal(
			posterKeyForPreset(storedPresetViewOfUserComposition(fromDeliverable)),
			posterKeyForPreset(deliverable)
		);
		assert.equal(fromFixture.legacyPresetEnvelope.kind, 'fixture');
		assert.equal(storedPresetViewOfUserComposition(fromFixture).kind, 'deliverable');
		assert.equal(
			JSON.stringify(storedUserCompositionRecordFromDocument(META, fromFixture)).includes(
				'"kind":"fixture"'
			),
			false
		);
	});

	it('reads a write request body of either shape, and refuses any other', () => {
		const preset = parsePresetIngress({ ...blankPresetJson, kind: 'deliverable' });
		const film = filmFromPreset(preset, { slug: 'blank', contentKey: 'abc' });

		const fromFilm = readUserCompositionDocumentWireBody({ film: filmToWireFormat(film) });
		assert.deepEqual(fromFilm, { film, legacyPresetEnvelope: { kind: 'deliverable' } });
		const fromPreset = readUserCompositionDocumentWireBody({ preset: presetToWireFormat(preset) });
		assert.deepEqual(fromPreset.film, filmFromPreset(preset, null));

		for (const body of [null, {}, presetToWireFormat(preset), { film: 1 }]) {
			assert.throws(
				() => readUserCompositionDocumentWireBody(body),
				(cause) => isStoredUserCompositionRecordError(cause) && cause.code === 'not_a_stored_record'
			);
		}
	});
});

describe('filmDurationSeconds', () => {
	it('counts a Film in frames at its exact rate rather than summing seconds', () => {
		const preset = parsePresetIngress(blankPresetJson);
		const film = filmFromPreset(preset, null);

		assert.equal(filmDurationSeconds(film), preset.state.transport.durationSeconds);
		const ntscFrames = Math.round((preset.state.transport.durationSeconds * 30000) / 1001);
		assert.equal(filmDurationSeconds({ ...film, fps: 29.97 }), (ntscFrames * 1001) / 30000);
	});
});
