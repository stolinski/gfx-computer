import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import twoSceneFadeFilmJson from '../../../scripts/fixtures/film-fade/two-scene-fade.film.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import { filmDocumentFromCorpusStarters } from './film-corpus-scenes.fixture';
import { filmFromPreset, filmToWireFormat, parseFilm, presetFromFilmScene } from './film-ingress';
import { posterKeyForPreset } from './posters';
import { getPresetBySlug } from './preset-catalog';
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
	userCompositionDocumentFromReading
} from './user-composition-record';
import { STORED_USER_COMPOSITION_RECORD_FIXTURES } from './user-composition-record.fixture';

import type { Preset } from './engine-schema';
import type { UserCompositionDocument } from './user-composition-record';

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
			assert.deepEqual(presetFromFilmScene(reading.film, reading.film.scenes[0].id), {
				...preset,
				kind: 'deliverable'
			});
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

	it('opens a legacy record with the one field a Film cannot carry in the envelope', () => {
		const fixturePreset = parsePresetIngress(blankPresetJson);
		assert.equal(fixturePreset.kind, 'fixture');

		const reading = readStoredUserCompositionRecord({ meta: META, preset: blankPresetJson });
		const opened = userCompositionDocumentFromReading(reading);

		assert.deepEqual(opened.legacyPresetEnvelope, { kind: 'fixture' });
		// The lifted Film is the same composition without `kind`.
		assert.deepEqual(presetFromFilmScene(opened.film, opened.film.scenes[0].id), {
			...fixturePreset,
			kind: 'deliverable'
		});
	});

	// ADR-0068 §3: a stored legacy transition record reads as a two-Scene Film.
	it('lifts a legacy transition record to a two-Scene Film of its two endpoints', () => {
		const transitionPreset = parsePresetIngress(transitionWipeDemoPresetJson);
		const transition = transitionPreset.transition;
		assert.ok(transition);

		const reading = readStoredUserCompositionRecord(
			{ meta: META, preset: transitionWipeDemoPresetJson },
			{ resolvePreset: getPresetBySlug }
		);
		const opened = userCompositionDocumentFromReading(reading);

		assert.equal(reading.recordShape, 'preset');
		assert.deepEqual(
			opened.film.scenes.map((scene) => scene.origin),
			[
				{ slug: transition.from, contentKey: null },
				{ slug: transition.to, contentKey: null }
			]
		);
		assert.deepEqual(
			opened.film.scenes.map((scene) => scene.state),
			[getPresetBySlug(transition.from)?.state, getPresetBySlug(transition.to)?.state]
		);
		assert.equal(opened.film.boundaries.length, 1);
		assert.equal(opened.film.boundaries[0].kind, transition.effect);
		assert.equal(opened.film.name, transitionPreset.name);
		assert.equal(opened.film.pack, transitionPreset.pack);
		assert.deepEqual(opened.legacyPresetEnvelope, { kind: transitionPreset.kind });
	});

	it('refuses a legacy transition record it cannot look the endpoints of up, or whose endpoint is gone', () => {
		const refusals: readonly (() => unknown)[] = [
			() => readStoredUserCompositionRecord({ meta: META, preset: transitionWipeDemoPresetJson }),
			() =>
				readStoredUserCompositionRecord(
					{
						meta: META,
						preset: {
							...transitionWipeDemoPresetJson,
							transition: { ...transitionWipeDemoPresetJson.transition, to: 'no-such-preset' }
						}
					},
					{ resolvePreset: getPresetBySlug }
				)
		];

		for (const read of refusals) {
			assert.throws(read, (cause) => isStoredUserCompositionRefusal(cause));
		}
	});

	it('refuses a legacy transition record whose transition is longer than an endpoint', () => {
		assert.throws(
			() =>
				readStoredUserCompositionRecord(
					{
						meta: META,
						preset: {
							...transitionWipeDemoPresetJson,
							transition: { ...transitionWipeDemoPresetJson.transition, durationMs: 60_000 }
						}
					},
					{ resolvePreset: getPresetBySlug }
				),
			(cause) =>
				isStoredUserCompositionRefusal(cause) && /boundaries\.0\.durationMs/.test(cause.message)
		);
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

describe('a stored Film with a fade', () => {
	it('is stored as a Film with its fade and read back the same', () => {
		const film = parseFilm(JSON.parse(JSON.stringify(twoSceneFadeFilmJson)));
		const document: UserCompositionDocument = {
			film,
			legacyPresetEnvelope: { kind: 'deliverable' }
		};

		const written = JSON.parse(
			JSON.stringify(storedUserCompositionRecordFromDocument(META, document))
		) as { film: { boundaries: unknown[] } };
		const readBack = readStoredUserCompositionRecord(written);

		assert.equal('preset' in written, false);
		assert.deepEqual(written.film.boundaries, [{ kind: 'fade', durationMs: 1000 }]);
		assert.deepEqual(readBack.film, film);
		assert.deepEqual(readBack.film.boundaries, [{ kind: 'fade', durationMs: 1000 }]);
	});

	it('is one second shorter than its Scenes together', () => {
		const film = parseFilm(JSON.parse(JSON.stringify(twoSceneFadeFilmJson)));

		// 6 s and 6.7 s at 30 fps, sharing a 30-frame window.
		assert.equal(filmDurationSeconds(film), 150 / 30 + 6.7);
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

describe('what a save writes', () => {
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

	it('writes a legacy transition record as a two-Scene Film record the first time it is saved (ADR-0068 §3)', () => {
		const opened = userCompositionDocumentFromReading(
			readStoredUserCompositionRecord(
				{ meta: META, preset: transitionWipeDemoPresetJson },
				{ resolvePreset: getPresetBySlug }
			)
		);

		const saved = JSON.parse(
			JSON.stringify(storedUserCompositionRecordFromDocument({ ...META, savedAt }, opened))
		) as { film: { scenes: unknown[]; boundaries: { kind: string }[] } };

		assert.deepEqual(Object.keys(saved), ['meta', 'film']);
		assert.equal(saved.film.scenes.length, 2);
		assert.deepEqual(
			saved.film.boundaries.map((boundary) => boundary.kind),
			[transitionWipeDemoPresetJson.transition.effect]
		);
		assert.equal(JSON.stringify(saved).includes('"transition"'), false);
		assert.deepEqual(standaloneUserCompositionDocument(opened), filmToWireFormat(opened.film));
		// The Film record needs no catalogue to read back, and is the same Film.
		const reopened = readStoredUserCompositionRecord(saved);
		assert.equal(reopened.recordShape, 'film');
		assert.deepEqual(reopened.film, opened.film);
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

// ADR-0061, ADR-0068 §3: a Film's card shows its first Scene, so its poster is
// keyed by that Scene as the Preset it would be alone.
describe('the poster key of a Film of several Scenes', () => {
	const STARTER_SLUGS = ['lower-third', 'captions-karaoke', 'gdp-bar-race'];

	function posterKeyOf(document: UserCompositionDocument): string {
		return posterKeyForPreset(storedPresetViewOfUserComposition(document));
	}

	it('is the same for the same Film, however many times it is read', () => {
		assert.equal(
			posterKeyOf(filmDocumentFromCorpusStarters(STARTER_SLUGS)),
			posterKeyOf(filmDocumentFromCorpusStarters(STARTER_SLUGS))
		);
	});

	it('does not change when a later Scene is edited, renamed, added, removed, or moved', () => {
		const film = filmDocumentFromCorpusStarters(STARTER_SLUGS);
		const key = posterKeyOf(film);

		const laterSceneEdited = structuredClone(film);
		laterSceneEdited.film.scenes[1].state.transport.durationSeconds += 1;
		laterSceneEdited.film.scenes[2].name = 'Renamed';
		assert.equal(posterKeyOf(laterSceneEdited), key);

		assert.equal(posterKeyOf(filmDocumentFromCorpusStarters(STARTER_SLUGS.slice(0, 1))), key);
		assert.equal(
			posterKeyOf(
				filmDocumentFromCorpusStarters([STARTER_SLUGS[0], STARTER_SLUGS[2], STARTER_SLUGS[1]])
			),
			key
		);
	});

	it('does not change when the first Scene is renamed', () => {
		const film = filmDocumentFromCorpusStarters(STARTER_SLUGS);
		const renamed = structuredClone(film);
		renamed.film.scenes[0].name = 'Opening';

		assert.equal(posterKeyOf(renamed), posterKeyOf(film));
	});

	it('changes when the first Scene is edited, or another Scene becomes the first', () => {
		const film = filmDocumentFromCorpusStarters(STARTER_SLUGS);
		const key = posterKeyOf(film);

		const firstSceneEdited = structuredClone(film);
		firstSceneEdited.film.scenes[0].state.transport.durationSeconds += 1;
		assert.notEqual(posterKeyOf(firstSceneEdited), key);

		assert.notEqual(
			posterKeyOf(
				filmDocumentFromCorpusStarters([STARTER_SLUGS[1], STARTER_SLUGS[0], STARTER_SLUGS[2]])
			),
			key
		);
	});

	// The key is the key of a whole Preset (`posterKeyForPreset`), so the fields a
	// Film states once for every Scene are part of it, as they are for a Preset.
	it('changes when the Film is renamed or takes another Pack', () => {
		const film = filmDocumentFromCorpusStarters(STARTER_SLUGS);
		const key = posterKeyOf(film);

		const renamed = structuredClone(film);
		renamed.film.name = 'Another name';
		assert.notEqual(posterKeyOf(renamed), key);

		const otherPack = structuredClone(film);
		otherPack.film.pack = `${film.film.pack}-other`;
		assert.notEqual(posterKeyOf(otherPack), key);
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
