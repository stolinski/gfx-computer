import { beforeEach, describe, expect, it } from 'vitest';

import twoSceneCutFilmJson from '../../../scripts/fixtures/film-cut-frames/two-scene-cut.film.json';

import { engineState } from './engine-state.svelte';
import { parseFilm } from './film-ingress';
import {
	cutOpenFilmPlaybackToNextScene,
	openFilmSceneSettlerHandle,
	seekOpenFilmFrame,
	selectOpenFilmScene
} from './film-scene-selection';
import { filmState, readOpenFilmAsUserCompositionDocument } from './film-state.svelte';
import { applyFilm } from './preset';
import { presetBase } from './preset-base.svelte';
import { timelineHandle } from './timeline-handle.svelte';
import {
	UserCompositionAutosaveLedger,
	userCompositionStoredContentKey
} from './user-composition-autosave';
import {
	readStoredUserCompositionRecord,
	storedUserCompositionRecordFromDocument,
	userCompositionDocumentFromReading,
	type UserCompositionDocument
} from './user-composition-record';
import { STORED_USER_COMPOSITION_RECORD_FIXTURES } from './user-composition-record.fixture';
import { cloneJsonValue } from '../utils/json-clone';

/** A store's document for the fixture Film, as a load hands it back. */
function storedTwoSceneCutDocument(): UserCompositionDocument {
	return {
		film: parseFilm(cloneJsonValue(twoSceneCutFilmJson)),
		legacyPresetEnvelope: { kind: 'deliverable' }
	};
}

/** Open a stored document the way the preset route does, and record what the store holds. */
function openStoredDocument(document: UserCompositionDocument): UserCompositionAutosaveLedger {
	applyFilm(document.film, document.legacyPresetEnvelope);
	const ledger = new UserCompositionAutosaveLedger();
	ledger.recordStored(readOpenFilmAsUserCompositionDocument());
	return ledger;
}

beforeEach(() => {
	filmState.isSwappingScene = false;
	timelineHandle.current = null;
	openFilmSceneSettlerHandle.current = null;
});

describe('the stored content key', () => {
	it('is the same for the document a store hands back and the open document read back', () => {
		const stored = storedTwoSceneCutDocument();

		applyFilm(stored.film, stored.legacyPresetEnvelope);

		expect(userCompositionStoredContentKey(readOpenFilmAsUserCompositionDocument())).toBe(
			userCompositionStoredContentKey(storedTwoSceneCutDocument())
		);
	});

	it('does not depend on when the record was saved, only on what it holds', () => {
		const document = storedTwoSceneCutDocument();
		const earlier = storedUserCompositionRecordFromDocument(
			{ savedAt: '2026-10-01T00:00:00.000Z' },
			document
		);
		const later = storedUserCompositionRecordFromDocument(
			{ savedAt: '2026-10-09T00:00:00.000Z' },
			document
		);

		expect(
			userCompositionStoredContentKey(
				userCompositionDocumentFromReading(readStoredUserCompositionRecord(cloneJsonValue(earlier)))
			)
		).toBe(
			userCompositionStoredContentKey(
				userCompositionDocumentFromReading(readStoredUserCompositionRecord(cloneJsonValue(later)))
			)
		);
	});
});

describe('whether autosave would change the store', () => {
	it('is false for a document that was just opened', () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());

		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);
	});

	it('is false before anything is known to be stored', () => {
		applyFilm(storedTwoSceneCutDocument().film, { kind: 'deliverable' });

		expect(
			new UserCompositionAutosaveLedger().wouldChangeStore(readOpenFilmAsUserCompositionDocument())
		).toBe(false);
	});

	it('stays false through selecting every Scene, seeking across the cut, and playback cuts', async () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());
		const wouldSave = (): boolean =>
			ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument());

		await selectOpenFilmScene('lower-third', 0);
		expect(wouldSave()).toBe(false);
		await selectOpenFilmScene('hero', 12);
		expect(wouldSave()).toBe(false);
		await seekOpenFilmFrame(200);
		expect(filmState.selectedSceneId).toBe('lower-third');
		expect(wouldSave()).toBe(false);
		await cutOpenFilmPlaybackToNextScene(true);
		await cutOpenFilmPlaybackToNextScene(true);
		expect(filmState.selectedSceneId).toBe('lower-third');
		expect(wouldSave()).toBe(false);
	});

	for (const fixture of STORED_USER_COMPOSITION_RECORD_FIXTURES.filter(
		(candidate) => candidate.outcome === 'opens-several-scenes'
	)) {
		it(`stays false while every Scene of the ${fixture.slug} record takes its turn live`, async () => {
			const stored = userCompositionDocumentFromReading(
				readStoredUserCompositionRecord({ meta: fixture.meta, ...fixture.document })
			);
			const ledger = openStoredDocument(stored);

			for (const scene of [...stored.film.scenes, ...stored.film.scenes]) {
				await selectOpenFilmScene(scene.id, 0);
				expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);
			}
		});
	}

	it('is true for an edit to the selected Scene, to a parked Scene, and to the Film', async () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());

		engineState.transport.durationSeconds = 4;
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(true);

		// The edited Scene is parked, and the edit is still unsaved.
		await selectOpenFilmScene('lower-third', 0);
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(true);

		ledger.recordStored(readOpenFilmAsUserCompositionDocument());
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);

		presetBase.name = 'Renamed Film';
		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(true);
	});

	it('is false again when a change is taken back before it was saved', () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());
		const durationSeconds = engineState.transport.durationSeconds;

		engineState.transport.durationSeconds = 4;
		engineState.transport.durationSeconds = durationSeconds;

		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);
	});

	it('compares against the last save that landed, not the document that was opened', () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());
		engineState.transport.durationSeconds = 4;
		const saved = readOpenFilmAsUserCompositionDocument();

		// A save of `saved` lands after the change was taken back in the Workspace.
		engineState.transport.durationSeconds = 6;
		ledger.recordStored(saved);

		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(true);
	});

	it('forgets what was stored when another document is opened', () => {
		const ledger = openStoredDocument(storedTwoSceneCutDocument());
		engineState.transport.durationSeconds = 4;

		ledger.clear();

		expect(ledger.wouldChangeStore(readOpenFilmAsUserCompositionDocument())).toBe(false);
	});
});
